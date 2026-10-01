"""
Gerenciador do processo do servidor NEXA.
Wrapper sobre o launcher.py que inicia o servidor desanexado (sobrevive ao fechar terminal).
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Importa funções do launcher
sys.path.insert(0, str(BASE_DIR))
from launcher import start_detached, stop_server, restart_server, get_status, is_alive


def is_running() -> bool:
    """Verifica se o processo do servidor está rodando."""
    status = get_status()
    return status.get("running", False)


# Se executado diretamente, usa o launcher
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="NEXA Server Manager")
    parser.add_argument("action", choices=["start", "stop", "restart", "status"], nargs="?", default="start")
    parser.add_argument("--force", action="store_true", help="Forçar kill (stop/restart)")
    args = parser.parse_args()

    if args.action == "start":
        result = start_detached()
    elif args.action == "stop":
        result = stop_server(force=args.force)
    elif args.action == "restart":
        result = restart_server(force=args.force)
    elif args.action == "status":
        result = get_status()
    else:
        result = {"ok": False, "error": "Ação inválida"}

    print(result)
    sys.exit(0 if result.get("ok") or "running" in result else 1)