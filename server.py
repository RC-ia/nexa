"""NEXA — entrypoint do servidor.

A implementação vive no pacote nexa/ (refatorado a partir do server.py
monolítico; comportamento preservado). Rode com `python server.py` como
antes — run.py, launcher.py e o Painel admin continuam funcionando igual.
"""
import sys
from pathlib import Path

# Garante que a raiz do projeto esteja no sys.path (importa `nexa` e `auth`).
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nexa.app import main  # noqa: E402

if __name__ == "__main__":
    main()
