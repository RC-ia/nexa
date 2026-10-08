"""Sincronização de conversas por conta (rev, limites e merge no cliente)."""
import json
from .config import MEMORY_DIR
import threading


CHATS_LOCK = threading.Lock()


CHATS_LIMIT = 500


CHAT_MESSAGES_LIMIT = 5000


CHAT_CONTENT_LIMIT = 200000


CHATS_MAX_BYTES = 5 * 1024 * 1024


def chats_path(user_id):
    safe_id = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )
    return MEMORY_DIR / ("%s.chats.json" % safe_id)


def load_chats(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    chats = data.get("chats") if isinstance(data, dict) else None
    return chats if isinstance(chats, list) else []


def save_chats(path, chats):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps({"chats": chats}, ensure_ascii=False), encoding="utf-8"
    )
    temporary.replace(path)


def sanitize_chat(chat_id, chat):
    """Valida e normaliza a conversa vinda do cliente (None se inválida)."""
    if not isinstance(chat, dict) or not chat_id or len(chat_id) > 100:
        return None
    if chat.get("id") != chat_id:
        return None

    title = chat.get("title")
    if not isinstance(title, str):
        title = ""

    messages = chat.get("messages")
    if not isinstance(messages, list) or len(messages) > CHAT_MESSAGES_LIMIT:
        return None

    clean_messages = []
    for item in messages:
        if not isinstance(item, dict):
            return None

        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "model") or not isinstance(content, str):
            return None
        if len(content) > CHAT_CONTENT_LIMIT:
            return None

        message = {"role": role, "content": content}

        message_id = item.get("id")
        if isinstance(message_id, str) and message_id:
            message["id"] = message_id[:64]

        thinking = item.get("thinking")
        if isinstance(thinking, str) and thinking:
            message["thinking"] = thinking[:CHAT_CONTENT_LIMIT]

        if item.get("memoryUpdated") is True:
            message["memoryUpdated"] = True
        if item.get("searched") is True:
            message["searched"] = True

        clean_messages.append(message)

    def as_int(value):
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value)
        return 0

    return {
        "id": chat_id,
        "title": title[:300],
        "createdAt": as_int(chat.get("createdAt")),
        "updatedAt": as_int(chat.get("updatedAt")),
        "messages": clean_messages,
    }
