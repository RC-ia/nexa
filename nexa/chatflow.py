"""Montagem das respostas do chat: streaming SSE, loop de ferramentas,
pesquisa profunda, pensamento e fallback bloqueante."""
from flask import jsonify
from .config import STREAM_TIMEOUT
from .config import CONNECT_TIMEOUT
from .agents import run_thinking_agent
from .config import THINKING_AGENT_ROUNDS
import time
from .agents import analyze_image_for_text_model
from .llm import message_has_image
from .agents import run_deep_research
from .agents import interpret_deep_intent
import queue
from .settings import get_deep_settings
from .llm import sse_headers
from flask import stream_with_context
from flask import Response
from .llm import model_for_reasoning
from .websearch import SEARCH_HEARTBEAT
import threading
from .config import MAX_OUTPUT_TOKENS
from .llm import finish_reason
from .llm import sse
from .llm import finalize_inline_buffer
from .llm import split_reasoning_from_content
from .llm import stream_content_field
from .llm import merge_tool_call
from .llm import extract_reasoning
from .llm import parse_data_line
from .llm import InlineThoughtBuffer
from .llm import extract_tool_calls
from .llm import extract_text
from .llm import log_upstream_error
from .llm import request_body
from .llm import auth_headers
from .config import API_BASE
import requests
from .llm import parse_tool_arguments
import json
from .llm import tool_call_name
from .llm import tool_call_id
from .tools import run_tools
from .config import MAX_TOOL_ROUNDS


def finish_stream_with_tools(user_id, messages, memories, reasoning,
                             custom_instructions, assistant_text, calls,
                             memory_enabled=True, thinking_report="",
                             deep_report="", system_prompt_override=""):
    """
    O modelo pediu ferramenta. Executamos, devolvemos os resultados no papel
    "tool" e pedimos a continuação da resposta.

    O modelo pode pedir ferramenta de novo na continuação, então repetimos
    até ele responder em texto puro ou bater o limite de rodadas.

    Devolve (texto_da_continuacao, memoria_atualizada, pesquisa_realizada).
    """
    memory_saved = False
    searched = False
    current_calls = calls
    current_text = assistant_text or ""

    for _ in range(MAX_TOOL_ROUNDS):
        results, memory_now, search_now = run_tools(
            user_id, current_calls, reasoning,
            allow_research=not bool(deep_report),
        )

        if not results:
            break

        memory_saved = memory_saved or memory_now
        searched = searched or search_now

        follow_up = list(messages) + [
            {"role": "assistant", "content": current_text},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": tool_call_id(call),
                        "type": "function",
                        "function": {
                            "name": tool_call_name(call),
                            "arguments": json.dumps(
                                parse_tool_arguments(call),
                                ensure_ascii=False,
                            ),
                        },
                    }
                    for call in current_calls
                ],
            },
        ] + [
            {
                "role": "tool",
                "tool_call_id": call_id,
                "content": content,
            }
            for call_id, content in results.items()
        ]

        try:
            response = requests.post(
                API_BASE + "/chat/completions",
                headers=auth_headers(),
                json=request_body(
                    False, follow_up, memories, reasoning, custom_instructions,
                    memory_enabled, user_id,
                    deep_report=deep_report,
                    thinking_report=thinking_report,
                    system_prompt_override=system_prompt_override,
                ),
                timeout=(10, 60),
            )
        except requests.RequestException as error:
            print("[NEXA] falha ao continuar após ferramenta:", error)
            return None, memory_saved, searched

        if response.status_code != 200:
            log_upstream_error(response)
            return None, memory_saved, searched

        try:
            payload = response.json()
        except ValueError:
            return None, memory_saved, searched

        current_text = extract_text(payload)
        current_calls = extract_tool_calls(payload)

        if not current_calls:
            # Sem texto nem nova ferramenta, não há o que exibir: devolvemos
            # vazio em vez de uma frase genérica que vaza ao usuário.
            return current_text, memory_saved, searched

    print("[NEXA] limite de rodadas de ferramenta atingido.")
    return current_text, memory_saved, searched


def probe_stream(lines):
    """
    Sonda o começo do stream antes de montar a resposta SSE.

    Num modelo com pensamento, o raciocínio chega antes do texto: a
    sondagem guarda esses pedaços para não perder o raciocínio quando o
    stream principal começar. Devolve uma tupla
    (reasoning_chunks, first_text, tool_calls, inline_buffer) ou None
    quando o stream acaba sem nada útil.

    O inline_buffer devolvido mantém o estado acumulado (incluindo
    possíveis pedaços parciais de <think> / <|channel>thought) para
    que o stream_chat_events continue de onde a sondagem parou sem
    perder o contexto do pensamento inline.
    """
    reasoning_chunks = []
    first_text = None
    tool_calls = []
    inline_buffer = InlineThoughtBuffer()

    try:
        for raw in lines:
            data = parse_data_line(raw)

            if not data:
                continue

            thinking = extract_reasoning(data)

            if thinking:
                reasoning_chunks.append(thinking)

            for piece in extract_tool_calls(data):
                merge_tool_call(tool_calls, piece)

            # Extrai também raciocínio inline (<think> / <|channel>thought)
            # do content, alimentando o buffer para não perder marcadores
            # que venham divididos entre chunks.
            content = stream_content_field(data)
            if content:
                inline_reasoning, plain_text = split_reasoning_from_content(
                    content, inline_buffer
                )
                if inline_reasoning:
                    reasoning_chunks.append(inline_reasoning)
                if plain_text:
                    first_text = plain_text
                    break
                # Sem plain_text ainda: pode ser um chunk com <think>
                # parcial. Continua sondando.
                continue

            # Não há content neste chunk. Só vale chamar extract_text
            # se o buffer não está esperando o resto de um bloco de
            # pensamento (caso contrário, o texto que chegar depois
            # pode vazar como plain_text antes do </think>).
            if not inline_buffer._inside and not inline_buffer._buffer:
                text = extract_text(data)
                if text:
                    first_text = text
                    break

        # Libera o que ficou acumulado no buffer (caso o raciocínio
        # inline seja o único conteúdo do modelo).
        if first_text is None and not tool_calls:
            tail_reasoning, tail_text = finalize_inline_buffer(inline_buffer)
            if tail_reasoning:
                reasoning_chunks.append(tail_reasoning)
            if tail_text:
                first_text = tail_text

    except requests.RequestException as error:
        print(
            "[NEXA] stream interrompido (%s)."
            % type(error).__name__
        )
        return None

    if first_text is None and not tool_calls and not reasoning_chunks:
        return None

    return reasoning_chunks, first_text, tool_calls, inline_buffer


def stream_chat_events(lines, reasoning_chunks, first_text, tool_calls,
                       user_id, memory_enabled=True, messages=None,
                       memories=None, reasoning=None, custom_instructions="",
                       thinking_report="", deep_report="",
                       inline_buffer=None, system_prompt_override=""):
    """
    Traduz o stream do modelo nos eventos SSE da NEXA. Fica em função
    separada para a pesquisa profunda reaproveitar: lá o relatório entra
    no request_body e o stream segue o mesmo caminho.

    O inline_buffer (opcional) é o mesmo buffer populado pelo
    probe_stream: continuamos acumulando dele para não perder o
    contexto de <think> / <|channel>thought quando o probe terminou
    sem ter visto o delimitador de fim. Se não for passado, um novo
    buffer vazio é criado.
    """
    if inline_buffer is None:
        inline_buffer = InlineThoughtBuffer()

    def generate():
        full_text = ""
        reason = None
        memory_updated = False
        searched = False

        try:
            if thinking_report:
                yield sse({
                    "type": "reasoning",
                    "text": "Agente de pensamento:\n\n"
                            + thinking_report + "\n\n",
                })

            for thinking in reasoning_chunks:
                yield sse({"type": "reasoning", "text": thinking})

            if first_text:
                full_text = first_text
                yield sse({"type": "text", "text": first_text})

            for raw in lines:
                data = parse_data_line(raw)

                if not data:
                    continue

                reason = finish_reason(data) or reason

                thinking = extract_reasoning(data)

                if thinking:
                    yield sse({"type": "reasoning", "text": thinking})

                for piece in extract_tool_calls(data):
                    merge_tool_call(tool_calls, piece)

                # Detecta raciocínio inline (<think>, <|channel>thought)
                # no content, acumulando entre chunks para tolerar
                # marcadores divididos pelo streaming.
                content = stream_content_field(data)
                if content:
                    inline_reasoning, plain_text = split_reasoning_from_content(
                        content, inline_buffer
                    )
                    if inline_reasoning:
                        yield sse({"type": "reasoning", "text": inline_reasoning})
                    if plain_text:
                        full_text += plain_text
                        yield sse({"type": "text", "text": plain_text})
                    continue

                # Não há content neste chunk. Só vale chamar extract_text
                # se o buffer não está esperando o resto de um bloco
                # de pensamento (caso contrário, o texto que chegar
                # depois pode vazar como plain_text antes do </think>).
                if not inline_buffer._inside:
                    text = extract_text(data)

                    if not text:
                        continue

                    full_text += text
                    yield sse({"type": "text", "text": text})

            # Libera o que sobrou no buffer no fim do stream.
            tail_reasoning, tail_text = finalize_inline_buffer(inline_buffer)
            if tail_reasoning:
                yield sse({"type": "reasoning", "text": tail_reasoning})
            if tail_text:
                full_text += tail_text
                yield sse({"type": "text", "text": tail_text})

            if reason == "length":
                print(
                    "[NEXA] resposta cortada por limite de tokens "
                    "(MAX_OUTPUT_TOKENS=%d). Aumente no .env se precisar."
                    % MAX_OUTPUT_TOKENS
                )

            if memory_enabled and tool_calls:
                # A busca pode insistir por até 2 minutos. Como o gerador
                # ficaria parado, o proxy cortaria a conexão. Rodamos as
                # ferramentas numa thread e vamos emitindo keep-alive no SSE
                # enquanto ela trabalha.
                box = {}

                def worker():
                    try:
                        box["result"] = finish_stream_with_tools(
                            user_id,
                            messages or [],
                            memories or [],
                            reasoning,
                            custom_instructions,
                            full_text,
                            tool_calls,
                            memory_enabled,
                            thinking_report,
                            deep_report,
                            system_prompt_override,
                        )
                    except Exception as error:  # noqa: BLE001
                        print("[NEXA] falha inesperada nas ferramentas:", error)
                        box["result"] = (None, False, False)

                pump = threading.Thread(target=worker, daemon=True)
                pump.start()

                while pump.is_alive():
                    pump.join(timeout=SEARCH_HEARTBEAT)
                    if pump.is_alive():
                        yield sse({"type": "ping"})

                follow_up, memory_updated, searched = box.get(
                    "result", (None, False, False)
                )

                if follow_up:
                    yield sse({"type": "text", "text": follow_up})

                if searched:
                    yield sse({"type": "search"})

                if memory_updated:
                    yield sse({"type": "memory"})

            yield sse({"type": "done", "model": model_for_reasoning(reasoning)})

        except requests.RequestException as error:
            print("[NEXA] erro durante o stream:", error)
            yield sse({"type": "error", "error": "Erro durante a resposta da NEXA."})

    return generate()


def make_stream_response(lines, user_id, user_message, memory_enabled=True,
                         messages=None, memories=None, reasoning=None,
                         custom_instructions="", thinking_report="",
                         system_prompt_override=""):
    probe = probe_stream(lines)

    if probe is None:
        return None

    reasoning_chunks, first_text, tool_calls, inline_buffer = probe

    return Response(
        stream_with_context(
            stream_chat_events(
                lines, reasoning_chunks, first_text, tool_calls,
                user_id, memory_enabled, messages, memories, reasoning,
                custom_instructions,
                thinking_report,
                inline_buffer=inline_buffer,
                system_prompt_override=system_prompt_override,
            )
        ),
        headers=sse_headers(),
    )


def make_deep_response(user_id, user_message, messages, memories, reasoning,
                       custom_instructions="", memory_enabled=True,
                       thinking_report="", system_prompt_override=""):
    """
    Pesquisa profunda pedida pelo botão "+" do composer: a pergunta vai
    direto para o pesquisador (agente separado, sem o contexto da
    conversa) e, com o relatório em mãos, o modelo normal escreve a
    resposta final. O ping do SSE segura a conexão durante a investigação.
    """
    agent = get_deep_settings(user_id)["agent"]

    def generate():
        yield sse({
            "type": "reasoning",
            "text": "Pesquisa profunda em andamento: %s está investigando "
                    "o tema. Isso pode demorar um pouco.\n\n" % agent,
        })

        box = {}
        progress = queue.Queue()

        def worker():
            try:
                visual_report = ""
                if thinking_report:
                    research_topic = interpret_deep_intent(
                        user_id, thinking_report, [], reasoning, progress.put,
                        "",
                    )
                    box["report"] = run_deep_research(
                        user_id, research_topic or thinking_report,
                        progress.put, reasoning
                    )
                    return
                if message_has_image(messages):
                    progress.put("O agente visual está analisando a imagem antes da pesquisa.")
                    visual_messages = analyze_image_for_text_model(messages, reasoning)
                    visual_content = visual_messages[-1].get("content", "")
                    if isinstance(visual_content, str):
                        marker = "Relatório do agente visual (use como contexto da imagem):"
                        if marker in visual_content:
                            visual_report = visual_content.split(marker, 1)[1].strip()

                research_topic = interpret_deep_intent(
                    user_id, user_message, messages, reasoning, progress.put,
                    visual_report,
                )
                box["report"] = run_deep_research(
                    user_id, research_topic or user_message, progress.put, reasoning
                )
            except Exception as error:  # noqa: BLE001
                print("[NEXA-PROFUNDA] falha inesperada:", error)
                box["report"] = (
                    "A pesquisa profunda falhou. Avise o usuário que não "
                    "deu certo e responda com o que você já sabe."
                )

        pump = threading.Thread(target=worker, daemon=True)
        pump.start()

        last_ping = time.monotonic()

        while pump.is_alive():
            pump.join(timeout=1)

            # A cadeia de pensamento anda a cada passo do pesquisador.
            while not progress.empty():
                yield sse({
                    "type": "reasoning",
                    "text": progress.get() + "\n\n",
                })

            if (
                pump.is_alive()
                and time.monotonic() - last_ping >= SEARCH_HEARTBEAT
            ):
                last_ping = time.monotonic()
                yield sse({"type": "ping"})

        while not progress.empty():
            yield sse({
                "type": "reasoning",
                "text": progress.get() + "\n\n",
            })

        report = box.get("report") or ""
        final_thinking_report = ""

        yield sse({"type": "search"})

        if reasoning in THINKING_AGENT_ROUNDS and reasoning != "none":
            yield sse({
                "type": "reasoning",
                "text": (
                    "%s terminou o relatório. Agora o agente de pensamento "
                    "vai revisar o material sem fazer novas pesquisas.\n\n"
                ) % agent,
            })
            thinking_box = {}
            thinking_progress = queue.Queue()

            def thinking_worker():
                try:
                    thinking_box["report"] = run_thinking_agent(
                        user_id,
                        messages,
                        memories,
                        reasoning,
                        thinking_progress.put,
                        initial_deep_report=report,
                        block_research=True,
                    )
                except Exception as error:  # noqa: BLE001
                    print("[NEXA-PENSAMENTO] falha após pesquisa profunda:", error)
                    thinking_progress.put(
                        "O agente de pensamento não conseguiu concluir a revisão: "
                        "%s" % str(error)[:160]
                    )
                    thinking_box["report"] = ""

            thinking_pump = threading.Thread(target=thinking_worker, daemon=True)
            thinking_pump.start()
            thinking_last_ping = time.monotonic()

            while thinking_pump.is_alive():
                thinking_pump.join(timeout=0.5)
                while not thinking_progress.empty():
                    yield sse({
                        "type": "reasoning",
                        "text": thinking_progress.get() + "\n\n",
                    })
                if time.monotonic() - thinking_last_ping >= SEARCH_HEARTBEAT:
                    thinking_last_ping = time.monotonic()
                    yield sse({"type": "ping"})

            while not thinking_progress.empty():
                yield sse({
                    "type": "reasoning",
                    "text": thinking_progress.get() + "\n\n",
                })

            final_thinking_report = thinking_box.get("report") or ""
            yield sse({
                "type": "reasoning",
                "text": (
                    "Agente de pensamento concluiu a revisão. A NEXA está "
                    "escrevendo a resposta final.\n\n"
                ),
            })
        else:
            yield sse({
                "type": "reasoning",
                "text": "%s terminou o relatório. A NEXA está escrevendo a "
                        "resposta.\n\n" % agent,
            })

        try:
            upstream = requests.post(
                API_BASE + "/chat/completions",
                headers=auth_headers(),
                json=request_body(
                    True, messages, memories, reasoning, custom_instructions,
                    memory_enabled, user_id, report,
                    thinking_report=final_thinking_report,
                    system_prompt_override=system_prompt_override,
                ),
                stream=True,
                timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
            )
        except requests.RequestException as error:
            print("[NEXA-PROFUNDA] modelo principal falhou:", error)
            upstream = None

        if upstream is None or upstream.status_code != 200:
            if upstream is not None:
                log_upstream_error(upstream)
                upstream.close()
            yield sse({
                "type": "error",
                "error": (
                    "A pesquisa terminou, mas a NEXA não conseguiu escrever "
                    "a resposta. Tente de novo."
                ),
            })
            return

        lines = upstream.iter_lines(decode_unicode=False)
        probe = probe_stream(lines)

        if probe is None:
            upstream.close()
            yield sse({
                "type": "error",
                "error": (
                    "A pesquisa terminou, mas a NEXA não conseguiu escrever "
                    "a resposta. Tente de novo."
                ),
            })
            return

        reasoning_chunks, first_text, tool_calls, inline_buffer = probe

        yield from stream_chat_events(
            lines, reasoning_chunks, first_text, tool_calls, user_id,
            memory_enabled, messages, memories, reasoning,
            custom_instructions,
            final_thinking_report,
            report,
            inline_buffer=inline_buffer,
            system_prompt_override=system_prompt_override,
        )

    return Response(stream_with_context(generate()), headers=sse_headers())


def make_thinking_response(
    user_id, user_message, messages, memories, reasoning,
    custom_instructions="", memory_enabled=True,
    system_prompt_override="",
):
    """Executa o agente de pensamento em segundo plano e transmite progresso."""
    def generate():
        box = {}
        progress = queue.Queue()

        def worker():
            try:
                box["report"] = run_thinking_agent(
                    user_id, messages, memories, reasoning, progress.put
                )
            except Exception as error:  # noqa: BLE001
                print("[NEXA-PENSAMENTO] falha inesperada: %s" % error)
                progress.put(
                    "O agente de pensamento encontrou uma falha e encerrou a "
                    "revisão: %s" % str(error)[:160]
                )
                box["report"] = ""

        yield sse({
            "type": "reasoning",
            "text": "Agente de pensamento iniciado. Vou revisar a solução antes de responder.\n\n",
        })
        pump = threading.Thread(target=worker, daemon=True)
        pump.start()
        last_ping = time.monotonic()

        while pump.is_alive():
            pump.join(timeout=0.5)
            while not progress.empty():
                yield sse({"type": "reasoning", "text": progress.get() + "\n\n"})
            if time.monotonic() - last_ping >= SEARCH_HEARTBEAT:
                last_ping = time.monotonic()
                yield sse({"type": "ping"})

        while not progress.empty():
            yield sse({"type": "reasoning", "text": progress.get() + "\n\n"})

        report = box.get("report") or ""
        yield sse({
            "type": "reasoning",
            "text": "Agente de pensamento concluiu a revisão. Gerando a resposta final.\n\n",
        })

        try:
            upstream = requests.post(
                API_BASE + "/chat/completions",
                headers=auth_headers(),
                json=request_body(
                    True, messages, memories, reasoning, custom_instructions,
                    memory_enabled, user_id, thinking_report=report,
                    system_prompt_override=system_prompt_override,
                ),
                stream=True,
                timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
            )
        except requests.RequestException as error:
            print("[NEXA] modelo após pensamento falhou: %s" % error)
            yield sse({"type": "error", "error": "Falha ao consultar o modelo."})
            return

        if upstream.status_code != 200:
            log_upstream_error(upstream)
            upstream.close()
            yield sse({"type": "error", "error": "Falha ao consultar o modelo."})
            return

        lines = upstream.iter_lines(decode_unicode=False)
        probe = probe_stream(lines)
        if probe is None:
            upstream.close()
            yield sse({"type": "error", "error": "O modelo não devolveu resposta."})
            return

        reasoning_chunks, first_text, tool_calls, inline_buffer = probe
        yield from stream_chat_events(
            lines, reasoning_chunks, first_text, tool_calls, user_id,
            memory_enabled, messages, memories, reasoning,
            custom_instructions, report,
            inline_buffer=inline_buffer,
            system_prompt_override=system_prompt_override,
        )

    return Response(stream_with_context(generate()), headers=sse_headers())


def make_blocking_response(
    user_id, user_message, messages, memories, reasoning,
    custom_instructions="", memory_enabled=True, thinking_report="",
    system_prompt_override="",
):
    try:
        response = requests.post(
            API_BASE + "/chat/completions",
            headers=auth_headers(),
            json=request_body(
                False, messages, memories, reasoning, custom_instructions,
                memory_enabled, user_id, thinking_report=thinking_report,
                system_prompt_override=system_prompt_override,
            ),
            timeout=(10, 60),
        )

    except requests.RequestException as error:
        print("[NEXA] falha ao consultar o modelo:", error)
        return jsonify({"error": "Falha ao consultar o modelo."}), 502

    if response.status_code != 200:
        log_upstream_error(response)
        return jsonify({
            "error": "Falha ao consultar o modelo (HTTP %d)." % response.status_code
        }), 502

    try:
        payload = response.json()
    except ValueError:
        payload = {}

    if finish_reason(payload) == "length":
        print(
            "[NEXA] resposta cortada por limite de tokens "
            "(MAX_OUTPUT_TOKENS=%d). Aumente no .env se precisar."
            % MAX_OUTPUT_TOKENS
        )

    text = extract_text(payload)
    thinking = extract_reasoning(payload).strip()
    calls = extract_tool_calls(payload)

    if not text.strip() and not calls:
        return jsonify({"error": "O modelo respondeu sem texto."}), 502

    follow_up = ""
    memory_updated = False
    searched = False
    if calls:
        follow_up, memory_updated, searched = finish_stream_with_tools(
            user_id, messages, memories, reasoning,
            custom_instructions, text, calls, memory_enabled,
            thinking_report,
            system_prompt_override=system_prompt_override,
        )
        follow_up = follow_up or ""

    def generate():
        if thinking_report:
            yield sse({
                "type": "reasoning",
                "text": "Agente de pensamento:\n\n"
                        + thinking_report + "\n\n",
            })

        if thinking:
            yield sse({"type": "reasoning", "text": thinking})

        if text:
            yield sse({"type": "text", "text": text})

        if follow_up:
            yield sse({"type": "text", "text": follow_up})

        if searched:
            yield sse({"type": "search"})

        if memory_updated:
            yield sse({"type": "memory"})

        yield sse({"type": "done", "model": model_for_reasoning(reasoning)})

    return Response(stream_with_context(generate()), headers=sse_headers())
