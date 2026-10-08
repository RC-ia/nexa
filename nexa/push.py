"""Push de lembretes via Firebase Cloud Messaging (HTTP v1)."""
from .config import STREAM_TIMEOUT
from .config import CONNECT_TIMEOUT
import requests
import json
from .config import MEMORY_DIR
import os
from .config import BASE_DIR
import threading


PUSH_LOCK = threading.Lock()


PUSH_TOKENS_LIMIT = 10


FCM_KEY_CANDIDATES = ("firebase-key.json", "chave-firebase.json")


FCM_KEY_FILE = BASE_DIR / (
    os.environ.get("FCM_KEY", "").strip()
    or next(
        (name for name in FCM_KEY_CANDIDATES if (BASE_DIR / name).exists()),
        FCM_KEY_CANDIDATES[0],
    )
)


SITE_URL = os.environ.get("SITE_URL", "https://nexa2.rcscan.online/")


FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


try:
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from google.oauth2 import service_account as google_service_account

    GOOGLE_AUTH_AVAILABLE = True
except ImportError:
    GOOGLE_AUTH_AVAILABLE = False


_fcm_credentials = None


_fcm_project_id = ""


def push_path(user_id):
    safe_id = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )
    return MEMORY_DIR / ("%s.push.json" % safe_id)


def _read_push_tokens(path):
    try:
        tokens = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    if not isinstance(tokens, list):
        return []

    return [token for token in tokens if isinstance(token, str) and token]


def _write_push_tokens(path, tokens):
    temporary = path.with_suffix(".json.tmp")
    try:
        temporary.write_text(
            json.dumps(tokens, ensure_ascii=False), encoding="utf-8"
        )
        temporary.replace(path)
    except OSError as error:
        print("[NEXA] falha ao salvar token de notificação:", error)
        return False

    return True


def get_push_tokens(user_id):
    with PUSH_LOCK:
        return _read_push_tokens(push_path(user_id))


def save_push_token(user_id, token):
    path = push_path(user_id)

    with PUSH_LOCK:
        # Um aparelho pertence a uma conta só: o token sai das outras.
        for other in MEMORY_DIR.glob("*.push.json"):
            if other == path:
                continue
            tokens = _read_push_tokens(other)
            if token in tokens:
                if not _write_push_tokens(other, [t for t in tokens if t != token]):
                    return False

        tokens = _read_push_tokens(path)
        if token not in tokens:
            tokens.append(token)
        return _write_push_tokens(path, tokens[-PUSH_TOKENS_LIMIT:])


def remove_push_token(user_id, token):
    path = push_path(user_id)

    with PUSH_LOCK:
        tokens = _read_push_tokens(path)
        if token in tokens:
            _write_push_tokens(path, [t for t in tokens if t != token])


def fcm_credentials():
    """Credencial do FCM, ou None sem google-auth, sem chave ou chave inválida."""
    global _fcm_credentials, _fcm_project_id

    if not GOOGLE_AUTH_AVAILABLE or not FCM_KEY_FILE.exists():
        return None

    try:
        if _fcm_credentials is None:
            _fcm_credentials = google_service_account.Credentials.from_service_account_file(
                str(FCM_KEY_FILE), scopes=[FCM_SCOPE]
            )
            _fcm_project_id = _fcm_credentials.project_id or ""
        if not _fcm_credentials.valid:
            _fcm_credentials.refresh(GoogleAuthRequest())
        return _fcm_credentials
    except Exception as error:
        print("[NEXA] FCM indisponível:", error)
        return None


def send_push_notification(user_id, title, body):
    tokens = get_push_tokens(user_id)
    if not tokens:
        print("[NEXA] push ignorado: nenhum aparelho registrado para %s" % user_id)
        return

    credentials = fcm_credentials()
    if credentials is None:
        print("[NEXA] push ignorado: chave FCM ausente/inválida ou google-auth não instalado")
        return

    url = "https://fcm.googleapis.com/v1/projects/%s/messages:send" % _fcm_project_id
    headers = {
        "Authorization": "Bearer " + credentials.token,
        "Content-Type": "application/json",
    }

    for token in tokens:
        payload = {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": {"url": SITE_URL},
            }
        }

        try:
            response = requests.post(
                url, headers=headers, json=payload,
                timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
            )
        except requests.RequestException as error:
            print("[NEXA] push falhou:", error)
            continue

        if response.status_code == 200:
            continue

        print("[NEXA] push HTTP %d: %s" % (response.status_code, response.text[:300]))

        if response.status_code == 404 or "INVALID_ARGUMENT" in response.text:
            remove_push_token(user_id, token)
