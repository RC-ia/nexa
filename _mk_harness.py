import io
import os
import shutil

ROOT = os.path.dirname(os.path.abspath(__file__))

# Copia studio.html como pagina de teste, injetando a "session key" antes do studio.js.
src = io.open(os.path.join(ROOT, "studio.html"), encoding="utf-8").read()
src = src.replace("<title>Estudio | NEXA</title>", "<title>Harness Estudio | NEXA</title>")
preload = (
    '<script>try { localStorage.setItem("nexa_message_key:teste", "x"); } catch (e) { }</script>\n'
    '  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>'
)
src = src.replace(
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>',
    preload,
    1,
)
io.open(os.path.join(ROOT, "_studio_test.html"), "w", encoding="utf-8", newline="\n").write(src)

# Fixtures: arquivos reais para a arvore e para a exclusao em disco.
files_dir = os.path.join(ROOT, "_harness_files")
if os.path.isdir(files_dir):
    shutil.rmtree(files_dir)

fixtures = {
    "site/index.html": "<!DOCTYPE html>\n<html><body><h1>Ola</h1></body></html>\n",
    "site/estilo.css": "body { background: #111; }\n",
    "jogo.py": "print('jogo')\n",
    "notas.md": "# notas\n",
}

for rel, content in fixtures.items():
    full = os.path.join(files_dir, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, "w", encoding="utf-8", newline="\n").write(content)

print("harness pronto: %d fixtures" % len(fixtures))
