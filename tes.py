
import os
from pathlib import Path
from dotenv import load_dotenv
from werkzeug.security import check_password_hash

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

import auth

print("Pasta do projeto:", ROOT)
print("Banco utilizado:", auth.AUTH_DB.resolve())
print("Usuário configurado:", auth.ADMIN_USER)
print("ADMIN_PASSWORD carregada:", bool(auth.ADMIN_PASSWORD))

with auth.db() as conn:
    users = conn.execute(
        "SELECT username, is_admin, password_hash FROM users"
    ).fetchall()

print("Contas encontradas:", [
    {"username": u["username"], "admin": bool(u["is_admin"])}
    for u in users
])

for user in users:
    if user["username"] == auth.ADMIN_USER:
        print(
            "Senha do .env confere com a conta configurada:",
            check_password_hash(
                user["password_hash"], auth.ADMIN_PASSWORD
            ) if auth.ADMIN_PASSWORD else False
        )
