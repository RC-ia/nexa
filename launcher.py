"""
Launcher do servidor NEXA para Windows.
Inicia o server.py como processo **desanexado** (sobrevive ao fechar o terminal).
Guarda o PID em arquivo para o server_manager poder controlar depois.
"""

import os
import sys
import subprocess
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SERVER_SCRIPT = BASE_DIR / "server.py"
PYTHON_EXE = sys.executable
PID_FILE = BASE_DIR / ".nexa_server.pid"

# Flags Windows para processo desanexado
CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008
CREATE_NO_WINDOW = 0x08000000  # Não cria janela de console


def _log(msg: str):
    print(f"[NEXA-launcher] {msg}", flush=True)


def read_pid() -> int | None:
    """Lê PID do arquivo."""
    try:
        if PID_FILE.exists():
            return int(PID_FILE.read_text().strip())
    except Exception:
        pass
    return None


def write_pid(pid: int):
    """Escreve PID no arquivo."""
    PID_FILE.write_text(str(pid), encoding="utf-8")


def is_alive(pid: int) -> bool:
    """Verifica se processo existe (Windows)."""
    try:
        # tasklist /FI "PID eq <pid>" retorna o processo se existir
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            text=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return str(pid) in result.stdout
    except Exception:
        return False


def start_detached() -> dict:
    """Inicia server.py desanexado do terminal."""
    pid = read_pid()
    if pid and is_alive(pid):
        return {"ok": False, "error": f"Servidor já rodando (PID: {pid})", "pid": pid}

    try:
        # Inicia processo desanexado no Windows
        proc = subprocess.Popen(
            [PYTHON_EXE, str(SERVER_SCRIPT)],
            cwd=str(BASE_DIR),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW,
            start_new_session=True,  # Python 3.11+ no Windows também suporta
        )

        # Dá tempo do processo iniciar e criar o PID file real
        time.sleep(1.5)

        # Verifica se o processo filho (o Flask real) subiu
        # O Popen retorna o PID do processo intermediário; o Flask roda no mesmo grupo
        write_pid(proc.pid)
        _log(f"Servidor iniciado desanexado (PID: {proc.pid})")

        return {"ok": True, "pid": proc.pid}
    except Exception as e:
        _log(f"Falha ao iniciar: {e}")
        return {"ok": False, "error": str(e)}


def stop_server(force: bool = False) -> dict:
    """Para o servidor pelo PID guardado."""
    pid = read_pid()
    if not pid:
        return {"ok": False, "error": "Nenhum PID salvo"}

    if not is_alive(pid):
        PID_FILE.unlink(missing_ok=True)
        return {"ok": False, "error": "Servidor não está rodando (PID órfão removido)"}

    try:
        if force:
            # Kill tree: mata o grupo de processos
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            _log(f"Servidor morto à força (PID: {pid})")
        else:
            # Terminate gracioso: CTRL_BREAK_EVENT para o grupo
            subprocess.run(
                ["taskkill", "/PID", str(pid)],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            _log(f"Servidor finalizado (PID: {pid})")

        # Aguarda morte
        for _ in range(10):
            if not is_alive(pid):
                break
            time.sleep(0.5)

        PID_FILE.unlink(missing_ok=True)
        return {"ok": True, "pid": pid}
    except Exception as e:
        _log(f"Erro parando: {e}")
        return {"ok": False, "error": str(e)}


def restart_server(force: bool = False) -> dict:
    """Reinicia o servidor."""
    stop_server(force=force)
    time.sleep(1)
    return start_detached()


def get_status() -> dict:
    """Status atual."""
    pid = read_pid()
    if pid and is_alive(pid):
        # Tenta uptime via tempo de criação do arquivo PID
        try:
            import os
            ctime = os.path.getctime(PID_FILE)
            uptime = time.time() - ctime
        except Exception:
            uptime = None
        return {"running": True, "pid": pid, "uptime_seconds": round(uptime, 1) if uptime else None}
    else:
        # Limpa PID órfão
        if pid:
            PID_FILE.unlink(missing_ok=True)
        return {"running": False, "pid": None, "uptime_seconds": None}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="NEXA Server Launcher (Windows)")
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