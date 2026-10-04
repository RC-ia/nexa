"""Integra o gerador de imagens local ao servidor principal da NEXA."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

BASE_DIR = Path(__file__).resolve().parent
GENERATOR_SOURCE = BASE_DIR / "geração de imagem local" / "app.py"


def _load_generator_module() -> ModuleType:
    # O import por caminho mantém o código existente na pasta com nome legível,
    # mesmo que o sistema operacional não aceite esse nome como identificador.
    spec = importlib.util.spec_from_file_location(
        "nexa_local_image_generator", GENERATOR_SOURCE
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Não foi possível carregar o gerador: {GENERATOR_SOURCE}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_generator_module = _load_generator_module()
app = _generator_module.app
