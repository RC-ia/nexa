"""
Autenticação da NEXA (versão simples): login com usuário e senha, sessão por
cookie e painel admin para criar/remover usuários. Não há cadastro aberto.

- Senhas: hash scrypt (werkzeug), nunca em texto.
- Sessão: token aleatório em cookie HttpOnly; no banco fica só o hash do token.
- Banco separado (auth.db) para não misturar contas com a memória em Markdown.
- No primeiro start cria o admin (ADMIN_USER / ADMIN_PASSWORD do .env).
"""

import hashlib
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from functools import wraps
from pathlib import Path
from urllib.parse import unquote

from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent

AUTH_DB = BASE_DIR / os.environ.get("AUTH_DB", "auth.db")
SESSION_TTL = int(os.environ.get("SESSION_DAYS", "30")) * 86400
MESSAGE_KEY_TTL = 24 * 60 * 60

ADMIN_USER = os.environ.get("ADMIN_USER", "admin").strip().lower() or "admin"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

MIN_PASSWORD = 8
MAX_PASSWORD = 128
COOKIE_NAME = "nexa_session"
USERNAME_RE = re.compile(r"^[a-z0-9_.@+-]{3,64}$")

# Usado quando o usuário não existe, para o login levar o mesmo tempo.
_DUMMY_HASH = generate_password_hash("nexa-dummy-password")

auth_bp = Blueprint("auth", __name__)


# =========================
# BANCO
# =========================

@contextmanager
def db():
    conn = sqlite3.connect(AUTH_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def migrate_old_schema(conn):
    """Banco da versão anterior (login por email): mantém as contas existentes."""
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(users)")]

    if not columns:
        return

    if "username" not in columns and "email" in columns:
        conn.execute("ALTER TABLE users RENAME COLUMN email TO username")

    if "is_admin" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")

    conn.execute("DROP TABLE IF EXISTS pending_signups")


def init_auth_db():
    with db() as conn:
        migrate_old_schema(conn)

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "username TEXT NOT NULL UNIQUE, "
            "password_hash TEXT NOT NULL, "
            "is_admin INTEGER NOT NULL DEFAULT 0, "
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.execute(
            "CREATE TABLE IF NOT EXISTS sessions ("
            "token_hash TEXT PRIMARY KEY, "
            "user_id INTEGER NOT NULL, "
            "expires_at INTEGER NOT NULL, "
            "message_key_hash TEXT, "
            "message_key_created_at INTEGER)"
        )

        session_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(sessions)")
        }
        if "message_key_hash" not in session_columns:
            conn.execute("ALTER TABLE sessions ADD COLUMN message_key_hash TEXT")
        if "message_key_created_at" not in session_columns:
            conn.execute(
                "ALTER TABLE sessions ADD COLUMN message_key_created_at INTEGER"
            )

        has_admin = conn.execute(
            "SELECT 1 FROM users WHERE is_admin = 1"
        ).fetchone()

        if has_admin:
            # O .env só cria o admin na PRIMEIRA vez. Depois, trocar
            # ADMIN_PASSWORD no .env não muda a senha do banco - quem
            # define a senha agora é o Painel admin ou reset_admin.py.
            print(
                "[NEXA-auth] Admin já existe; ADMIN_PASSWORD do .env não "
                "é aplicado. Para trocar a senha: python reset_admin.py",
                flush=True,
            )
            return

        password = ADMIN_PASSWORD

        if not password:
            raise RuntimeError(
                "Defina ADMIN_PASSWORD no .env antes do primeiro start."
            )

        conn.execute(
            "INSERT OR REPLACE INTO users (username, password_hash, is_admin) "
            "VALUES (?, ?, 1)",
            (ADMIN_USER, generate_password_hash(password)),
        )

    print("[NEXA-auth] Conta admin criada (usuário: %s)." % ADMIN_USER, flush=True)


# =========================
# LIMITE DE TENTATIVAS (em memória)
# =========================

_hits = {}
_hits_lock = threading.Lock()


def rate_limited(key, limit, window):
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

def normalize_username(value):
    if not isinstance(value, str):
        return ""

    username = value.strip().lower()
    return username if USERNAME_RE.match(username) else ""


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


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def user_json(user):
    return {
        "id": user["id"],
        "username": user["username"],
        "isAdmin": bool(user["is_admin"]),
    }


# =========================
# SESSÃO
# =========================

def is_https():
    return request.is_secure or request.headers.get("X-Forwarded-Proto", "") == "https"


def start_session(conn, user_id, response, message_key):
    token = secrets.token_urlsafe(32)
    created_at = int(time.time())

    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at, "
        "message_key_hash, message_key_created_at) VALUES (?, ?, ?, ?, ?)",
        (
            hash_token(token),
            user_id,
            created_at + SESSION_TTL,
            hash_token(message_key),
            created_at,
        ),
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
                "SELECT users.id AS id, users.username AS username, "
                "users.is_admin AS is_admin FROM sessions "
                "JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (hash_token(token), int(time.time())),
            ).fetchone()
    except sqlite3.Error as err:
        print("[NEXA-auth] falha ao ler sessão:", err)
        return None

    return dict(row) if row else None


def valid_message_key(user_id, message_key):
    if not isinstance(message_key, str) or len(message_key) != 64:
        return False

    session_token = request.cookies.get(COOKIE_NAME, "")
    if not session_token:
        return False

    now = int(time.time())

    try:
        with db() as conn:
            row = conn.execute(
                "SELECT message_key_hash, message_key_created_at FROM sessions "
                "WHERE token_hash = ? AND user_id = ? AND expires_at > ?",
                (hash_token(session_token), user_id, now),
            ).fetchone()
    except sqlite3.Error as err:
        print("[NEXA-auth] falha ao validar credencial de mensagem:", err)
        return False

    if not row or not row["message_key_hash"] or row["message_key_created_at"] is None:
        return False

    created_at = row["message_key_created_at"]
    return (
        created_at <= now < created_at + MESSAGE_KEY_TTL
        and secrets.compare_digest(row["message_key_hash"], hash_token(message_key))
    )


def user_from_message_key():
    """
    Autentica pelo header X-Nexa-Message-Key sozinho, sem cookie de sessão.
    O app nativo registra o token de push por esse caminho.
    """
    message_key = request.headers.get("X-Nexa-Message-Key", "")
    if not isinstance(message_key, str) or len(message_key) != 64:
        return None

    now = int(time.time())

    try:
        with db() as conn:
            row = conn.execute(
                "SELECT users.id AS id, users.username AS username, "
                "users.is_admin AS is_admin, "
                "sessions.message_key_created_at AS created_at "
                "FROM sessions "
                "JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.message_key_hash = ? AND sessions.expires_at > ?",
                (hash_token(message_key), now),
            ).fetchone()
    except sqlite3.Error as err:
        print("[NEXA-auth] falha ao ler credencial de mensagem:", err)
        return None

    if not row or row["created_at"] is None:
        return None

    if not (row["created_at"] <= now < row["created_at"] + MESSAGE_KEY_TTL):
        return None

    return {"id": row["id"], "username": row["username"], "is_admin": row["is_admin"]}

def admin_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        user = current_user()

        if user is None:
            return error("Faça login.", 401)

        if not user["is_admin"]:
            return error("Só o admin pode fazer isso.", 403)

        return view(user, *args, **kwargs)

    return wrapper


# =========================
# ROTAS DE LOGIN
# =========================

@auth_bp.get("/api/auth/me")
def me():
    user = current_user()

    if user is None:
        return error("Não autenticado.", 401)

    return jsonify({"user": user_json(user)})


@auth_bp.post("/api/auth/login")
def login():
    data = body_json()
    username = normalize_username(data.get("username"))
    password = data.get("password")

    failed = "Usuário ou senha incorretos."

    if not username or not isinstance(password, str) or len(password) > MAX_PASSWORD:
        return error(failed, 401)

    if rate_limited("login:%s:%s" % (client_ip(), username), 8, 900):
        return error("Muitas tentativas. Tente de novo em alguns minutos.", 429)

    try:
        with db() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))

            user = conn.execute(
                "SELECT id, username, is_admin, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            valid = check_password_hash(
                user["password_hash"] if user else _DUMMY_HASH, password
            )

            if not user or not valid:
                return error(failed, 401)

            message_key = secrets.token_hex(32)
            response = jsonify({
                "user": user_json(user),
                "messageKey": message_key,
            })
            return start_session(conn, user["id"], response, message_key)

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


# =========================
# DADOS DA CONTA (ao apagar)
# =========================

_GENERATED_RE = re.compile(r"/generated/([^)\s\"'#?]+)")


def _base_name(name):
    """Só o nome base dentro da pasta: nada escapa por traversal."""
    return os.path.basename(str(name).replace("\\", "/"))


def _images_in_chats(path):
    """Imagens citadas nas conversas sincronizadas da conta (mesmo corte do
    cliente, em js/chats.js: collectGeneratedImages)."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []

    names = set()

    def walk(value):
        if isinstance(value, str):
            for match in _GENERATED_RE.finditer(value):
                name = _base_name(unquote(match.group(1)))
                if name:
                    names.add(name)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return sorted(names)


def purge_account_data(user_id):
    """
    Apaga do servidor tudo que é da conta: memória, conversas, prompts,
    ajustes, lembretes, push, espaço do Estúdio e as imagens que as
    conversas dela citam.

    Todos os módulos derivam o caminho por conta de `acct_<id>`, então o
    mesmo prefixo localiza os arquivos — nenhum arquivo de outra conta é
    tocado. As imagens em si não têm dono gravado no nome (ainda), por
    isso a lista saída das conversas da conta.
    """
    try:
        from nexa.config import MEMORY_DIR
        from nexa.images import IMAGE_OUTPUT_DIR
        from nexa.studio import STUDIO_DIR
    except Exception as err:  # ambiente sem o pacote nexa (ferramentas avulsas)
        print("[NEXA-auth] não consegui localizar os dados da conta:", err, flush=True)
        return []

    account = "acct_%d" % user_id
    removed = []

    def drop_file(path):
        try:
            if path.is_file():
                path.unlink()
                removed.append(path.name)
        except OSError as err:
            print("[NEXA-auth] não foi possível apagar %s: %s" % (path, err), flush=True)

    # 1) imagens citadas nas conversas, antes de apagar as conversas
    if IMAGE_OUTPUT_DIR.is_dir():
        for name in _images_in_chats(MEMORY_DIR / ("%s.chats.json" % account)):
            drop_file(IMAGE_OUTPUT_DIR / name)

    # 2) arquivos da conta (memória, conversas, prompts, ajustes, lembretes, push)
    for folder in (MEMORY_DIR, STUDIO_DIR):
        if folder.is_dir():
            for path in folder.glob(account + ".*"):
                drop_file(path)

    # 3) pasta do Estúdio da conta
    studio_root = STUDIO_DIR / account
    if studio_root.is_dir():
        try:
            shutil.rmtree(studio_root)
            removed.append(account + "/")
        except OSError as err:
            print("[NEXA-auth] não foi possível apagar %s: %s" % (studio_root, err), flush=True)

    return removed


# =========================
# PAINEL ADMIN
# =========================

@auth_bp.get("/api/admin/users")
@admin_required
def admin_list(_admin):
    with db() as conn:
        rows = conn.execute(
            "SELECT id, username, is_admin, created_at FROM users ORDER BY id"
        ).fetchall()

    return jsonify({"users": [
        {
            "id": row["id"],
            "username": row["username"],
            "isAdmin": bool(row["is_admin"]),
            "createdAt": row["created_at"],
        }
        for row in rows
    ]})


@auth_bp.post("/api/admin/users")
@admin_required
def admin_create(_admin):
    data = body_json()
    username = normalize_username(data.get("username"))
    password = data.get("password")

    if not username:
        return error(
            "Usuário inválido: use 3 a 64 caracteres (letras, números, _ . @ + -).", 400
        )

    problem = password_error(password)
    if problem:
        return error(problem, 400)

    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)",
                (username, generate_password_hash(password), 1 if data.get("isAdmin") else 0),
            )
    except sqlite3.IntegrityError:
        return error("Esse usuário já existe.", 409)

    return jsonify({"ok": True})


@auth_bp.post("/api/admin/users/<int:user_id>/password")
@admin_required
def admin_password(_admin, user_id):
    password = body_json().get("password")

    problem = password_error(password)
    if problem:
        return error(problem, 400)

    with db() as conn:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (generate_password_hash(password), user_id),
        )

        if cursor.rowcount == 0:
            return error("Usuário não encontrado.", 404)

        # A troca de senha derruba as sessões abertas desse usuário.
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    return jsonify({"ok": True})


@auth_bp.delete("/api/admin/users/<int:user_id>")
@admin_required
def admin_delete(admin, user_id):
    if user_id == admin["id"]:
        return error("Você não pode apagar a própria conta.", 400)

    with db() as conn:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))

        if cursor.rowcount == 0:
            return error("Usuário não encontrado.", 404)

        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    # Conta fora do banco: some também com o que ela deixou no servidor
    # (memória, conversas, prompts, ajustes, lembretes, push, Estúdio e as
    # imagens citadas nas conversas dela).
    removed = purge_account_data(user_id)

    if removed:
        print(
            "[NEXA-auth] conta %s apagada; %d arquivo(s) de dados removidos."
            % (user_id, len(removed)),
            flush=True,
        )

    return jsonify({"ok": True, "dadosApagados": len(removed)})


# =========================
# GERENCIAMENTO DO SERVIDOR (apenas admin)
# =========================

@auth_bp.get("/api/admin/server/status")
@admin_required
def admin_server_status(_admin):
    from server_manager import get_status
    return jsonify(get_status())


@auth_bp.post("/api/admin/server/start")
@admin_required
def admin_server_start(_admin):
    from server_manager import start_server
    return jsonify(start_server())


@auth_bp.post("/api/admin/server/stop")
@admin_required
def admin_server_stop(_admin):
    from server_manager import stop_server
    force = body_json().get("force", False)
    if not isinstance(force, bool):
        return error("O campo force precisa ser booleano.", 400)
    return jsonify(stop_server(force=force))


@auth_bp.post("/api/admin/server/restart")
@admin_required
def admin_server_restart(_admin):
    from server_manager import restart_server
    force = body_json().get("force", False)
    if not isinstance(force, bool):
        return error("O campo force precisa ser booleano.", 400)
    return jsonify(restart_server(force=force))
