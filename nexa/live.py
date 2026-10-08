"""Chamada Gemini Live: vozes, token efêmero e execução de ferramentas."""
from .websearch import fetch_pages
from .reminders import create_reminder
from .websearch import format_search_results
from .websearch import run_web_search
import requests
from datetime import datetime, timedelta, timezone
from .usertime import current_time_text
from .webhelpers import request_json_object
from .config import API_GEMA
from .webhelpers import message_key_error
from flask import jsonify
from auth import current_user
from .app import app
import os


LIVE_MODEL = "models/gemini-3.8-live"


DEFAULT_LIVE_VOICE = "Kore"


LIVE_VOICES = {
    "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
    "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
    "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
    "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
    "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
}


LIVE_SYSTEM_PROMPT = (
    "Você é NEXA, uma assistente em uma chamada de voz. "
    "Fale naturalmente em português brasileiro, com respostas diretas, "
    "curiosas e amigáveis. Não diga que é uma pessoa real. "
    "Prefira respostas curtas, de voz. Quando precisar de informação "
    "nova ou verificável, use a ferramenta pesquisar em vez de chutar, "
    "avisando antes em uma frase curta que vai verificar. Você também "
    "pode ler páginas com visitar_pagina, ver a data e a hora com "
    "data_hora e criar lembretes com criar_lembrete."
)


LIVE_TOOL_DECLARATIONS = [
    {
        "name": "pesquisar",
        "description": (
            "Pesquisa fatos atuais na web e devolve títulos, trecho de "
            "texto e link de cada resultado. Use sempre que precisar de "
            "informação nova ou verificável."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "termo": {
                    "type": "string",
                    "description": (
                        "Termo de busca curto e direto, como alguém "
                        "digitaria no buscador."
                    ),
                },
            },
            "required": ["termo"],
        },
    },
    {
        "name": "visitar_pagina",
        "description": (
            "Abre páginas dos resultados da última busca (prefixos P1, "
            "P2...) e devolve o texto principal. Use quando o trecho da "
            "busca não bastar."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "paginas": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Prefixos das páginas, ex.: [\"P1\"].",
                },
            },
            "required": ["paginas"],
        },
    },
    {
        "name": "data_hora",
        "description": (
            "Devolve a data e a hora atuais do usuário, no fuso "
            "horário configurado por ele."
        ),
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "criar_lembrete",
        "description": (
            "Cria um lembrete que dispara sozinho no horário definido: "
            "um agente cumpre a tarefa e avisa o usuário."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tipo": {
                    "type": "string",
                    "enum": ["recorrente", "unico"],
                    "description": (
                        "recorrente: repete no tempo. unico: dispara "
                        "uma vez e acaba."
                    ),
                },
                "tarefa": {
                    "type": "string",
                    "description": (
                        "Instrução completa para o agente do lembrete, "
                        "incluindo o que o usuário deve receber no "
                        "disparo."
                    ),
                },
                "instrucao": {
                    "type": "string",
                    "description": (
                        "Opcional. Para lembretes de ação: o que o "
                        "agente deve EXECUTAR no disparo, com busca na "
                        "web; o resultado vira a mensagem."
                    ),
                },
                "frequencia": {
                    "type": "string",
                    "enum": ["hora_em_hora", "diario", "semanal", "mensal"],
                    "description": (
                        "Só para recorrente: de quanto em quanto tempo "
                        "repete."
                    ),
                },
                "hora": {
                    "type": "string",
                    "description": (
                        "Horário HH:MM (24h). Obrigatório para diario, "
                        "semanal e mensal."
                    ),
                },
                "dia_semana": {
                    "type": "integer",
                    "description": (
                        "Só para recorrente semanal: 0=domingo, 1=segunda,"
                        " ... 6=sábado."
                    ),
                },
                "dia_mes": {
                    "type": "integer",
                    "description": (
                        "Só para recorrente mensal: dia do mês, de 1 a 31."
                    ),
                },
                "quando": {
                    "type": "string",
                    "description": (
                        "Só para único: data e hora local no formato "
                        "YYYY-MM-DDTHH:MM, com base na data e hora atuais "
                        "do prompt."
                    ),
                },
            },
            "required": ["tipo", "tarefa"],
        },
    },
]


LIVE_TOOL_NAMES = ("pesquisar", "visitar_pagina", "data_hora", "criar_lembrete")


LIVE_SEARCH_PATIENCE = int(os.environ.get("LIVE_SEARCH_PATIENCE", "20"))


@app.get("/api/live/voices")
def list_live_voices():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver as vozes."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    return jsonify({
        "voices": sorted(LIVE_VOICES),
        "default": DEFAULT_LIVE_VOICE,
        "model": LIVE_MODEL,
        "enabled": bool(API_GEMA),
    })


@app.post("/api/live/token")
def create_live_token():
    user = current_user()

    if user is None:
        return jsonify({"error": "Faça login para iniciar uma chamada."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    if not API_GEMA:
        return jsonify({"error": "API_GEMA não configurada no arquivo .env."}), 503

    body = request_json_object()
    voice = body.get("voice", DEFAULT_LIVE_VOICE)
    if not isinstance(voice, str) or voice not in LIVE_VOICES:
        return jsonify({"error": "Voz Gemini inválida."}), 400

    # O modelo da voz não passa pelo prompt do chat: injetamos a hora do
    # usuário para ele calcular lembretes sem precisar de ferramenta.
    live_prompt = LIVE_SYSTEM_PROMPT + "\n\n" + current_time_text(user["id"])

    now = datetime.now(timezone.utc)
    token_config = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=30)).isoformat().replace("+00:00", "Z"),
        "newSessionExpireTime": (now + timedelta(seconds=55)).isoformat().replace("+00:00", "Z"),
        "bidiGenerateContentSetup": {
            "model": LIVE_MODEL,
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice}
                    }
                },
            },
            "systemInstruction": {"parts": [{"text": live_prompt}]},
            "tools": [{"functionDeclarations": LIVE_TOOL_DECLARATIONS}],
        },
    }

    try:
        response = requests.post(
            "https://generativelanguage.googleapis.com/v1alpha/auth_tokens",
            headers={"x-goog-api-key": API_GEMA},
            json=token_config,
            timeout=(10, 20),
        )
    except requests.RequestException as error:
        print("[NEXA-LIVE] falha ao emitir token: %s" % error)
        return jsonify({"error": "Não foi possível iniciar a chamada Gemini Live."}), 502

    if response.status_code not in (200, 201):
        print(
            "[NEXA-LIVE] emissão de token HTTP %d: %s"
            % (response.status_code, response.text[:500])
        )
        try:
            error_data = response.json().get("error", {})
            detail = error_data.get("message", "")
        except (ValueError, AttributeError):
            detail = ""

        if not detail:
            detail = "Resposta não JSON (%s)." % response.headers.get(
                "Content-Type", "tipo desconhecido"
            )

        return jsonify({
            "error": "Gemini Live HTTP %d: %s"
            % (response.status_code, str(detail)[:300])
        }), 502

    try:
        token_name = response.json().get("name", "")
    except ValueError:
        token_name = ""

    if not token_name:
        print("[NEXA-LIVE] resposta de token sem campo name.")
        return jsonify({"error": "O Gemini retornou uma credencial inválida."}), 502

    return jsonify({
        "token": token_name,
        "model": LIVE_MODEL,
        "voice": voice,
        "systemInstruction": live_prompt,
    })


@app.post("/api/live/tool")
def live_tool():
    """
    Executa as ferramentas pedidas pelo modelo durante a chamada de voz.
    O live.js manda o toolCall do Gemini e devolve a resposta na sessão.
    """
    user = current_user()

    if user is None:
        return jsonify({"error": "Faça login para usar as ferramentas da chamada."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()
    calls = body.get("calls", [])
    if not isinstance(calls, list):
        return jsonify({"error": "Lista de ferramentas inválida."}), 400
    results = []

    for index, call in enumerate(calls):
        if not isinstance(call, dict):
            continue

        name = call.get("name") or ""
        call_id = call.get("id") or "live_%d" % index
        arguments = call.get("arguments")
        if not isinstance(arguments, dict):
            arguments = {}

        if name == "data_hora":
            text = current_time_text(user["id"])
        elif name == "pesquisar":
            term = arguments.get("termo")
            if not isinstance(term, str):
                term = ""
            findings, error = run_web_search(term, patience=LIVE_SEARCH_PATIENCE)
            if findings:
                text = format_search_results(term, findings, user["id"])
            elif error:
                text = error
            else:
                text = "A pesquisa não retornou nada útil."
            print(
                "[NEXA-LIVE] pesquisar %r -> %d resultado(s)%s"
                % (term, len(findings), " (%s)" % error if error else "")
            )
        elif name == "criar_lembrete":
            text, created = create_reminder(user["id"], arguments)
            print(
                "[NEXA-LIVE] criar_lembrete: %s"
                % ("criado" if created else text)
            )
        elif name == "visitar_pagina":
            paginas = arguments.get("paginas")
            if not isinstance(paginas, list):
                paginas = []
            text = fetch_pages(user["id"], paginas)
        else:
            text = "Ferramenta desconhecida: %s." % (name or "sem nome")

        results.append({
            "id": call_id,
            "name": name,
            "text": text or "Sem resultado.",
        })

    return jsonify({"results": results})
