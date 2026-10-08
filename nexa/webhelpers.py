"""Rotas básicas (index, versão, estáticos) e helpers compartilhados."""
from auth import valid_message_key
from flask import request
from .config import STATIC_FILES
from flask import jsonify
from .config import BASE_DIR
from flask import send_from_directory
from .app import app
from .config import DEFAULT_VERSION
from .config import VERSION_FILE


def read_version():
    try:
        value = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        value = ""

    return value or DEFAULT_VERSION


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/api/version")
def version():
    return jsonify({"version": read_version()})


@app.get("/<path:filename>")
def static_file(filename):
    if filename not in STATIC_FILES:
        return jsonify({"error": "Não encontrado."}), 404

    return send_from_directory(BASE_DIR, filename)


def message_key_error(user):
    message_key = request.headers.get("X-Nexa-Message-Key", "")
    if valid_message_key(user["id"], message_key):
        return None

    return jsonify({
        "error": "A credencial de mensagem expirou. Entre novamente.",
        "code": "message_key_expired",
    }), 401


def request_json_object():
    body = request.get_json(force=True, silent=True)
    return body if isinstance(body, dict) else {}
