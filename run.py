import os
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent

load_dotenv(BASE_DIR / ".env")

AUTO_UPDATE = os.environ.get("AUTO_UPDATE", "1").strip().lower() not in (
    "0", "false", "no", "off", ""
)
UPDATE_INTERVAL = max(30, int(os.environ.get("UPDATE_INTERVAL", "180")))
GIT_REMOTE = os.environ.get("GIT_REMOTE", "origin").strip() or "origin"
GIT_BRANCH = os.environ.get("GIT_BRANCH", "").strip()

VERSION_FILE = BASE_DIR / os.environ.get("VERSION_FILE", ".nexa_version")
DEFAULT_VERSION = "0.01"
VERSION_STEP = float(os.environ.get("VERSION_STEP", "1"))


def log(message):
    print("[NEXA-updater] " + message, flush=True)


def git(*args):
    return subprocess.run(
        ["git", *args],
        cwd=str(BASE_DIR),
        capture_output=True,
        text=True,
    )


def current_version():
    result = git("rev-parse", "--short", "HEAD")
    return result.stdout.strip() if result.returncode == 0 else "?"


def read_version():
    try:
        value = VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        value = ""

    return value or DEFAULT_VERSION


def ensure_version_file():
    if not VERSION_FILE.exists():
        VERSION_FILE.write_text(DEFAULT_VERSION + "\n", encoding="utf-8")

    return read_version()


def bump_version():
    try:
        current = float(read_version())
    except ValueError:
        current = float(DEFAULT_VERSION)

    new_version = "%.2f" % (current + VERSION_STEP)
    VERSION_FILE.write_text(new_version + "\n", encoding="utf-8")

    return new_version


def upstream_ref():
    return (GIT_REMOTE + "/" + GIT_BRANCH) if GIT_BRANCH else "@{u}"


def has_update():
    fetch = git("fetch", "--quiet", GIT_REMOTE)

    if fetch.returncode != 0:
        log("git fetch falhou: " + (fetch.stderr or "").strip())
        return False

    result = git("rev-list", "--count", "HEAD.." + upstream_ref())

    if result.returncode != 0:
        log("não consegui comparar com o remoto: " + (result.stderr or "").strip())
        return False

    return int((result.stdout or "0").strip() or "0") > 0


def pull_update():
    if GIT_BRANCH:
        result = git("pull", "--ff-only", "--quiet", GIT_REMOTE, GIT_BRANCH)
    else:
        result = git("pull", "--ff-only", "--quiet")

    if result.returncode != 0:
        log("git pull falhou: " + (result.stderr or result.stdout or "").strip())
        return False

    return True


def start_server():
    log("iniciando servidor (versão %s)..." % current_version())
    return subprocess.Popen(
        [sys.executable, str(BASE_DIR / "server.py")],
        cwd=str(BASE_DIR),
    )


def stop_server(process):
    if process.poll() is not None:
        return

    process.terminate()

    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main():
    log("versão local: %s" % ensure_version_file())

    server = start_server()

    if AUTO_UPDATE:
        log("auto-update ligado (checando a cada %ds)." % UPDATE_INTERVAL)
    else:
        log("auto-update desligado (AUTO_UPDATE=0).")

    next_check = time.time() + UPDATE_INTERVAL

    try:
        while True:
            time.sleep(1)

            if server.poll() is not None:
                log("servidor parou (código %s); reiniciando em 3s..." % server.returncode)
                time.sleep(3)
                server = start_server()
                next_check = time.time() + UPDATE_INTERVAL
                continue

            if AUTO_UPDATE and time.time() >= next_check:
                next_check = time.time() + UPDATE_INTERVAL

                try:
                    if has_update() and pull_update():
                        new_version = bump_version()
                        log("nova versão baixada (agora %s); reiniciando o servidor..." % new_version)
                        stop_server(server)
                        server = start_server()

                except Exception as error:
                    log("erro no auto-update: %s" % error)

    except KeyboardInterrupt:
        log("encerrando...")
        stop_server(server)


if __name__ == "__main__":
    main()
