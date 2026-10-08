"""
Restaura a senha do admin com o ADMIN_PASSWORD definido no .env.

Quando usar:
- Esqueceu a senha do admin.
- Trocou ADMIN_PASSWORD no .env e o login continua recusando (o admin
  já existia no auth.db, e o .env só vale na CRIAÇÃO da primeira conta).
- Instalou por cima de outra instalação e o auth.db veio de lá.

Uso (na pasta do projeto):
    python reset_admin.py

O que ele faz:
- Lê ADMIN_USER e ADMIN_PASSWORD do .env (o arquivo manda, não o shell).
- Migra o schema do auth.db se ele for de uma versão antiga.
- Atualiza a senha do admin no banco e derruba as sessões abertas dele.
- Se a conta não existir (ou o banco não existir), cria.

Outros admins que existirem no banco continuam intactos — remova-os depois
pelo Painel admin (Usuários), logando com a conta restaurada.
"""

import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# O .env é a fonte da verdade desta ferramenta: sobrescreve o que vier do
# shell para o resultado ser sempre "a senha que está no arquivo".
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv(BASE_DIR / ".env", override=True)

ADMIN_USER = os.environ.get("ADMIN_USER", "admin").strip().lower() or "admin"
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

MIN_PASSWORD = 8


def main():
    if not ADMIN_PASSWORD:
        print(
            "ERRO: ADMIN_PASSWORD vazio no .env.\n"
            "      Abra o .env, defina ADMIN_PASSWORD=sua-senha e rode de novo."
        )
        return 1

    if len(ADMIN_PASSWORD) < MIN_PASSWORD:
        print(
            "AVISO: a senha tem %d caracteres (recomendado: %d+). O login vai "
            "aceitar, mas o Painel admin exige %d+ para trocas futuras de senha."
            % (len(ADMIN_PASSWORD), MIN_PASSWORD, MIN_PASSWORD)
        )

    # Reaproveita a resolução do caminho do banco, a migração de schema e a
    # criação de tabelas do próprio auth (funciona mesmo sem auth.db ainda).
    sys.path.insert(0, str(BASE_DIR))
    from auth import db, init_auth_db

    init_auth_db()

    with db() as conn:
        existing = conn.execute(
            "SELECT username FROM users ORDER BY id"
        ).fetchall()
        others = [
            row["username"] for row in existing if row["username"] != ADMIN_USER
        ]

        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, is_admin = 1 "
            "WHERE username = ?",
            (generate_password_hash(ADMIN_PASSWORD), ADMIN_USER),
        )

        if cursor.rowcount == 0:
            conn.execute(
                "INSERT INTO users (username, password_hash, is_admin) "
                "VALUES (?, ?, 1)",
                (ADMIN_USER, generate_password_hash(ADMIN_PASSWORD)),
            )
            action = "criada"
        else:
            action = "atualizada"

        user_id = conn.execute(
            "SELECT id FROM users WHERE username = ?", (ADMIN_USER,)
        ).fetchone()["id"]

        conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    print(
        'Pronto: conta "%s" %s com a senha do .env (sessões encerradas). '
        "Faça login com %s / ADMIN_PASSWORD."
        % (ADMIN_USER, action, ADMIN_USER)
    )

    if others:
        print(
            "Outras contas neste banco: %s. Se não forem suas, remova-as no "
            "Painel admin após entrar." % ", ".join(others)
        )

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:  # RuntimeError do .env vazio, sqlite3.Error, etc.
        print("ERRO: %s" % err)
        print("Dica: confira o .env e, se o servidor estiver rodando, pare-o.")
        sys.exit(1)
