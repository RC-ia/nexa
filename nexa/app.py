"""Aplicação Flask da NEXA: app, headers de segurança, rotas e main()."""
import threading

from flask import Flask, request

from .config import PORT  # carrega o .env ANTES do auth (que lê ADMIN_USER/ADMIN_PASSWORD no import)

from auth import auth_bp, init_auth_db  # noqa: E402  (precisa do .env já carregado)

app = Flask(__name__)
app.register_blueprint(auth_bp)


@app.after_request
def _security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' "
        "cdn.jsdelivr.net cdnjs.cloudflare.com "
        "static.cloudflareinsights.com; "
        "style-src 'self' 'unsafe-inline' cdn.jsdelivr.net "
        "cdnjs.cloudflare.com fonts.googleapis.com; "
        "font-src 'self' fonts.gstatic.com; "
        "img-src 'self' data: blob:; "
        "media-src 'self' blob:; "
        "connect-src 'self' cdn.jsdelivr.net "
        "static.cloudflareinsights.com "
        "wss://generativelanguage.googleapis.com; "
        "frame-ancestors 'none'",
    )
    if (
        request.is_secure
        or request.headers.get("X-Forwarded-Proto", "") == "https"
    ):
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response

# Os módulos abaixo só podem ser importados DEPOIS de `app` existir:
# os módulos de rota registram as views e alguns importam `from .app import app`.
from .memory import init_db  # noqa: E402
from .push import FCM_KEY_FILE, GOOGLE_AUTH_AVAILABLE  # noqa: E402
from .reminders import reminder_scheduler_loop  # noqa: E402
from . import (  # noqa: E402
    webhelpers,
    images,
    live,
    studio,
    routes_chat,
    routes_settings,
)

init_db()
init_auth_db()


def main():
    print("[NEXA] rodando em http://localhost:%d" % PORT)
    if not FCM_KEY_FILE.exists():
        print(
            "[NEXA] sem %s — push FCM desativado (lembretes só pela página)."
            % FCM_KEY_FILE.name
        )
    elif not GOOGLE_AUTH_AVAILABLE:
        print(
            "[NEXA] sem google-auth — push FCM desativado "
            "(instale com: pip install -r requirements.txt)."
        )
    threading.Thread(
        target=reminder_scheduler_loop, daemon=True, name="nexa-reminders"
    ).start()
    app.run(host="0.0.0.0", port=PORT, threaded=True)


if __name__ == "__main__":
    main()
