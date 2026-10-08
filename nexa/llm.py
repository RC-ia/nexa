"""Cliente do provedor LLM: headers, corpo de requisição, extração de
raciocínio e tool calls, montagem de mensagens e primitivas de SSE."""
from .config import API_BASE
import requests
from .config import DEEP_RESEARCH_TOOL
from .config import VISIT_TOOL
from .config import SEARCH_TOOL
from .config import TIME_TOOL
from .config import REMINDER_TOOL
from .config import MEMORY_TOOL
from .config import MAX_OUTPUT_TOKENS
from .config import FLASK_THINK
from .config import MODEL_FLASK
from .config import VISION_MODEL
from .config import REASONING_ALIASES
from .config import WEEK_DAYS
from .usertime import get_time_settings
from .usertime import format_offset
from .usertime import user_now
from .config import MEMORY_PROMPT_HEADER
from .prompts import current_system_prompt
from .config import MODEL
import json
import re
from .config import API_KEY


def auth_headers():
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + API_KEY,
    }


def extract_text(data):
    choices = data.get("choices") or []

    if not choices:
        return ""

    choice = choices[0] or {}

    delta = choice.get("delta") or {}
    content = delta.get("content")

    if isinstance(content, str):
        return strip_inline_thought(content)

    message = choice.get("message") or {}
    content = message.get("content")

    if isinstance(content, str):
        return strip_inline_thought(content)

    return ""


INLINE_THOUGHT_PATTERNS = (
    # diffusiongemma (formato documentado).
    ("<|channel|>thought", "<channel|>"),
    # diffusiongemma (formato observado sem o "thought").
    ("<|channel|>", "<channel|>"),
    # DeepSeek R1, Qwen QwQ, Kimi e variantes quando o provedor
    # não devolve o campo separado de raciocínio.
    ("<think>", "</think>"),
    # Algumas variantes usam reflexão / raciocínio como rótulo.
    ("<reflection>", "</reflection>"),
    ("<reasoning>", "</reasoning>"),
)


def strip_inline_thought(text):
    """Remove blocos de pensamento inline (<think>, <|channel>thought etc.)
    do texto final que vai para o chat. O texto do pensamento continua
    acessível via extract_inline_thought."""
    if not text:
        return text

    cleaned = text

    for start_pattern, _end_pattern in INLINE_THOUGHT_PATTERNS:
        if start_pattern in cleaned:
            # Remove o bloco mais o marcador final; mantém o que vem
            # antes/depois para o usuário.
            cleaned = re.sub(
                r"%s.*?%s" % (re.escape(start_pattern), re.escape(_end_pattern)),
                "",
                cleaned,
                flags=re.DOTALL,
            )

    return cleaned.strip()


def extract_reasoning(data):
    """
    O raciocínio chega em campos diferentes dependendo do modelo/router
    (reasoning_content é o mais comum em APIs compatíveis com OpenAI).

    Raciocínio inline no content (diffusiongemma, <think>, etc.) é
    tratado pelo InlineThoughtBuffer para tolerar marcadores divididos
    entre chunks de streaming.
    """

    choices = data.get("choices") or []

    if not choices:
        return ""

    choice = choices[0] or {}

    for holder in (choice.get("delta") or {}, choice.get("message") or {}):
        for field in ("reasoning_content", "reasoning", "thinking"):
            value = holder.get(field)

            if isinstance(value, str):
                return value

    return ""


def _could_start_marker(text):
    """Devolve True se o texto pode ser o início de algum marcador
    de pensamento (<think>, <|channel|>, etc.). Usado para decidir
    se o buffer pode ser liberado como plain_text sem esperar mais
    chunks."""

    if not text:
        return False

    # Todos os marcadores começam com "<" (tag XML-style).
    return text[0] == "<"


def extract_inline_thought(text):
    """Extrai o conteúdo entre o primeiro par de marcadores de
    raciocínio inline do texto (<think>…</think>,
    <|channel>thought…<channel|>, etc.). Usado por respostas
    bloqueantes e pelo buffer de streaming para detectar o início
    do bloco de pensamento."""
    if not text:
        return ""

    for start_pattern, end_pattern in INLINE_THOUGHT_PATTERNS:
        start = text.find(start_pattern)
        if start < 0:
            continue

        # Início do raciocínio é logo depois do marcador de abertura.
        thought_start = start + len(start_pattern)
        end = text.find(end_pattern, thought_start)

        # Marcador de fim ainda não chegou (chunks parciais no streaming);
        # nesse caso devolve o que temos até agora, sem o marcador de fim,
        # para que o caller continue alimentando o buffer.
        if end < 0:
            return text[thought_start:].lstrip()

        # Pega o trecho entre os marcadores; strip só nas pontas para
        # preservar a formatação interna do raciocínio.
        return text[thought_start:end].strip()

    return ""


class InlineThoughtBuffer:
    """Acumula pedaços de conteúdo em streaming para detectar raciocínio
    inline (<think>, <|channel>thought) mesmo quando os marcadores de
    abertura/fechamento ficam divididos entre chunks.

    Devolve (reasoning, plain_text) a cada chamada: o raciocínio pronto
    para emitir como evento "reasoning" e o texto limpo para enviar ao
    usuário. O plain_text inclui o conteúdo depois do bloco de
    pensamento, se o marcador de fim já chegou."""

    def __init__(self):
        self._buffer = ""
        self._inside = False
        self._open_pattern = ""
        self._close_pattern = ""
        self._reasoning_seen = 0

    def feed(self, chunk):
        """Recebe um chunk de conteúdo e devolve (reasoning, plain_text).
        O reasoning pode vir vazio quando o bloco de pensamento ainda não
        fechou. O plain_text vem apenas com o que está depois do bloco de
        pensamento (ou tudo o que chegou se nenhum marcador foi visto).

        O buffer interno guarda o estado entre as chamadas para tolerar
        marcadores divididos em vários chunks. Enquanto o bloco de
        pensamento não fechar, a parte "nova" do conteúdo desde a última
        chamada é devolvida como reasoning."""

        if not chunk:
            return "", ""

        if not self._inside:
            # Procurando o marcador de abertura no buffer acumulado.
            self._buffer += chunk
            return self._scan_for_open_marker()

        # Já estamos dentro de um bloco de pensamento; acumula o chunk
        # e procura o marcador de fim.
        self._buffer += chunk
        return self._emit_progress()

    def _scan_for_open_marker(self):
        """Procura o marcador de abertura no buffer. Se encontrar,
        separa o que veio antes como plain_text, abre o bloco e
        processa. Se não encontrar, libera o que exceder o limite de
        buffer (4 KB) para não acumular texto normal indefinidamente."""

        open_index = -1
        open_pattern = ""
        for pattern, close in INLINE_THOUGHT_PATTERNS:
            idx = self._buffer.find(pattern)
            if idx >= 0 and (open_index < 0 or idx < open_index):
                open_index = idx
                open_pattern = pattern
                self._close_pattern = close

        if open_index < 0:
            # Nenhum marcador visto ainda. Libera tudo para o usuário
            # se o buffer for grande o suficiente para garantir que
            # não há marcador pendente de chunk anterior.
            if len(self._buffer) > 4096:
                plain_text = self._buffer
                self._buffer = ""
                return "", plain_text
            # Se o buffer for maior que o maior padrão de abertura,
            # podemos liberar o prefixo com segurança (nenhum padrão
            # de pensamento começa no meio do buffer).
            max_open = max(len(p) for p, _ in INLINE_THOUGHT_PATTERNS)
            if len(self._buffer) > max_open:
                plain_text = self._buffer[:-max_open]
                self._buffer = self._buffer[-max_open:]
                return "", plain_text
            # Para buffers menores que max_open, não podemos garantir
            # que o conteúdo não é o início de um marcador. Mas se o
            # buffer for maior que 0 e o primeiro caractere não puder
            # ser o início de nenhum padrão, libera como plain_text.
            if len(self._buffer) > 0 and not _could_start_marker(self._buffer):
                plain_text = self._buffer
                self._buffer = ""
                return "", plain_text
            return "", ""

        # Marcador de abertura encontrado. Libera o que vem antes
        # como texto normal.
        plain_text = self._buffer[:open_index]
        self._buffer = self._buffer[open_index + len(open_pattern):]
        self._inside = True
        self._open_pattern = open_pattern
        self._reasoning_seen = 0

        return self._emit_progress(leading_plain=plain_text)

    def _drain_buffer(self):
        """Libera todo o conteúdo do buffer como plain_text, sem
        procurar marcadores. Usado para processar o texto que sobrou
        depois de um bloco de pensamento (já que sabemos que não há
        mais raciocínio pendente nesse mesmo chunk)."""
        plain_text = self._buffer
        self._buffer = ""
        return "", plain_text

    def _emit_progress(self, leading_plain=""):
        """Procura o marcador de fim no buffer. Devolve (new_reasoning,
        plain_text). A nova parte do raciocínio (desde a última chamada)
        é emitida; o resto do buffer é mantido para a próxima chamada.
        leading_plain é concatenado ao plain_text retornado."""

        end_index = self._buffer.find(self._close_pattern)

        if end_index < 0:
            # Bloco de pensamento ainda aberto. Emite só o que apareceu
            # de novo desde a última chamada, mas mantém no buffer um
            # sufixo de até (close_size - 1) caracteres para não emitir
            # uma possível parte inicial do delimitador. Se o buffer
            # for menor que close_size, o sufixo cabe inteiro no buffer
            # e o conteúdo é emitido normalmente.
            close_size = len(self._close_pattern)
            hold = min(close_size - 1, len(self._buffer))
            safe_cut = max(self._reasoning_seen, len(self._buffer) - hold)
            new_reasoning = self._buffer[self._reasoning_seen:safe_cut]
            self._reasoning_seen = safe_cut
            return new_reasoning, leading_plain

        # Bloco fechou. Emite a parte nova entre o ponto visto e o
        # marcador de fim, e processa o que vier depois do marcador
        # como conteúdo normal (pode ter mais texto ou mais marcadores
        # inline em casos raros).
        new_reasoning = self._buffer[self._reasoning_seen:end_index]
        remainder = self._buffer[end_index + len(self._close_pattern):]
        self._buffer = ""
        self._inside = False
        self._open_pattern = ""
        self._close_pattern = ""
        self._reasoning_seen = 0

        plain_text = leading_plain
        if remainder:
            # O remainder é o texto que veio depois do marcador de
            # fim do pensamento. Pode ter mais marcadores inline
            # (raro, mas possível). Processa via _scan_for_open_marker
            # e libera o que não virar raciocínio (só se não estiver
            # dentro de um novo bloco de pensamento).
            self._buffer = remainder
            extra_reasoning, extra_plain = self._scan_for_open_marker()
            new_reasoning += extra_reasoning
            if self._buffer and not self._inside:
                _, leftover = self._drain_buffer()
                extra_plain += leftover
            plain_text += extra_plain

        return new_reasoning, plain_text

    def flush(self):
        """No fim do streaming, libera qualquer texto pendente no
        buffer. Se ainda estiver dentro de um bloco de pensamento sem
        fechamento, devolve o que tiver como raciocínio."""
        if not self._buffer:
            return "", ""

        # Só emite a parte do buffer que ainda não foi vista para
        # evitar duplicar conteúdo já enviado em chamadas anteriores.
        tail = self._buffer[self._reasoning_seen:]
        self._buffer = ""
        if self._inside:
            # Marcador de fim ausente; trata o que sobrou como raciocínio
            # para não perder a parte final do pensamento.
            return tail, ""

        # Fora de um bloco de pensamento: o que ficou é texto normal
        # (pode ser o resto da resposta ou um marcador de abertura que
        # ficou sem fechamento).
        return "", tail


def split_reasoning_from_content(content, buffer):
    """
    Recebe o campo "content" de um chunk (delta ou message) e devolve
    (reasoning, plain_text). Usa reasoning para extrair o raciocínio
    inline quando o modelo emite <think> / <|channel>thought no próprio
    conteúdo; plain_text é o que sobra para enviar ao usuário.

    O buffer acumula conteúdo entre chunks para detectar marcadores
    divididos em vários pedaços.
    """
    if not isinstance(content, str):
        return "", ""

    reasoning, plain_text = buffer.feed(content)
    return reasoning, plain_text


def finalize_inline_buffer(buffer):
    """Esvazia o buffer de pensamento inline ao final do streaming."""
    return buffer.flush()


def finish_reason(data):
    choices = data.get("choices") or []

    if not choices:
        return None

    return (choices[0] or {}).get("finish_reason")


def extract_tool_calls(data):
    """
    Devolve as tool calls pedidas no pedaço, seja em streaming (delta)
    ou na resposta completa (message). O nome e os argumentos ficam dentro
    de "function"; no streaming chegam em pedacos que precisam ser unidos.
    """
    choices = data.get("choices") or []

    if not choices:
        return []

    choice = choices[0] or {}

    for holder in (choice.get("delta") or {}, choice.get("message") or {}):
        calls = holder.get("tool_calls")

        if isinstance(calls, list) and calls:
            return calls

    return []


def tool_call_name(call):
    """O nome da funcao pode vir no nivel superior ou dentro de "function"."""
    function = call.get("function") or {}

    return call.get("name") or function.get("name") or ""


def tool_call_id(call):
    return call.get("id") or "call_salvar_memoria"


def merge_tool_call(target, piece):
    """
    No streaming as tool calls chegam em pedacoes: primeiro o id/nome, depois
    os argumentos cortados no meio. Aqui juntamos tudo num unico dicionario
    para remontar o JSON no final.
    """
    index = piece.get("index")

    if index is None:
        index = len(target)

    while len(target) <= index:
        target.append({})

    current = target[index]

    if piece.get("id"):
        current["id"] = piece["id"]

    function = piece.get("function") or {}

    name = piece.get("name") or function.get("name")

    if name:
        current["name"] = name

    arguments = function.get("arguments")

    if arguments is None:
        arguments = piece.get("arguments")

    if isinstance(arguments, str):
        current["arguments"] = current.get("arguments", "") + arguments
    elif isinstance(arguments, dict):
        current["arguments_object"] = arguments


def parse_tool_arguments(call):
    if isinstance(call.get("arguments_object"), dict):
        return call["arguments_object"]

    function = call.get("function") or {}
    raw = call.get("arguments")

    if raw is None:
        raw = function.get("arguments")

    if isinstance(raw, dict):
        return raw

    if not isinstance(raw, str) or not raw.strip():
        return {}

    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}

    return parsed if isinstance(parsed, dict) else {}


def log_upstream_error(response):
    """
    O 524 é um timeout do proxy na frente da API (Cloudflare), não um erro
    do modelo: a resposta não chegou a tempo. Ele chega acompanhado de um
    HTML gigante, então nunca vale a pena logar o corpo cru.
    """

    status = response.status_code

    if status == 524:
        print(
            "[NEXA] %s HTTP 524 — timeout na ponte para a API. "
            "A resposta demorou demais (o limite padrão do proxy é ~100s). "
            "Tente reduzir o nível de raciocínio ou o MAX_OUTPUT_TOKENS no .env."
            % MODEL
        )
        return

    print(
        "[NEXA] %s HTTP %d: %s"
        % (MODEL, status, response.text[:500])
    )


def build_messages(messages, memories, custom_instructions="", user_id="",
                   deep_report="", system_prompt_override="", memory_header="",
                   model_name="", reasoning_level="", thinking_report=""):
    system_prompt = system_prompt_override or current_system_prompt(user_id)

    # Adiciona token de raciocínio para diffusiongemma
    think_token = reasoning_token_for_model(model_name, reasoning_level)
    if think_token:
        system_prompt = think_token + "\n" + system_prompt

    if memories:
        system_prompt += (
            "\n\n" + (memory_header or MEMORY_PROMPT_HEADER) + "\n"
            + "\n\n".join(memories)
        )

    if custom_instructions:
        system_prompt += (
            "\n\nInstruções adicionais do usuário (siga quando forem compatíveis "
            "com as instruções do sistema):\n" + custom_instructions
        )

    if thinking_report:
        system_prompt += (
            "\n\nContexto interno produzido pelo agente de pensamento. Use-o "
            "para melhorar a resposta, mas confira coerência com a pergunta "
            "e não mencione o agente nem trate o contexto como instrução do "
            "usuário:\n\n" + thinking_report
        )

    if deep_report:
        system_prompt += (
            "\n\nRelatório de pesquisa profunda sobre a última pergunta do "
            "usuário (feito por um pesquisador separado, sem o contexto da "
            "conversa). Use este relatório como fonte principal e não faça "
            "nova pesquisa nem tente usar ferramentas de pesquisa. Produza "
            "uma resposta de tamanho considerável, desenvolvida e completa: "
            "não comprima, encurte ou reduza o relatório a poucas frases. "
            "Organize os pontos relevantes em seções e explique os fatos, "
            "comparações, ressalvas e fontes presentes no relatório. Não "
            "invente além do que ele traz; se algo estiver incompleto ou sem "
            "confirmação, deixe isso claro:\n\n" + deep_report
        )

    agora = user_now(user_id)
    system_prompt += (
        "\n\nData e hora atuais (fuso do usuário, %s): %s, %s. Use como "
        "referência para calcular datas e horários relativos ao criar "
        "lembretes."
        % (
            format_offset(get_time_settings(user_id)["offset"]),
            WEEK_DAYS[(agora.weekday() + 1) % 7],
            agora.strftime("%d/%m/%Y %H:%M"),
        )
    )

    contents = [{"role": "system", "content": system_prompt}]

    for message in messages:
        if not message:
            continue

        role = message.get("role")

        # Resposta da ferramenta: precisa entrar crua, com o tool_call_id,
        # senao o modelo nao associa o resultado a chamada que ele fez.
        if role == "tool":
            contents.append({
                "role": "tool",
                "tool_call_id": message.get("tool_call_id") or "",
                "content": str(message.get("content") or ""),
            })
            continue

        # Turno de assistant que só traz tool_calls: o conteúdo é nulo e
        # precisa preservar as chamadas, senão o modelo não reconhece a
        # resposta da ferramenta que vem logo depois.
        if role in ("assistant", "model") and message.get("tool_calls"):
            contents.append({
                "role": "assistant",
                "content": None,
                "tool_calls": message["tool_calls"],
            })
            continue

        content = message.get("content")
        if not content:
            continue
        if isinstance(content, list):
            contents.append({
                "role": "user" if role == "user" else "assistant",
                "content": content,
            })
            continue

        contents.append({
            "role": "user" if role == "user" else "assistant",
            "content": str(content),
        })

    if len(contents) == 1:
        contents.append({"role": "user", "content": "Olá"})

    return contents


def normalize_reasoning_level(level):
    return REASONING_ALIASES.get(level, level)


def message_has_image(messages):
    return any(
        isinstance(message, dict)
        and isinstance(message.get("content"), list)
        and any(
            isinstance(part, dict)
            and part.get("type") == "image_url"
            for part in message["content"]
        )
        for message in messages
    )


def model_for_request(level, messages):
    if message_has_image(messages):
        return VISION_MODEL
    return model_for_reasoning(level)


def model_for_reasoning(level):
    """
    O modo Rápido (sem raciocínio) pode usar um modelo próprio, definido no
    .env como MODEL_FLASK. Vazio ou outro nível usa o MODEL padrão.
    """
    if level == "none" and MODEL_FLASK:
        return MODEL_FLASK

    return MODEL


def is_diffusiongemma(model_name):
    """Verifica se o modelo é diffusiongemma que usa token <|think|>."""
    return model_name and "diffusiongemma" in model_name.lower()


def reasoning_token_for_model(model_name, level):
    """
    Retorna o token de raciocínio para o modelo.
    diffusiongemma usa <|think|> no system prompt.
    - Modo Rápido (level="none"): habilitado via FLASK_THINK (padrão: true)
    - Outros níveis: sempre habilitado para diffusiongemma
    """
    if not is_diffusiongemma(model_name):
        return ""
    if level == "none":
        return "<|think|>" if FLASK_THINK else ""
    return "<|think|>"


def request_body(stream, messages, memories, reasoning, custom_instructions="",
                 memory_enabled=True, user_id="", deep_report="",
                 thinking_report="", system_prompt_override=""):
    model = model_for_request(reasoning, messages)
    body = {
        "model": model,
        "messages": build_messages(
            messages, memories, custom_instructions, user_id, deep_report,
            system_prompt_override=system_prompt_override,
            model_name=model, reasoning_level=reasoning,
            thinking_report=thinking_report,
        ),
        "stream": stream,
        "max_tokens": MAX_OUTPUT_TOKENS,
    }

    if memory_enabled:
        body["tools"] = [MEMORY_TOOL, REMINDER_TOOL, TIME_TOOL]
        if not deep_report:
            body["tools"] += [
                SEARCH_TOOL,
                VISIT_TOOL,
                DEEP_RESEARCH_TOOL,
            ]
        body["tool_choice"] = "auto"

    return body


def generate_chat_title(user_message):
    """Gera um título curto para o chat baseado na primeira mensagem do usuário."""
    if not API_KEY or not user_message:
        return None

    prompt = (
        "Crie um título curto e descritivo (máximo 50 caracteres) para uma conversa "
        "que começa com esta mensagem do usuário:\n\n"
        f"\"{user_message}\"\n\n"
        "Responda APENAS com o título, sem aspas, sem explicações."
    )

    try:
        response = requests.post(
            API_BASE + "/chat/completions",
            headers=auth_headers(),
            json={
                "model": MODEL,
                "messages": [
                    {
                        "role": "system",
                        "content": "Você gera títulos curtos e descritivos para conversas. Máximo 50 caracteres. Apenas o título, nada mais.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "max_tokens": 30,
                "temperature": 0.3,
            },
            timeout=(10, 30),
        )

        if response.status_code != 200:
            return None

        title = extract_text(response.json()).strip()
        title = title.strip('"\'')
        
        if title and len(title) <= 60:
            return title
            
    except (requests.RequestException, ValueError) as error:
        print("[NEXA] falha ao gerar título:", error)
    
    return None


def sse(data):
    return "data: " + json.dumps(data, ensure_ascii=False) + "\n\n"


def sse_headers():
    return {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }


def parse_data_line(raw):
    if not raw:
        return None

    line = raw.decode("utf-8", "ignore").strip()

    if not line.startswith("data:"):
        return None

    payload = line[5:].strip()

    if not payload or payload == "[DONE]":
        return None

    try:
        return json.loads(payload)
    except ValueError:
        return None


def stream_content_field(data):
    """Devolve o campo "content" (delta ou message) como string, ou
    string vazia se ausente."""
    choices = data.get("choices") or []
    if not choices:
        return ""
    choice = choices[0] or {}
    for holder in (choice.get("delta") or {}, choice.get("message") or {}):
        content = holder.get("content")
        if isinstance(content, str):
            return content
    return ""
