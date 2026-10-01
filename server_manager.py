"""
Gerenciador do processo do servidor NEXA.
Roda o server.py como subprocesso e expõe API para controle (start/stop/restart/status).
"""

import os
import sys
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent
SERVER_SCRIPT = BASE_DIR / "server.py"
PYTHON_EXE = sys.executable

# Lock para operações no processo
_process_lock = threading.Lock()
_server_process: Optional[subprocess.Popen] = None
_process_start_time: Optional[float] = None


def _log(msg: str):
    print(f"[NEXA-manager] {msg}", flush=True)


def is_running() -> bool:
    """Verifica se o processo do servidor está rodando."""
    global _server_process
    with _process_lock:
        if _server_process is None:
            return False
        return _server_process.poll() is None


def get_status() -> dict:
    """Retorna status do processo."""
    global _server_process, _process_start_time
    with _process_lock:
        running = _server_process is not None and _server_process.poll() is None
        pid = _server_process.pid if _server_process else None
        uptime = time.time() - _process_start_time if _process_start_time and running else None
        return {
            "running": running,
            "pid": pid,
            "uptime_seconds": round(uptime, 1) if uptime else None,
        }


def start_server() -> dict:
    """Inicia o servidor como subprocesso."""
    global _server_process, _process_start_time
    with _process_lock:
        if _server_process is not None and _server_process.poll() is None:
            return {"ok": False, "error": "Servidor já está rodando", "pid": _server_process.pid}

        try:
            _server_process = subprocess.Popen(
                [PYTHON_EXE, str(SERVER_SCRIPT)],
                cwd=str(BASE_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            _process_start_time = time.time()
            _log(f"Servidor iniciado (PID: {_server_process.pid})")

            # Thread para ler stdout do subprocesso
            def read_output():
                try:
                    for line in _server_process.stdout:
                        print(f"[NEXA-server] {line.rstrip()}", flush=True)
                except Exception as e:
                    _log(f"Erro lendo stdout: {e}")

            threading.Thread(target=read_output, daemon=True).start()

            return {"ok": True, "pid": _server_process.pid}
        except Exception as e:
            _log(f"Falha ao iniciar servidor: {e}")
            return {"ok": False, "error": str(e)}


def stop_server(force: bool = False) -> dict:
    """Para o servidor."""
    global _server_process, _process_start_time
    with _process_lock:
        if _server_process is None or _server_process.poll() is not None:
            return {"ok": False, "error": "Servidor não está rodando"}

        pid = _server_process.pid
        try:
            if force:
                _server_process.kill()
                _server_process.wait(timeout=5)
                _log(f"Servidor morto à força (PID: {pid})")
            else:
                _server_process.terminate()
                try:
                    _server_process.wait(timeout=10)
                    _log(f"Servidor finalizado graciosamente (PID: {pid})")
                except subprocess.TimeoutExpired:
                    _server_process.kill()
                    _server_process.wait(timeout=5)
                    _log(f"Servidor não respondeu ao terminate; morto (PID: {pid})")
        except Exception as e:
            _log(f"Erro parando servidor: {e}")
            return {"ok": False, "error": str(e)}
        finally:
            _server_process = None
            _process_start_time = None

        return {"ok": True, "pid": pid}


def restart_server(force: bool = False) -> dict:
    """Reinicia o servidor."""
    stop_result = stop_server(force=force)
    if not stop_result.get("ok") and "não está rodando" not in stop_result.get("error", ""):
        return stop_result
    time.sleep(1)
    return start_server()


# Se executado diretamente, inicia o servidor e mantém vivo
if __name__ == "__main__":
    import signal

    result = start_server()
    if not result.get("ok"):
        sys.exit(1)

    _log("Gerenciador rodando. Ctrl+C para parar.")

    def handle_signal(signum, frame):
        _log("Sinal recebido, parando servidor...")
        stop_server(force=True)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        while True:
            time.sleep(1)
            if _server_process and _server_process.poll() is not None:
                _log("Servidor parou inesperadamente; reiniciando em 3s...")
                time.sleep(3)
                start_server()
    except KeyboardInterrupt:
        handle_signal(signal.SIGINT, None)