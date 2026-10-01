"""
Launcher do servidor NEXA - Cross-platform (Windows + Linux).
Inicia o run.py (supervisor com auto-update) como processo **desanexado/daemon**
(sobrevive ao fechar o terminal). Guarda o PID em arquivo para o server_manager
poder controlar depois.
"""

import os
import sys
import subprocess
import time
import platform
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SUPERVISOR_SCRIPT = BASE_DIR / "run.py"
PYTHON_EXE = sys.executable
PID_FILE = BASE_DIR / ".nexa_server.pid"
LOG_FILE = BASE_DIR / ".nexa_server.log"

IS_WINDOWS = platform.system() == "Windows"

# Windows flags
if IS_WINDOWS:
    CREATE_NEW_PROCESS_GROUP = 0x00000200
    DETACHED_PROCESS = 0x00000008
    CREATE_NO_WINDOW = 0x08000000


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
    """Verifica se processo existe (cross-platform)."""
    if IS_WINDOWS:
        try:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
                capture_output=True,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            return str(pid) in result.stdout
        except Exception:
            return False
    else:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False


def _start_windows() -> dict:
    """Inicia o supervisor desanexado no Windows."""
    try:
        log = open(LOG_FILE, "a", encoding="utf-8")

        proc = subprocess.Popen(
            [PYTHON_EXE, str(SUPERVISOR_SCRIPT)],
            cwd=str(BASE_DIR),
            stdout=log,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            creationflags=CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW,
            start_new_session=True,
        )
        log.close()

        time.sleep(1.5)

        if not is_alive(proc.pid):
            _log("Supervisor saiu logo após iniciar; veja .nexa_server.log")
            return {
                "ok": False,
                "error": "Supervisor saiu logo após iniciar (veja .nexa_server.log)",
            }

        write_pid(proc.pid)
        _log(f"Supervisor iniciado desanexado (PID: {proc.pid})")
        return {"ok": True, "pid": proc.pid}
    except Exception as e:
        _log(f"Falha ao iniciar (Windows): {e}")
        return {"ok": False, "error": str(e)}


def _start_linux() -> dict:
    """Inicia como daemon no Linux (double-fork)."""
    # Código Python que será executado no subprocesso para fazer o double-fork
    daemon_code = f"""
import os, sys
from pathlib import Path

BASE_DIR = Path(r"{BASE_DIR}")
SUPERVISOR_SCRIPT = BASE_DIR / "run.py"
PID_FILE = BASE_DIR / ".nexa_server.pid"
LOG_FILE = BASE_DIR / ".nexa_server.log"
PYTHON_EXE = r"{PYTHON_EXE}"

def daemonize():
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError:
        sys.exit(1)
    os.chdir("/")
    os.setsid()
    os.umask(0)
    try:
        pid = os.fork()
        if pid > 0:
            sys.exit(0)
    except OSError:
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

# Executa o supervisor
os.execve(PYTHON_EXE, [PYTHON_EXE, str(SUPERVISOR_SCRIPT)], dict(os.environ))
"""

    try:
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"

        proc = subprocess.Popen(
            [PYTHON_EXE, "-c", daemon_code],
            cwd=str(BASE_DIR),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )

        proc.wait(timeout=5)
        time.sleep(1.5)

        real_pid = read_pid()
        if real_pid and is_alive(real_pid):
            _log(f"Servidor iniciado como daemon (PID: {real_pid})")
            return {"ok": True, "pid": real_pid}
        else:
            return {"ok": False, "error": "Daemon não escreveu PID válido"}

    except Exception as e:
        _log(f"Falha ao iniciar (Linux): {e}")
        return {"ok": False, "error": str(e)}


def start_detached() -> dict:
    """Inicia o supervisor desanexado/daemon conforme o SO."""
    pid = read_pid()
    if pid and is_alive(pid):
        return {"ok": False, "error": f"Servidor já rodando (PID: {pid})", "pid": pid}

    if IS_WINDOWS:
        return _start_windows()
    else:
        return _start_linux()


def _stop_windows(pid: int, force: bool) -> dict:
    """Para a árvore do supervisor no Windows (run.py + server.py)."""
    try:
        command = ["taskkill", "/T", "/PID", str(pid)]
        if force:
            command.insert(1, "/F")

        subprocess.run(
            command,
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )

        for _ in range(10):
            if not is_alive(pid):
                break
            time.sleep(0.5)

        # taskkill sem /F não derruba processos de console: força a árvore.
        if is_alive(pid):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            for _ in range(10):
                if not is_alive(pid):
                    break
                time.sleep(0.5)

        if is_alive(pid):
            _log(f"Não consegui parar o PID {pid}")
            return {"ok": False, "error": f"Não consegui parar o PID {pid}"}

        PID_FILE.unlink(missing_ok=True)
        _log(f"Supervisor finalizado (PID: {pid})")
        return {"ok": True, "pid": pid}
    except Exception as e:
        _log(f"Erro parando (Windows): {e}")
        return {"ok": False, "error": str(e)}


def _stop_linux(pid: int, force: bool) -> dict:
    """Para processo no Linux (mata grupo)."""
    try:
        if force:
            os.killpg(os.getpgid(pid), 9)  # SIGKILL
            _log(f"Servidor morto à força (PID: {pid})")
        else:
            os.killpg(os.getpgid(pid), 15)  # SIGTERM
            _log(f"Servidor finalizado (PID: {pid})")

        for _ in range(20):
            if not is_alive(pid):
                break
            time.sleep(0.5)

        if is_alive(pid):
            _log(f"Não consegui parar o PID {pid}")
            return {"ok": False, "error": f"Não consegui parar o PID {pid}"}

        PID_FILE.unlink(missing_ok=True)
        _log(f"Supervisor finalizado (PID: {pid})")
        return {"ok": True, "pid": pid}
    except Exception as e:
        _log(f"Erro parando (Linux): {e}")
        return {"ok": False, "error": str(e)}


def stop_server(force: bool = False) -> dict:
    """Para o servidor pelo PID guardado."""
    pid = read_pid()
    if not pid:
        return {"ok": False, "error": "Nenhum PID salvo"}

    if not is_alive(pid):
        PID_FILE.unlink(missing_ok=True)
        return {"ok": False, "error": "Servidor não está rodando (PID órfão removido)"}

    if IS_WINDOWS:
        return _stop_windows(pid, force)
    else:
        return _stop_linux(pid, force)


def restart_server(force: bool = False) -> dict:
    """Reinicia o servidor."""
    stop_server(force=force)
    time.sleep(1)
    return start_detached()


def get_status() -> dict:
    """Status atual."""
    pid = read_pid()
    if pid and is_alive(pid):
        try:
            ctime = os.path.getctime(PID_FILE)
            uptime = time.time() - ctime
        except Exception:
            uptime = None
        return {"running": True, "pid": pid, "uptime_seconds": round(uptime, 1) if uptime else None}
    else:
        if pid:
            PID_FILE.unlink(missing_ok=True)
        return {"running": False, "pid": None, "uptime_seconds": None}


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="NEXA Server Launcher (Cross-platform)")
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