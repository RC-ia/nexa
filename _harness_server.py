import http.server
import json
import os
import socketserver
import time
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
FILES_DIR = os.path.join(ROOT, "_harness_files")
PORT = 8123


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _resolve(self, caminho):
        root = os.path.realpath(FILES_DIR)
        candidate = os.path.realpath(os.path.join(root, caminho.replace("\\", "/")))
        if candidate != root and not candidate.startswith(root + os.sep):
            return None
        return candidate

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/auth/me":
            self._json({"user": {"id": "harness", "username": "teste"}})
            return

        if path == "/api/studio/files":
            files = []
            if os.path.isdir(FILES_DIR):
                for base, dirs, names in os.walk(FILES_DIR):
                    dirs.sort()
                    for name in sorted(names):
                        if name.endswith(".tmp"):
                            continue
                        full = os.path.join(base, name)
                        rel = os.path.relpath(full, FILES_DIR).replace(os.sep, "/")
                        st = os.stat(full)
                        files.append({
                            "caminho": rel,
                            "tamanho": st.st_size,
                            "modificado": int(st.st_mtime),
                        })
            self._json({"files": files})
            return

        if path == "/api/studio/file":
            qs = parse_qs(urlparse(self.path).query)
            caminho = (qs.get("caminho") or [""])[0]
            target = self._resolve(caminho)
            if not target or not os.path.isfile(target):
                self._json({"error": "Arquivo nao encontrado."}, 404)
                return
            try:
                with open(target, "rb") as fh:
                    data = fh.read()
                content = data.decode("utf-8")
            except UnicodeDecodeError:
                self._json({"error": "Arquivo binario."}, 415)
                return
            except OSError as error:
                self._json({"error": str(error)}, 500)
                return
            self._json({"caminho": caminho, "conteudo": content})
            return

        super().do_GET()

    def do_DELETE(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/studio/file":
            qs = parse_qs(urlparse(self.path).query)
            caminho = (qs.get("caminho") or [""])[0]
            target = self._resolve(caminho)
            if not target or not os.path.isfile(target):
                self._json({"error": "Arquivo nao encontrado."}, 404)
                return
            try:
                os.remove(target)
            except OSError as error:
                self._json({"error": "Nao foi possivel excluir: %s" % error}, 500)
                return
            self._json({"ok": True, "caminho": caminho})
            return

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/studio/chat":
            try:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                for i in range(12):
                    chunk = 'data: {"type":"text","text":"palavra%d "}\n\n' % i
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                    time.sleep(0.3)
            except OSError:
                pass
            return

        self._json({"error": "not found"}, 404)

    def log_message(self, *args):
        pass


socketserver.ThreadingTCPServer.allow_reuse_address = True

if __name__ == "__main__":
    with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
        httpd.serve_forever()
