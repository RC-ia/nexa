"""
Autenticação da NEXA: cadastro com código por email, login e sessão.

- Senhas: hash scrypt (werkzeug), nunca guardadas em texto.
- Código de cadastro: 6 dígitos, guardado só como hash, expira e limita tentativas.
- Sessão: token aleatório em cookie HttpOnly; no banco fica só o hash do token.
- Banco separado (auth.db) para não misturar contas com o nexa.db versionado.
"""

import hashlib
import hmac
import os
import re
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
from email.message import EmailMessage
from functools import wraps
from pathlib import Path

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent

AUTH_DB = BASE_DIR / os.environ.get("AUTH_DB", "auth.db")

SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "").strip() or SMTP_USER
# starttls (porta 587), ssl (porta 465) ou none.
SMTP_SECURITY = os.environ.get("SMTP_SECURITY", "starttls").strip().lower()

CODE_TTL = int(os.environ.get("CODE_TTL_MINUTES", "10")) * 60
CODE_MAX_ATTEMPTS = int(os.environ.get("CODE_MAX_ATTEMPTS", "5"))
RESEND_COOLDOWN = int(os.environ.get("RESEND_COOLDOWN", "60"))
SESSION_TTL = int(os.environ.get("SESSION_DAYS", "30")) * 86400

MIN_PASSWORD = 8
MAX_PASSWORD = 128
COOKIE_NAME = "nexa_session"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# Hash usado quando o email não existe, para o login levar o mesmo tempo
# e não revelar quais emails têm conta.
_DUMMY_HASH = generate_password_hash("nexa-dummy-password")

auth_bp = Blueprint("auth", __name__)


# =========================
# BANCO
# =========================

def db():
    conn = sqlite3.connect(AUTH_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_auth_db():
    with db() as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "email TEXT NOT NULL UNIQUE, "
            "password_hash TEXT NOT NULL, "
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS pending_signups ("
            "email TEXT PRIMARY KEY, "
            "password_hash TEXT NOT NULL, "
            "code_hash TEXT NOT NULL, "
            "salt TEXT NOT NULL, "
            "expires_at INTEGER NOT NULL, "
            "attempts INTEGER NOT NULL DEFAULT 0, "
            "last_sent_at INTEGER NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "token_hash TEXT PRIMARY KEY, "
            "user_id INTEGER NOT NULL, "
            "expires_at INTEGER NOT NULL)"
        )


def purge_expired(conn):
    now = int(time.time())
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    conn.execute("DELETE FROM pending_signups WHERE expires_at < ?", (now,))


# =========================
# LIMITE DE TENTATIVAS (em memória)
# =========================

_hits = {}
_hits_lock = threading.Lock()


def rate_limited(key, limit, window):
    """Conta o acesso e diz se passou do limite na janela (segundos)."""
    now = time.time()

    with _hits_lock:
        recent = [t for t in _hits.get(key, []) if now - t < window]
        recent.append(now)
        _hits[key] = recent

        if len(_hits) > 5000:
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                _hits.pop(k, None)

        return len(recent) > limit


def client_ip():
    return request.headers.get("CF-Connecting-IP") or request.remote_addr or "?"


# =========================
# UTILIDADES
# =========================

def normalize_email(value):
    if not isinstance(value, str):
        return ""

    email = value.strip().lower()

    if len(email) > 254 or not EMAIL_RE.match(email):
        return ""

    return email


def password_error(password):
    if not isinstance(password, str):
        return "Senha inválida."

    if len(password) < MIN_PASSWORD:
        return "A senha precisa ter pelo menos %d caracteres." % MIN_PASSWORD

    if len(password) > MAX_PASSWORD:
        return "A senha pode ter no máximo %d caracteres." % MAX_PASSWORD

    return ""


def body_json():
    data = request.get_json(force=True, silent=True)
    return data if isinstance(data, dict) else {}


def error(message, status):
    return jsonify({"error": message}), status


def hash_code(salt, email, code):
    return hashlib.sha256(("%s:%s:%s" % (salt, email, code)).encode()).hexdigest()


def new_code():
    return "%06d" % secrets.randbelow(1000000)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


# =========================
# EMAIL
# =========================

def send_code_email(email, code):
    """Envia o código. Sem SMTP configurado, mostra no console (modo dev)."""

    if not SMTP_HOST:
        print(
            "[NEXA-auth] SMTP não configurado — código para %s: %s "
            "(configure SMTP_HOST no .env para enviar por email)" % (email, code),
            flush=True,
        )
        return

    minutes = CODE_TTL // 60

    message = EmailMessage()
    message["Subject"] = "Seu código da NEXA: " + code
    message["From"] = SMTP_FROM
    message["To"] = email
    message.set_content(
        "Seu código de verificação da NEXA é:\n\n"
        "    %s\n\n"
        "Ele vale por %d minutos. Se não foi você que pediu, ignore este email."
        % (code, minutes)
    )

    context = ssl.create_default_context()

    if SMTP_SECURITY == "ssl":
        server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=15, context=context)
    else:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15)

    try:
        if SMTP_SECURITY == "starttls":
            server.starttls(context=context)

        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)

        server.send_message(message)

    finally:
        try:
            server.quit()
        except smtplib.SMTPException:
            pass


def issue_code(conn, email, password_hash):
    """Cria/renova o cadastro pendente e envia o código. Levanta em falha de envio."""
    code = new_code()
    salt = secrets.token_hex(8)
    now = int(time.time())

    send_code_email(email, code)

    conn.execute(
        "INSERT INTO pending_signups "
        "(email, password_hash, code_hash, salt, expires_at, attempts, last_sent_at) "
        "VALUES (?, ?, ?, ?, ?, 0, ?) "
        "ON CONFLICT(email) DO UPDATE SET "
        "password_hash = excluded.password_hash, code_hash = excluded.code_hash, "
        "salt = excluded.salt, expires_at = excluded.expires_at, "
        "attempts = 0, last_sent_at = excluded.last_sent_at",
        (email, password_hash, hash_code(salt, email, code), salt, now + CODE_TTL, now),
    )


# =========================
# SESSÃO
# =========================

def is_https():
    return request.is_secure or request.headers.get("X-Forwarded-Proto", "") == "https"


def start_session(conn, user_id, response):
    token = secrets.token_urlsafe(32)

    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (hash_token(token), user_id, int(time.time()) + SESSION_TTL),
    )

    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_TTL,
        httponly=True,
        samesite="Lax",
        secure=is_https(),
        path="/",
    )

    return response


def current_user():
    token = request.cookies.get(COOKIE_NAME, "")

    if not token:
        return None

    try:
        with db() as conn:
            row = conn.execute(
                "SELECT users.id AS id, users.email AS email FROM sessions "
                "JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (hash_token(token), int(time.time())),
            ).fetchone()
    except sqlite3.Error as err:
        print("[NEXA-auth] falha ao ler sessão:", err)
        return None

    return {"id": row["id"], "email": row["email"]} if row else None


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return error("Faça login para conversar com a NEXA.", 401)

        return view(*args, **kwargs)

    return wrapper


# =========================
# ROTAS
# =========================

@auth_bp.get("/api/auth/me")
def me():
    user = current_user()

    if user is None:
        return error("Não autenticado.", 401)

    return jsonify({"user": {"email": user["email"]}})


@auth_bp.post("/api/auth/register")
def register():
    data = body_json()
    email = normalize_email(data.get("email"))
    password = data.get("password")

    if not email:
        return error("Informe um email válido.", 400)

    problem = password_error(password)
    if problem:
        return error(problem, 400)

    if rate_limited("register:" + client_ip(), 10, 3600):
        return error("Muitas tentativas. Tente de novo em alguns minutos.", 429)

    try:
        with db() as conn:
            purge_expired(conn)

            if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                return error("Já existe uma conta com esse email. Entre com sua senha.", 409)

            pending = conn.execute(
                "SELECT last_sent_at FROM pending_signups WHERE email = ?", (email,)
            ).fetchone()

            if pending:
                wait = RESEND_COOLDOWN - (int(time.time()) - pending["last_sent_at"])

                if wait > 0:
                    return jsonify({
                        "error": "Aguarde %ds para pedir outro código." % wait,
                        "retryIn": wait,
                    }), 429

            issue_code(conn, email, generate_password_hash(password))

    except (smtplib.SMTPException, OSError) as err:
        print("[NEXA-auth] falha ao enviar email:", err)
        return error("Não consegui enviar o email agora. Tente novamente em instantes.", 502)

    except sqlite3.Error as err:
        print("[NEXA-auth] erro no banco:", err)
        return error("Erro interno ao criar a conta.", 500)

    return jsonify({"ok": True, "resendIn": RESEND_COOLDOWN})


@auth_bp.post("/api/auth/resend")
def resend():
    data = body_json()
    email = normalize_email(data.get("email"))

    if not email:
        return error("Informe um email válido.", 400)

    if rate_limited("resend:" + client_ip(), 10, 3600):
        return error("Muitas tentativas. Tente de novo em alguns minutos.", 429)

    try:
        with db() as conn:
            pending = conn.execute(
                "SELECT password_hash, last_sent_at FROM pending_signups WHERE email = ?",
                (email,),
            ).fetchone()

            if not pending:
                return error("Cadastro não encontrado ou expirado. Comece de novo.", 404)

            wait = RESEND_COOLDOWN - (int(time.time()) - pending["last_sent_at"])

            if wait > 0:
                return jsonify({
                    "error": "Aguarde %ds para pedir outro código." % wait,
                    "retryIn": wait,
                }), 429

            issue_code(conn, email, pending["password_hash"])

    except (smtplib.SMTPException, OSError) as err:
        print("[NEXA-auth] falha ao enviar email:", err)
        return error("Não consegui enviar o email agora. Tente novamente em instantes.", 502)

    except sqlite3.Error as err:
        print("[NEXA-auth] erro no banco:", err)
        return error("Erro interno.", 500)

    return jsonify({"ok": True, "resendIn": RESEND_COOLDOWN})


@auth_bp.post("/api/auth/verify")
def verify():
    data = body_json()
    email = normalize_email(data.get("email"))
    code = str(data.get("code") or "").strip()

    if not email or not re.fullmatch(r"\d{6}", code):
        return error("Digite o código de 6 dígitos.", 400)

    invalid = "Código inválido ou expirado."

    try:
        with db() as conn:
            purge_expired(conn)

            pending = conn.execute(
                "SELECT * FROM pending_signups WHERE email = ?", (email,)
            ).fetchone()

            if not pending:
                return error(invalid + " Peça um novo código.", 400)

            if pending["attempts"] >= CODE_MAX_ATTEMPTS:
                conn.execute("DELETE FROM pending_signups WHERE email = ?", (email,))
                return error("Muitas tentativas erradas. Comece o cadastro de novo.", 429)

            expected = hash_code(pending["salt"], email, code)

            if not hmac.compare_digest(expected, pending["code_hash"]):
                conn.execute(
                    "UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?",
                    (email,),
                )
                return error(invalid, 400)

            try:
                cursor = conn.execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, pending["password_hash"]),
                )
            except sqlite3.IntegrityError:
                conn.execute("DELETE FROM pending_signups WHERE email = ?", (email,))
                return error("Já existe uma conta com esse email. Entre com sua senha.", 409)

            conn.execute("DELETE FROM pending_signups WHERE email = ?", (email,))

            response = jsonify({"user": {"email": email}})
            return start_session(conn, cursor.lastrowid, response)

    except sqlite3.Error as err:
        print("[NEXA-auth] erro no banco:", err)
        return error("Erro interno ao confirmar o código.", 500)


@auth_bp.post("/api/auth/login")
def login():
    data = body_json()
    email = normalize_email(data.get("email"))
    password = data.get("password")

    failed = "Email ou senha incorretos."

    if not email or not isinstance(password, str) or len(password) > MAX_PASSWORD:
        return error(failed, 401)

    key = "login:%s:%s" % (client_ip(), email)

    if rate_limited(key, 8, 900):
        return error("Muitas tentativas. Tente de novo em alguns minutos.", 429)

    try:
        with db() as conn:
            purge_expired(conn)

            user = conn.execute(
                "SELECT id, password_hash FROM users WHERE email = ?", (email,)
            ).fetchone()

            valid = check_password_hash(
                user["password_hash"] if user else _DUMMY_HASH, password
            )

            if not user or not valid:
                return error(failed, 401)

            response = jsonify({"user": {"email": email}})
            return start_session(conn, user["id"], response)

    except sqlite3.Error as err:
        print("[NEXA-auth] erro no banco:", err)
        return error("Erro interno ao entrar.", 500)


@auth_bp.post("/api/auth/logout")
def logout():
    token = request.cookies.get(COOKIE_NAME, "")

    if token:
        try:
            with db() as conn:
                conn.execute(
                    "DELETE FROM sessions WHERE token_hash = ?", (hash_token(token),)
                )
        except sqlite3.Error as err:
            print("[NEXA-auth] erro ao encerrar sessão:", err)

    response = jsonify({"ok": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    return response
