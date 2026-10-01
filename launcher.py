"""
Launcher do servidor NEXA para Linux.
Inicia o server.py como **daemon** (sobrevive ao fechar o terminal).
Guarda o PID em arquivo para o server_manager poder controlar depois.
"""

import os
import sys
import subprocess
import time
import atexit
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SERVER_SCRIPT = BASE_DIR / "server.py"
PYTHON_EXE = sys.executable
PID_FILE = BASE_DIR / ".nexa_server.pid"
LOG_FILE = BASE_DIR / ".nexa_server.log"


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
    """Verifica se processo existe (Linux)."""
    try:
        # kill -0 não mata, só verifica se o processo existe e temos permissão
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _daemonize():
    """Double-fork para daemonizar corretamente no Linux."""
    # Primeiro fork
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)  # Pai sai
    except OSError as e:
        _log(f"Primeiro fork falhou: {e}")
        sys.exit(1)

    # Desanexa do terminal pai
    os.chdir("/")
    os.setsid()
    os.umask(0)

    # Segundo fork
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)  # Pai intermediário sai
    except OSError as e:
        _log(f"Segundo fork falhou: {e}")
        sys.exit(1)

    # Redireciona stdio para /dev/null (ou log file)
    sys.stdout.flush()
    sys.stderr.flush()
    with open(LOG_FILE, "a") as f:
        os.dup2(f.fileno(), sys.stdout.fileno())
        os.dup2(f.fileno(), sys.stderr.fileno())
    with open(os.devnull, "r") as f:
        os.dup2(f.fileno(), sys.stdin.fileno())


def start_detached() -> dict:
    """Inicia server.py como daemon."""
    pid = read_pid()
    if pid and is_alive(pid):
        return {"ok": False, "error": f"Servidor já rodando (PID: {pid})", "pid": pid}

    try:
        # Prepara ambiente para o daemon
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        # Inicia o processo que vai fazer o double-fork
        proc = subprocess.Popen(
            [PYTHON_EXE, "-c", f"""
import os, sys, subprocess, time
from pathlib import Path

BASE_DIR = Path(r"{BASE_DIR}")
SERVER_SCRIPT = BASE_DIR / "server.py"
PID_FILE = BASE_DIR / ".nexa_server.pid"
LOG_FILE = BASE_DIR / ".nexa_server.log"

def daemonize():
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError as e:
        sys.exit(1)
    os.chdir("/")
    os.setsid()
    os.umask(0)
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError as e:
        sys.exit(1)
    sys.stdout.flush()
    sys.stderr.flush()
    with open(LOG_FILE, "a") as f:
        os.dup2(f.fileno(), sys.stdout.fileno())
        os.dup2(f.fileno(), sys.stderr.fileno())
    with open(os.devnull, "r") as f:
        os.dup2(f.fileno(), sys.stdin.fileno())

daemonize()

# Escreve PID do processo final (neto)
with open(PID_FILE, "w") as f:
    f.write(str(os.getpid()))

# Executa o servidor
os.execve(r"{PYTHON_EXE}", [r"{PYTHON_EXE}", str(SERVER_SCRIPT)], {k: v for k, v in os.environ.items()})
"""],
            cwd=str(BASE_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )

        # Aguarda o processo intermediário terminar (ele faz o double-fork e sai)
        proc.wait(timeout=5)

        # Dá tempo do daemon neto subir e escrever o PID
        time.sleep(1.5)

        # Lê o PID real do daemon
        real_pid = read_pid()
        if real_pid and is_alive(real_pid):
            _log(f"Servidor iniciado como daemon (PID: {real_pid})")
            return {"ok": True, "pid": real_pid}
        else:
            return {"ok": False, "error": "Daemon não escreveu PID válido"}

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
            # Mata o grupo de processos (SIGKILL)
            os.killpg(os.getpgid(pid), 9)  # SIGKILL
            _log(f"Servidor morto à força (PID: {pid})")
        else:
            # Termina graciosamente (SIGTERM no grupo)
            os.killpg(os.getpgid(pid), 15)  # SIGTERM
            _log(f"Servidor finalizado (PID: {pid})")

        # Aguarda morte
        for _ in range(20):
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

    parser = argparse.ArgumentParser(description="NEXA Server Launcher (Linux)")
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