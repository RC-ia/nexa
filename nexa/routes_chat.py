"""Rotas do chat principal (/api/chat e /api/chat/title)."""
from .chatflow import make_blocking_response
from .llm import log_upstream_error
from .chatflow import make_stream_response
from .config import STREAM_TIMEOUT
from .config import CONNECT_TIMEOUT
from .llm import request_body
from .llm import auth_headers
from .config import API_BASE
from .chatflow import make_thinking_response
from .config import THINKING_AGENT_ROUNDS
from .chatflow import make_deep_response
from .prompts import current_spicy_prompt
from .memory import get_memories
import requests
from .agents import analyze_image_for_text_model
from .agents import degrade_images
from .llm import message_has_image
from .config import MAX_FILE_BYTES
from .config import ALLOWED_FILE_EXTENSIONS
from pathlib import Path
import os
from .config import MAX_HISTORY_MESSAGES
from .llm import normalize_reasoning_level
from .llm import generate_chat_title
from .webhelpers import request_json_object
from .config import API_KEY
from .webhelpers import message_key_error
from flask import jsonify
from auth import current_user
from .app import app


@app.post("/api/chat/title")
def chat_title():
    user = current_user()

    if user is None:
        return jsonify({"error": "Faça login para conversar com a NEXA."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    if not API_KEY:
        return jsonify({"error": "API_KEY não configurada no arquivo .env."}), 500

    body = request_json_object()

    message = body.get("message", "")
    message = message.strip() if isinstance(message, str) else ""
    if not message:
        return jsonify({"error": "Mensagem não fornecida."}), 400

    title = generate_chat_title(message)
    if title:
        return jsonify({"title": title})

    fallback = message[:42] + ("…" if len(message) > 42 else "")
    return jsonify({"title": fallback})


@app.post("/api/chat")
def chat():
    user = current_user()

    if user is None:
        return jsonify({"error": "Faça login para conversar com a NEXA."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    if not API_KEY:
        return jsonify({"error": "API_KEY não configurada no arquivo .env."}), 500

    body = request_json_object()

    # A memória fica presa à conta logada; o userId vindo do navegador é ignorado.
    user_id = "acct_%d" % user["id"]

    reasoning = body.get("reasoning")
    reasoning = reasoning.strip() if isinstance(reasoning, str) else ""
    reasoning = normalize_reasoning_level(reasoning)

    memory_enabled = body.get("memoryEnabled") is not False
    custom_instructions = body.get("customInstructions", "")
    custom_instructions = (
        custom_instructions.strip()[:2000]
        if isinstance(custom_instructions, str)
        else ""
    )

    incoming = body.get("messages")
    if not isinstance(incoming, list):
        incoming = body.get("history")
    if not isinstance(incoming, list):
        incoming = []

    direct_message = body.get("message")
    direct_message = direct_message.strip() if isinstance(direct_message, str) else ""

    def text_content(content):
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            return " ".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ).strip()
        return ""

    already_present = any(
        isinstance(message, dict)
        and message.get("role") == "user"
        and text_content(message.get("content")) == direct_message
        for message in incoming
    )

    if direct_message and not already_present:
        incoming = incoming + [{"role": "user", "content": direct_message}]

    user_message = direct_message
    if not user_message:
        for message in reversed(incoming):
            if isinstance(message, dict) and message.get("role") == "user":
                user_message = text_content(message.get("content"))
                break

    messages = []
    for message in incoming[-MAX_HISTORY_MESSAGES:]:
        if not isinstance(message, dict):
            continue

        content = message.get("content")
        if isinstance(content, list):
            safe_content = content
        else:
            safe_content = str(content or "").strip()
        if not safe_content:
            continue

        role = "assistant" if message.get("role") in ("assistant", "model") else "user"
        messages.append({"role": role, "content": safe_content})

    attached_file = body.get("file")
    if attached_file is not None:
        if not isinstance(attached_file, dict):
            return jsonify({"error": "Arquivo inválido."}), 400
        file_name = os.path.basename(str(attached_file.get("name") or ""))
        extension = Path(file_name).suffix.lower()
        file_text = attached_file.get("text")
        if (
            not file_name
            or extension not in ALLOWED_FILE_EXTENSIONS
            or not isinstance(file_text, str)
            or len(file_text.encode("utf-8")) > MAX_FILE_BYTES
        ):
            return jsonify({"error": "Arquivo inválido, executável ou grande demais."}), 400
        if not messages or messages[-1]["role"] != "user":
            return jsonify({"error": "O arquivo precisa acompanhar uma mensagem."}), 400
        text_content = messages[-1]["content"]
        messages[-1]["content"] = (
            "Arquivo anexado: %s\n\nConteúdo do arquivo:\n%s\n\nMensagem do usuário: %s"
            % (file_name, file_text, text_content)
        )

    image = body.get("image")
    if image is not None:
        if not isinstance(image, dict):
            return jsonify({"error": "Imagem inválida."}), 400
        data_url = image.get("dataUrl")
        if (
            not isinstance(data_url, str)
            or not data_url.startswith("data:image/")
            or len(data_url) > 11 * 1024 * 1024
        ):
            return jsonify({"error": "Imagem inválida ou grande demais."}), 400
        if not messages or messages[-1]["role"] != "user":
            return jsonify({"error": "A imagem precisa acompanhar uma mensagem."}), 400
        text_content = messages[-1]["content"]
        messages[-1]["content"] = [
            {"type": "text", "text": text_content},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]

    if not messages:
        return jsonify({"error": "Nenhuma mensagem foi enviada para a NEXA."}), 400

    if message_has_image(messages):
        try:
            messages = analyze_image_for_text_model(messages, reasoning)
        except (requests.RequestException, RuntimeError) as error:
            # Degradar em vez de 502: o modelo normal responde pelo texto
            # e avisa que a imagem não pôde ser analisada.
            print(
                "[NEXA-VISÃO] falha ao analisar imagem (%s); seguindo sem "
                "a imagem." % error
            )
            messages = degrade_images(messages)

    memories = get_memories(user_id) if memory_enabled else []

    # Flag `spicy` do corpo: agente safadinho assume com system prompt
    # próprio em todos os caminhos de resposta (stream, bloqueante,
    # pensamento e pesquisa profunda). O botão 😈 hoje só existe no modo
    # imagem (e comanda /api/images/generate); a flag continua aceita aqui
    # por retrocompatibilidade.
    spicy = body.get("spicy") is True
    spicy_override = current_spicy_prompt(user_id) if spicy else ""

    # Botão "+" do composer: manda a pergunta direto para o pesquisador e
    # devolve o relatório para o modelo normal escrever a resposta.
    if body.get("deep") is True and user_message:
        return make_deep_response(
            user_id, user_message, messages, memories, reasoning,
            custom_instructions, memory_enabled,
            system_prompt_override=spicy_override,
        )

    if reasoning in THINKING_AGENT_ROUNDS and reasoning != "none":
        return make_thinking_response(
            user_id, user_message, messages, memories, reasoning,
            custom_instructions, memory_enabled,
            system_prompt_override=spicy_override,
        )

    thinking_report = ""
    try:
        upstream = requests.post(
            API_BASE + "/chat/completions",
            headers=auth_headers(),
            json=request_body(
                True, messages, memories, reasoning, custom_instructions,
                memory_enabled, user_id, thinking_report=thinking_report,
                system_prompt_override=spicy_override,
            ),
            stream=True,
            timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
        )

    except requests.RequestException as error:
        print(
            "[NEXA] stream não respondeu em %ds (%s). Indo pelo caminho bloqueante."
            % (STREAM_TIMEOUT, type(error).__name__)
        )
        upstream = None

    if upstream is not None and upstream.status_code == 200:
        streamed = make_stream_response(
            upstream.iter_lines(decode_unicode=False),
            user_id,
            user_message,
            memory_enabled,
            messages,
            memories,
            reasoning,
            custom_instructions,
            thinking_report,
            system_prompt_override=spicy_override,
        )

        if streamed is not None:
            return streamed

        upstream.close()

    elif upstream is not None:
        log_upstream_error(upstream)
        upstream.close()

    return make_blocking_response(
        user_id, user_message, messages, memories, reasoning,
        custom_instructions, memory_enabled, thinking_report,
        system_prompt_override=spicy_override,
    )
