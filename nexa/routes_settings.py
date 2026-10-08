"""Rotas de configurações: system prompt, pesquisa profunda, agentes,
fuso, memórias, lembretes, conversas e push."""
from .push import get_push_tokens
from .push import GOOGLE_AUTH_AVAILABLE
from .push import FCM_KEY_FILE
from .push import save_push_token
from auth import user_from_message_key
from .chatsync import save_chats
import json
from .chatsync import CHATS_LIMIT
from .chatsync import sanitize_chat
from .chatsync import CHATS_MAX_BYTES
from .chatsync import chats_path
from .chatsync import load_chats
from .chatsync import CHATS_LOCK
from .reminders import pending_reminders_since
from .reminders import take_pending_reminders
from flask import request
from .reminders import delete_reminder
from .reminders import user_reminders
from .memory import clear_memory
from .memory import save_memory
from .memory import MEMORY_FILE_LIMIT
from datetime import datetime, timezone
from .memory import memory_path
from .memory import get_memories
from .usertime import save_time_settings
from .usertime import get_time_settings
from .reminders import REMINDER_ACTION_ROUNDS
from .prompts import current_spicy_prompt
from .images import IMAGE_PROMPT_AGENT
from .images import IMAGE_PROMPT_AGENT_PROMPT
from .images import image_prompt_agent_model
from .config import DEEP_INTENT_PROMPT
from .config import VISION_AGENT_PROMPT
from .config import VISION_MODEL
from .llm import model_for_reasoning
from .config import MODEL
from .config import THINKING_AGENT_MAX_TOKENS
from .config import THINKING_AGENT_ROUNDS
from .settings import save_deep_settings
from .config import DEEP_ROUNDS_LIMIT
from .settings import get_deep_settings
from .prompts import SYSTEM_PROMPT_LOCK
from .prompts import system_prompt_path
from .config import SYSTEM_PROMPT_MAX
from .webhelpers import request_json_object
from .prompts import get_custom_system_prompt
from .prompts import current_system_prompt
from .webhelpers import message_key_error
from flask import jsonify
from auth import current_user
from .app import app


@app.get("/api/system-prompt")
def read_system_prompt():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver o system prompt."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    return jsonify({
        "prompt": current_system_prompt(user_id),
        "is_custom": get_custom_system_prompt(user_id) is not None,
    })


@app.put("/api/system-prompt")
def update_system_prompt():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para editar o system prompt."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()
    prompt = body.get("prompt", "")
    if not isinstance(prompt, str):
        return jsonify({"error": "System prompt inválido."}), 400

    prompt = prompt.strip()
    if not prompt:
        return jsonify({"error": "O system prompt não pode ficar vazio."}), 400

    if len(prompt) > SYSTEM_PROMPT_MAX:
        prompt = prompt[:SYSTEM_PROMPT_MAX]

    user_id = "acct_%d" % user["id"]
    path = system_prompt_path(user_id)

    with SYSTEM_PROMPT_LOCK:
        temporary = path.with_suffix(".txt.tmp")
        try:
            temporary.write_text(prompt, encoding="utf-8")
            temporary.replace(path)
        except OSError as error:
            print("[NEXA] falha ao salvar o system prompt:", error)
            return jsonify({"error": "Não foi possível salvar o system prompt."}), 500

    return jsonify({
        "ok": True,
        "prompt": current_system_prompt(user_id),
        "is_custom": True,
    })


@app.delete("/api/system-prompt")
def reset_system_prompt():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para restaurar o system prompt."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]

    with SYSTEM_PROMPT_LOCK:
        try:
            system_prompt_path(user_id).unlink()
        except FileNotFoundError:
            pass
        except OSError as error:
            print("[NEXA] falha ao remover o system prompt:", error)
            return jsonify({"error": "Não foi possível restaurar o system prompt."}), 500

    return jsonify({
        "ok": True,
        "prompt": current_system_prompt(user_id),
        "is_custom": False,
    })


@app.get("/api/deep-settings")
def read_deep_settings():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver a pesquisa profunda."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    return jsonify(get_deep_settings("acct_%d" % user["id"]))


@app.put("/api/deep-settings")
def update_deep_settings():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para editar a pesquisa profunda."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()

    agent = body.get("agent", "")
    if not isinstance(agent, str):
        return jsonify({"error": "Nome do agente inválido."}), 400

    try:
        rounds = int(body.get("rounds"))
    except (TypeError, ValueError):
        return jsonify({
            "error": "Número de rodadas inválido (use de 1 a %d)."
            % DEEP_ROUNDS_LIMIT
        }), 400

    user_id = "acct_%d" % user["id"]

    try:
        settings = save_deep_settings(user_id, agent, rounds)
    except OSError as error:
        print("[NEXA] falha ao salvar a pesquisa profunda:", error)
        return jsonify({"error": "Não foi possível salvar a configuração."}), 500

    return jsonify({"ok": True, **settings})


@app.get("/api/agent-settings")
def read_agent_settings():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver os agentes."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    rounds = {
        level: THINKING_AGENT_ROUNDS[level]
        for level in (
            "minimum", "low", "medium", "high", "veryhigh", "maximum", "ultra"
        )
    }
    return jsonify({
        "thinking": {
            "rounds": ", ".join(
                "%s: %d" % (level, value)
                for level, value in rounds.items()
            ),
            "max_tokens": THINKING_AGENT_MAX_TOKENS,
            "model": MODEL,
        },
        "deep": {
            "model": model_for_reasoning("none"),
        },
        "vision": {
            "model": VISION_MODEL,
            "prompt": VISION_AGENT_PROMPT,
        },
        "intent": {
            "model": model_for_reasoning("none"),
            "prompt": DEEP_INTENT_PROMPT,
        },
        "image_prompt": {
            "model": image_prompt_agent_model(),
            "prompt": IMAGE_PROMPT_AGENT_PROMPT,
            "enabled": IMAGE_PROMPT_AGENT,
        },
        "spicy": {
            "model": MODEL,
            "prompt": current_spicy_prompt("acct_%d" % user["id"]),
        },
        "reminders": {
            "model": model_for_reasoning("none"),
            "rounds": REMINDER_ACTION_ROUNDS,
        },
    })


@app.get("/api/time-settings")
def read_time_settings():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver a data e a hora."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    return jsonify(get_time_settings("acct_%d" % user["id"]))


@app.put("/api/time-settings")
def update_time_settings():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para editar o horário."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()

    try:
        offset = float(body.get("offset"))
    except (TypeError, ValueError):
        return jsonify({
            "error": "Deslocamento inválido: use horas em relação ao UTC, "
            "de -12 a 14 (ex.: -3)."
        }), 400

    if not -12 <= offset <= 14:
        return jsonify({
            "error": "Deslocamento fora do intervalo: use de -12 a 14 horas."
        }), 400

    user_id = "acct_%d" % user["id"]

    try:
        settings = save_time_settings(user_id, offset)
    except OSError as error:
        print("[NEXA] falha ao salvar o fuso horário:", error)
        return jsonify({"error": "Não foi possível salvar a configuração."}), 500

    return jsonify({"ok": True, **settings})


@app.get("/api/memories")
def list_memories():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver as memórias."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    documents = get_memories(user_id)

    try:
        path = memory_path(user_id)
        stat = path.stat()
        created_at = datetime.fromtimestamp(
            stat.st_mtime, timezone.utc
        ).isoformat().replace("+00:00", "Z")
        size = stat.st_size
    except OSError:
        created_at = ""
        size = 0

    return jsonify({
        "memories": [
            {
                "id": "document",
                "memory": documents[0] if documents else "",
                "created_at": created_at,
                "size": size,
            }
        ],
        "limit": MEMORY_FILE_LIMIT,
    })


@app.put("/api/memories")
def replace_memories():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para editar a memória."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()
    document = body.get("document", "")
    if not isinstance(document, str):
        return jsonify({"error": "Documento de memória inválido."}), 400

    document = document.strip()
    if not document:
        return jsonify({"error": "O documento de memória não pode ficar vazio."}), 400

    if not save_memory("acct_%d" % user["id"], document):
        return jsonify({"error": "Não foi possível salvar a memória."}), 500
    return jsonify({"ok": True, "limit": MEMORY_FILE_LIMIT})


@app.delete("/api/memories")
def clear_memories():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para apagar as memórias."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    if not clear_memory("acct_%d" % user["id"]):
        return jsonify({"error": "Não foi possível apagar a memória."}), 500
    return jsonify({"ok": True})


@app.get("/api/reminders")
def list_reminders():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver os lembretes."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    return jsonify({"reminders": user_reminders(user_id)})


@app.delete("/api/reminders/<reminder_id>")
def remove_reminder(reminder_id):
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para apagar lembretes."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    try:
        if not delete_reminder(user_id, reminder_id):
            return jsonify({"error": "Lembrete não encontrado."}), 404
    except OSError as error:
        print("[NEXA-LEMBRETE] falha ao apagar lembrete:", error)
        return jsonify({"error": "Não foi possível apagar o lembrete."}), 500

    return jsonify({"ok": True})


@app.get("/api/reminders/due")
def due_reminders():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para receber lembretes."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]

    since = request.args.get("since")
    if since is None:
        # Cliente antigo, sem cursor: mantém o comportamento de esvaziar.
        try:
            return jsonify({"due": take_pending_reminders(user_id)})
        except OSError as error:
            print("[NEXA-LEMBRETE] falha ao atualizar fila de pendentes:", error)
            return jsonify({"error": "Não foi possível carregar os lembretes."}), 500

    try:
        after_seq = max(0, int(since))
    except (TypeError, ValueError):
        after_seq = 0

    try:
        items = pending_reminders_since(user_id, after_seq)
    except OSError as error:
        print("[NEXA-LEMBRETE] falha ao atualizar fila de pendentes:", error)
        return jsonify({"error": "Não foi possível carregar os lembretes."}), 500
    cursor = max([after_seq] + [item["seq"] for item in items])
    return jsonify({"due": items, "cursor": cursor})


@app.get("/api/chats")
def list_chats():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver as conversas."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    with CHATS_LOCK:
        chats = load_chats(chats_path(user_id))

    return jsonify({"chats": chats})


@app.put("/api/chats/<chat_id>")
def save_chat(chat_id):
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para sincronizar as conversas."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    if request.content_length and request.content_length > CHATS_MAX_BYTES:
        return jsonify({"error": "Conversa grande demais para sincronizar."}), 413

    body = request_json_object()
    if not isinstance(body, dict):
        return jsonify({"error": "Corpo inválido."}), 400

    clean = sanitize_chat(str(chat_id), body.get("chat"))
    if clean is None:
        return jsonify({"error": "Conversa inválida."}), 400

    base_rev = body.get("base_rev")
    if (
        not isinstance(base_rev, int)
        or isinstance(base_rev, bool)
        or base_rev < 0
    ):
        base_rev = 0

    user_id = "acct_%d" % user["id"]
    path = chats_path(user_id)

    with CHATS_LOCK:
        chats = load_chats(path)
        index = next(
            (i for i, item in enumerate(chats) if item.get("id") == chat_id),
            None,
        )

        if index is None:
            if base_rev > 0:
                # A conversa existia e foi apagada em outro aparelho.
                return jsonify({
                    "error": "Conversa apagada em outro aparelho.",
                    "deleted": True,
                }), 410
            if len(chats) >= CHATS_LIMIT:
                return jsonify({
                    "error": "Limite de conversas sincronizadas atingido.",
                }), 400
            new_rev = 1
            chats.append(dict(clean, rev=new_rev))
        else:
            current = chats[index]
            if int(current.get("rev") or 0) != base_rev:
                # Outro aparelho gravou primeiro: devolve a versão atual.
                return jsonify({
                    "error": "Conversa atualizada em outro aparelho.",
                    "chat": current,
                }), 409
            new_rev = base_rev + 1
            chats[index] = dict(clean, rev=new_rev)

        blob = json.dumps({"chats": chats}, ensure_ascii=False)
        if len(blob.encode("utf-8")) > CHATS_MAX_BYTES:
            return jsonify({
                "error": "Conversas grandes demais para sincronizar.",
            }), 413

        try:
            save_chats(path, chats)
        except OSError as error:
            print("[NEXA] falha ao salvar conversas:", error)
            return jsonify({"error": "Falha ao salvar as conversas."}), 500

    return jsonify({"rev": new_rev})


@app.delete("/api/chats/<chat_id>")
def delete_chat(chat_id):
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para sincronizar as conversas."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]
    path = chats_path(user_id)

    with CHATS_LOCK:
        chats = load_chats(path)
        remaining = [item for item in chats if item.get("id") != chat_id]
        if len(remaining) != len(chats):
            try:
                save_chats(path, remaining)
            except OSError as error:
                print("[NEXA] falha ao salvar conversas:", error)
                return jsonify({"error": "Falha ao salvar as conversas."}), 500

    return jsonify({"ok": True})


@app.delete("/api/chats")
def delete_all_chats():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para sincronizar as conversas."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    user_id = "acct_%d" % user["id"]

    with CHATS_LOCK:
        try:
            save_chats(chats_path(user_id), [])
        except OSError as error:
            print("[NEXA] falha ao salvar conversas:", error)
            return jsonify({"error": "Falha ao salvar as conversas."}), 500

    return jsonify({"ok": True})


@app.post("/api/push-token")
def register_push_token():
    user = current_user()

    if user is not None:
        key_error = message_key_error(user)
        if key_error:
            return key_error
    else:
        # App nativo: manda só o header X-Nexa-Message-Key, sem cookie.
        user = user_from_message_key()
        if user is None:
            print("[NEXA] push-token recusado: sessão e chave de mensagem ausentes ou inválidas.")
            return jsonify({"error": "Faça login para ativar as notificações."}), 401

    body = request_json_object()
    token = body.get("token", "")
    if not isinstance(token, str) or not token.strip() or len(token) > 4096:
        return jsonify({"error": "Token de notificação inválido."}), 400

    if not save_push_token("acct_%d" % user["id"], token.strip()):
        return jsonify({"error": "Não foi possível salvar o token de notificação."}), 500
    print("[NEXA] push-token registrado para", user["username"])
    return jsonify({"ok": True})


@app.get("/api/push-status")
def push_status():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para ver o status das notificações."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    return jsonify({
        "key_file": FCM_KEY_FILE.name if FCM_KEY_FILE.exists() else "",
        "google_auth": GOOGLE_AUTH_AVAILABLE,
        "tokens": len(get_push_tokens("acct_%d" % user["id"])),
    })
