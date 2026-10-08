"""Agentes de IA: visão, pensamento, intenção/tema e pesquisa profunda."""
from .usertime import current_time_text
from .websearch import fetch_pages
from .websearch import format_search_results
from .websearch import run_web_search
import json
from .settings import get_deep_settings
from .llm import model_for_reasoning
from .config import MAX_HISTORY_MESSAGES
from .llm import extract_tool_calls
from .llm import call_model
from .config import DEEP_INTENT_PROMPT
from .config import DEEP_RESEARCH_PROMPT
from .config import DEEP_RESEARCH_TIMEOUT
from .config import THINKING_AGENT_MAX_TOKENS
from .llm import build_messages
from .config import MODEL
from .config import DEEP_RESEARCH_TOOL
from .config import VISIT_TOOL
from .config import SEARCH_TOOL
from .config import TIME_TOOL
from .config import REMINDER_TOOL
from .config import MEMORY_TOOL
from .config import THINKING_AGENT_PROMPT
from .config import API_KEY
from .config import THINKING_AGENT_ROUNDS
from .llm import normalize_reasoning_level
from .tools import run_tools
from .llm import parse_tool_arguments
from .llm import tool_call_id
from .config import RESEARCH_TOOL_NAMES
from .llm import tool_call_name
import re
from .llm import extract_text
from .llm import log_upstream_error
from .config import STREAM_TIMEOUT
from .config import CONNECT_TIMEOUT
from .config import MAX_OUTPUT_TOKENS
from .config import VISION_MODEL
import requests
from .config import VISION_AGENT_PROMPT


def analyze_image_for_text_model(messages, reasoning):
    """Converte uma mensagem com imagem em contexto textual para o modelo final."""
    enriched = [dict(message) for message in messages]
    for index in range(len(enriched) - 1, -1, -1):
        message = enriched[index]
        content = message.get("content")
        if message.get("role") != "user" or not isinstance(content, list):
            continue

        image_parts = [
            part for part in content
            if isinstance(part, dict) and part.get("type") == "image_url"
        ]
        if not image_parts:
            continue

        visual_content = [{"type": "text", "text": VISION_AGENT_PROMPT}]
        visual_content.extend(image_parts)
        response = call_model(
            {
                "model": VISION_MODEL,
                "messages": [{"role": "user", "content": visual_content}],
                "stream": False,
                "max_tokens": min(MAX_OUTPUT_TOKENS, 4000),
            },
            timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
        )
        if response.status_code != 200:
            log_upstream_error(response)
            raise RuntimeError("O agente visual não conseguiu analisar a imagem.")

        try:
            report = extract_text(response.json()).strip()
        except (ValueError, TypeError):
            report = ""
        if not report:
            raise RuntimeError("O agente visual retornou uma análise vazia.")

        text_parts = [
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        user_text = " ".join(text_parts).strip()
        enriched[index] = {
            "role": "user",
            "content": (
                "%s\n\nRelatório do agente visual (use como contexto da imagem):\n%s"
                % (user_text, report)
            ).strip(),
        }
        break

    return enriched


def degrade_images(messages):
    """
    Fallback quando o agente visual falha: troca cada imagem por um aviso
    textual e deixa a resposta seguir (com o modelo normal), em vez de
    derrubar o pedido inteiro com erro. O aviso instrui o modelo a contar
    a falha ao usuário sem fingir que viu a imagem.
    """
    degraded = [dict(message) for message in messages]

    for index, message in enumerate(degraded):
        content = message.get("content")
        if message.get("role") != "user" or not isinstance(content, list):
            continue

        has_image = any(
            isinstance(part, dict) and part.get("type") == "image_url"
            for part in content
        )
        if not has_image:
            continue

        text = " ".join(
            part.get("text", "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ).strip()

        degraded[index] = {
            "role": "user",
            "content": (
                "%s\n\n[Aviso interno: a imagem anexada não pôde ser "
                "processada agora. Avise o usuário disso em uma frase e "
                "responda pelo texto; não finja que viu a imagem nem "
                "invente o que ela mostrava.]" % text
            ).strip(),
        }

    return degraded


def thinking_output_status(text):
    """Lê e remove o marcador final mesmo quando vem na mesma linha."""
    text = (text or "").strip()
    match = re.search(
        r"(?:STATUS|ESTADO)\s*:\s*(FINAL|CONTINUE)\s*[`*_]*\s*$",
        text,
        re.I,
    )
    if not match:
        return "continue", text

    cleaned = text[:match.start()].rstrip(" \t-–—:|`*_\n")
    status = match.group(1).lower()
    return status, cleaned


def thinking_is_identity_only(text):
    """Evita que uma apresentação do modelo seja tratada como solução."""
    normalized = re.sub(r"[*_`]", "", (text or "").strip().lower())
    normalized = re.sub(r"\s+", " ", normalized)
    return bool(re.fullmatch(
        r"(?:sou|eu sou|meu nome é|meu nome e|me chamo) "
        r"(?:o )?(?:agente de pensamento(?: da nexa)?|nexa)[.!]?",
        normalized,
    ))


def thinking_tool_calls(messages, memories, user_id, reasoning, thinking_context="",
                        progress=None, allow_research=True):
    """Executa ferramentas e transmite o andamento para a aba Pensamento."""
    regular = []
    results = {}
    memory_updated = False
    searched = False

    def note(text):
        if progress:
            progress(text)

    for call in messages:
        name = tool_call_name(call)
        if name in RESEARCH_TOOL_NAMES:
            if not allow_research:
                call_id = tool_call_id(call)
                results[call_id] = (
                    "A pesquisa já foi executada antes deste loop. Não faça "
                    "outra pesquisa; use o relatório inicial recebido."
                )
                note(
                    "A ferramenta de pesquisa solicitada foi bloqueada: o "
                    "relatório da pesquisa profunda já está disponível."
                )
                continue

            if name != "pesquisa_profunda":
                regular.append(call)
                continue

            call_id = tool_call_id(call)
            arguments = parse_tool_arguments(call)
            topic = arguments.get("topico")
            topic = topic if isinstance(topic, str) else ""
            context = thinking_context.strip() or topic
            note(
                "🔎 O agente de pensamento chamou a pesquisa profunda para "
                "confirmar a solução."
            )
            research_topic = interpret_deep_intent(
                user_id, context, [], reasoning, progress, ""
            )
            note("Pesquisa profunda iniciada para: %s" % (research_topic or context))
            report = run_deep_research(
                user_id, research_topic or context, progress, reasoning
            )
            results[call_id] = report
            searched = True
            note(
                "✅ Pesquisa profunda concluída. O relatório foi entregue ao "
                "agente de pensamento para a próxima revisão."
            )
            continue

        regular.append(call)

    if regular:
        regular_results, memory_now, search_now = run_tools(
            user_id, regular, reasoning, progress=progress,
            allow_research=allow_research,
        )
        results.update(regular_results)
        memory_updated = memory_now
        searched = searched or search_now

    return results, memory_updated, searched


def run_thinking_agent(user_id, messages, memories, reasoning, progress=None,
                       initial_deep_report="", block_research=False):
    """Resolve e revisa a solicitação em rodadas finitas antes da resposta."""
    reasoning = normalize_reasoning_level(reasoning)
    block_research = block_research or bool(initial_deep_report)
    rounds = max(0, THINKING_AGENT_ROUNDS.get(reasoning, 0))
    if not API_KEY or rounds == 0 or reasoning == "none":
        return ""

    history = list(messages)
    previous = ""
    previous_signature = ""
    identity_attempts = 0
    for index in range(rounds):
        if progress:
            progress(
                "Rodada %d de %d do agente de pensamento em andamento."
                % (index + 1, rounds)
            )
        prompt = THINKING_AGENT_PROMPT
        if initial_deep_report:
            prompt += (
                "\n\nUm agente de pesquisa profunda já investigou a solicitação "
                "antes deste loop. Use o relatório abaixo como contexto factual "
                "de trabalho. Não tente pesquisar novamente, não peça outra "
                "pesquisa e não use ferramentas de pesquisa; revise, organize e "
                "melhore a solução com base no relatório.\n\n"
                "RELATÓRIO INICIAL DA PESQUISA PROFUNDA:\n"
                + initial_deep_report
            )
        if block_research:
            prompt += (
                "\n\nNeste modo, as ferramentas pesquisar, visitar_pagina e "
                "pesquisa_profunda estão indisponíveis porque a pesquisa já foi "
                "concluída antes do loop."
            )
        if identity_attempts:
            prompt += (
                "\n\nA rodada anterior foi apenas uma apresentação e não resolveu "
                "a solicitação. Ignore esse impulso e comece agora pela análise "
                "concreta da pergunta do usuário."
            )
        if previous:
            prompt += (
                "\n\nTentativa anterior (revise-a e melhore-a):\n" + previous
            )

        thinking_tools = [MEMORY_TOOL, REMINDER_TOOL, TIME_TOOL]
        if not block_research:
            thinking_tools += [SEARCH_TOOL, VISIT_TOOL, DEEP_RESEARCH_TOOL]

        body = {
            "model": MODEL,
            "messages": build_messages(
                history, memories, prompt, user_id,
                system_prompt_override=prompt,
                model_name=MODEL,
                reasoning_level="none",
            ),
            "stream": False,
            "max_tokens": THINKING_AGENT_MAX_TOKENS,
            "tools": thinking_tools,
            "tool_choice": "auto",
        }

        if progress:
            progress(
                "Consultando o modelo para elaborar a rodada %d..."
                % (index + 1)
            )

        try:
            response = call_model(
                body,
                timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
            )
            if response.status_code != 200:
                log_upstream_error(response)
                if progress:
                    progress(
                        "O modelo não respondeu à rodada %d (HTTP %d)."
                        % (index + 1, response.status_code)
                    )
                break
            payload = response.json()
        except (requests.RequestException, ValueError) as error:
            print("[NEXA-PENSAMENTO] rodada falhou: %s" % error)
            if progress:
                progress(
                    "A rodada %d falhou ao consultar o modelo; vou encerrar "
                    "esta revisão."
                    % (index + 1)
                )
            break

        text = (extract_text(payload) or "").strip()
        if progress:
            progress("O modelo respondeu à rodada %d." % (index + 1))
        status, text = thinking_output_status(text)
        calls = extract_tool_calls(payload)
        if calls:
            tool_names = ", ".join(
                tool_call_name(call) for call in calls if tool_call_name(call)
            )
            if progress:
                progress(
                    "O agente solicitou a ferramenta: %s. Aguardando o resultado."
                    % (tool_names or "ferramenta desconhecida")
                )
            results, _, _ = thinking_tool_calls(
                calls, memories, user_id, reasoning, previous or text,
                progress=progress,
                allow_research=not block_research,
            )
            if results:
                history.extend([
                    {"role": "assistant", "content": text or None, "tool_calls": calls},
                    *[
                        {"role": "tool", "tool_call_id": call_id, "content": content}
                        for call_id, content in results.items()
                    ],
                ])

        identity_only = thinking_is_identity_only(text)
        if identity_only:
            identity_attempts += 1
            text = ""
            if progress:
                progress(
                    "A resposta intermediária não trouxe uma solução; "
                    "vou exigir uma análise concreta na próxima rodada."
                )
        elif text:
            identity_attempts = 0
            previous = text
            signature = re.sub(r"\s+", " ", text).strip().lower()
            if signature == previous_signature:
                status = "final"
                if progress:
                    progress("A solução não mudou nesta revisão; encerrando o loop.")
            previous_signature = signature
            if progress:
                progress(
                    "Resposta da rodada %d:\n%s" % (index + 1, text)
                )

        if status == "final" and not calls and previous and not identity_only:
            if progress:
                progress("O agente identificou que a solução está pronta.")
            break
        if not text and not calls and not previous and not identity_only:
            break
        if identity_attempts >= 2 and not calls:
            print("[NEXA-PENSAMENTO] modelo não produziu uma solução útil")
            break
        print("[NEXA-PENSAMENTO] rodada %d/%d concluída" % (index + 1, rounds))

    return previous


def interpret_deep_intent(user_id, user_message, messages, reasoning=None,
                          progress=None, visual_report=""):
    """Converte pergunta contextual em uma instrução autocontida de pesquisa."""
    if not isinstance(user_message, str) or not user_message.strip():
        return ""

    recent = []
    for message in messages[-MAX_HISTORY_MESSAGES:]:
        role = "Usuário" if message.get("role") == "user" else "NEXA"
        content = str(message.get("content") or "").strip()
        if content:
            recent.append("%s: %s" % (role, content[:4000]))

    context = "\n".join(recent)
    visual_context = (
        "\n\nRelatório visual da imagem anexada (use como contexto factual "
        "da imagem):\n" + visual_report[:8000]
        if visual_report else ""
    )
    prompt = (
        "Conversa recente (use apenas para resolver referências):\n%s%s\n\n"
        "Pergunta que deve ser pesquisada:\n%s"
        % (
            context or "(sem contexto anterior)",
            visual_context,
            user_message.strip()[:4000],
        )
    )
    body = {
        "model": model_for_reasoning(reasoning),
        "messages": [
            {"role": "system", "content": DEEP_INTENT_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": False,
        "max_tokens": min(MAX_OUTPUT_TOKENS, 1200),
    }

    if progress:
        progress("Interpretando a pergunta com o contexto recente.")

    try:
        response = call_model(
            body,
            timeout=(CONNECT_TIMEOUT, min(DEEP_RESEARCH_TIMEOUT, 60)),
        )
        if response.status_code != 200:
            raise RuntimeError("HTTP %d" % response.status_code)
        interpreted = (extract_text(response.json()) or "").strip()
        return interpreted[:4000] if interpreted else user_message.strip()[:400]
    except (requests.RequestException, RuntimeError, ValueError) as error:
        print("[NEXA-INTENCAO] falha; usando pergunta original: %s" % error)
        if progress:
            progress("A interpretação contextual falhou; usando a pergunta original.")
        return user_message.strip()[:400]


def run_deep_research(user_id, topic, progress=None, reasoning=None):
    """
    Pesquisa profunda: agente novo, sem o contexto da conversa, com as
    ferramentas de busca. Devolve o relatório final (ou um aviso de falha
    para o modelo principal repassar ao usuário).

    "progress" é um callback opcional: cada passo da investigação vira uma
    linha na cadeia de pensamento mostrada no chat.
    """
    if not API_KEY or not isinstance(topic, str) or not topic.strip():
        return "Pesquisa profunda indisponível: tópico vazio."

    topic = topic.strip()[:400]
    cache_key = (user_id or "anon") + "::pesquisa_profunda"

    settings = get_deep_settings(user_id)
    agent = settings["agent"]
    max_rounds = settings["rounds"]

    def note(text):
        if progress:
            progress(text)

    note(
        "%s: tema «%s». Montando a primeira rodada de buscas."
        % (agent, topic)
    )

    messages = [
        {
            "role": "system",
            "content": "Seu nome é %s.\n\n%s" % (agent, DEEP_RESEARCH_PROMPT),
        },
        {"role": "user", "content": "Tópico da pesquisa: %s" % topic},
    ]

    def ask(with_tools=True):
        body = {
            "model": model_for_reasoning(reasoning),
            "messages": messages,
            "stream": False,
            "max_tokens": MAX_OUTPUT_TOKENS,
        }

        if with_tools:
            body["tools"] = [SEARCH_TOOL, VISIT_TOOL, TIME_TOOL]
            body["tool_choice"] = "auto"

        response = call_model(
            body,
            timeout=(CONNECT_TIMEOUT, DEEP_RESEARCH_TIMEOUT),
        )

        if response.status_code != 200:
            raise RuntimeError(
                "HTTP %d: %s" % (response.status_code, response.text[:300])
            )

        return response.json()

    for round_number in range(1, max_rounds + 1):
        note(
            "Rodada %d de %d: decidindo os próximos passos."
            % (round_number, max_rounds)
        )

        try:
            payload = ask()
        except (requests.RequestException, RuntimeError, ValueError) as error:
            print("[NEXA-PROFUNDA] falha na rodada %d: %s" % (round_number, error))
            note("Falha na rodada %d: %s" % (round_number, str(error)[:120]))
            return (
                "A pesquisa profunda falhou no meio do caminho (%s). Avise o "
                "usuário que não completou e responda com o que ele já sabe."
                % error
            )

        calls = extract_tool_calls(payload)
        text = (extract_text(payload) or "").strip()

        if not calls:
            print("[NEXA-PROFUNDA] relatório pronto na rodada %d." % round_number)
            return text or "A pesquisa profunda terminou sem texto útil."

        messages.append({
            "role": "assistant",
            "content": text or None,
            "tool_calls": [
                {
                    "id": tool_call_id(call),
                    "type": "function",
                    "function": {
                        "name": tool_call_name(call),
                        "arguments": json.dumps(
                            parse_tool_arguments(call), ensure_ascii=False
                        ),
                    },
                }
                for call in calls
            ],
        })

        for call in calls:
            name = tool_call_name(call)
            call_id = tool_call_id(call)
            arguments = parse_tool_arguments(call)

            if name == "pesquisar":
                term = arguments.get("termo")
                print(
                    "[NEXA-PROFUNDA] busca %r (rodada %d)."
                    % (term, round_number)
                )
                note("Buscando na web: «%s»" % term)
                # Orçamento próprio de 90s por termo: antes era patience=0
                # (insistência sem fim), o que prendia a rodada quando o
                # buscador caía.
                found, error = run_web_search(term, patience=90, progress=note)

                if found:
                    note(
                        "«%s»: %d resultado(s) encontrados."
                        % (term, len(found))
                    )
                    content = format_search_results(term, found, cache_key)
                elif error:
                    content = error
                else:
                    content = "A pesquisa não retornou nada útil."
            elif name == "visitar_pagina":
                paginas = arguments.get("paginas", [])
                if not isinstance(paginas, list):
                    paginas = []
                if paginas:
                    note(
                        "Lendo página(s): %s."
                        % ", ".join(str(p) for p in paginas)
                    )
                content = fetch_pages(cache_key, paginas)
            elif name == "data_hora":
                content = current_time_text(user_id)
            else:
                content = "Ferramenta desconhecida para este pesquisador."

            messages.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": content,
            })

    print(
        "[NEXA-PROFUNDA] limite de %d rodadas atingido; pedindo fechamento."
        % max_rounds
    )
    note("Limite de rodadas atingido: pedindo o relatório final.")

    messages.append({
        "role": "user",
        "content": (
            "Chega de ferramentas: escreva agora o relatório final em "
            "português do Brasil com tudo que já encontrou, mesmo que "
            "incompleto, e liste o que ficou sem confirmar."
        ),
    })

    try:
        payload = ask(with_tools=False)
        return (extract_text(payload) or "").strip() or (
            "A pesquisa profunda terminou sem texto útil."
        )
    except (requests.RequestException, RuntimeError, ValueError) as error:
        print("[NEXA-PROFUNDA] falha no fechamento: %s" % error)
        return "A pesquisa profunda não conseguiu fechar o relatório."
