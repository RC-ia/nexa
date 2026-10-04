"""Chat web para geração de imagens com Automatic1111 e modelos do Civitai."""

from __future__ import annotations

import base64
import binascii
import json
import os
import time
import uuid
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BASE_DIR / ".env")

OUTPUT_DIR = BASE_DIR / os.getenv("IMAGE_OUTPUT_DIR", "generated")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

A1111_URL = (
    os.getenv("AUTOMATIC1111_URL", "http://127.0.0.1:7860").strip().rstrip("/")
)
A1111_API_KEY = os.getenv("AUTOMATIC1111_API_KEY", "").strip()
A1111_CHECKPOINT = os.getenv("AUTOMATIC1111_CHECKPOINT", "").strip()
A1111_TIMEOUT = max(30, int(os.getenv("AUTOMATIC1111_TIMEOUT", "300")))
A1111_STEPS = max(1, min(150, int(os.getenv("AUTOMATIC1111_STEPS", "28"))))
A1111_WIDTH = max(256, min(2048, int(os.getenv("AUTOMATIC1111_WIDTH", "768"))))
A1111_HEIGHT = max(256, min(2048, int(os.getenv("AUTOMATIC1111_HEIGHT", "768"))))
A1111_CFG_SCALE = max(1, min(30, float(os.getenv("AUTOMATIC1111_CFG_SCALE", "7"))))
A1111_SAMPLER = os.getenv("AUTOMATIC1111_SAMPLER", "DPM++ 2M Karras").strip()
A1111_NEGATIVE_PROMPT = os.getenv(
    "AUTOMATIC1111_NEGATIVE_PROMPT",
    "low quality, blurry, distorted, deformed, bad anatomy",
).strip()
CIVITAI_URL = os.getenv("CIVITAI_URL", "https://civitai.com/api/v1").strip().rstrip("/")
CIVITAI_API_KEY = os.getenv("CIVITAI_API_KEY", "").strip()
MAX_PROMPT_LENGTH = max(100, min(10000, int(os.getenv("MAX_PROMPT_LENGTH", "4000"))))

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024


def a1111_headers() -> dict[str, str]:
    """Monta os cabeçalhos sem expor a chave nos logs ou nas respostas."""
    if not A1111_API_KEY:
        return {}
    return {"Authorization": f"Bearer {A1111_API_KEY}"}


def civitai_headers() -> dict[str, str]:
    if not CIVITAI_API_KEY:
        return {}
    return {"Authorization": f"Bearer {CIVITAI_API_KEY}"}


def configured_model() -> str:
    return A1111_CHECKPOINT or "modelo padrão do Automatic1111"


def compact_error(response: requests.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            detail = payload.get("detail") or payload.get("error")
            if detail:
                return str(detail)[:300]
    except ValueError:
        pass
    return response.text.strip()[:300] or f"HTTP {response.status_code}"


def parse_generation_info(raw_info: Any) -> dict[str, Any]:
    if isinstance(raw_info, dict):
        return raw_info
    if not isinstance(raw_info, str) or not raw_info.strip():
        return {}
    try:
        parsed = json.loads(raw_info)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def save_image(encoded_image: str) -> str:
    if "," in encoded_image and encoded_image.startswith("data:"):
        encoded_image = encoded_image.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("O Automatic1111 devolveu uma imagem inválida.") from error

    if not image_bytes or len(image_bytes) > 25 * 1024 * 1024:
        raise ValueError("A imagem devolvida excede o limite permitido.")

    filename = f"{uuid.uuid4().hex}.png"
    (OUTPUT_DIR / filename).write_bytes(image_bytes)
    return filename


def build_generation_payload(prompt: str, model: str = "") -> dict[str, Any]:
    payload: dict[str, Any] = {
        "prompt": prompt,
        "negative_prompt": A1111_NEGATIVE_PROMPT,
        "steps": A1111_STEPS,
        "width": A1111_WIDTH,
        "height": A1111_HEIGHT,
        "cfg_scale": A1111_CFG_SCALE,
        "sampler_name": A1111_SAMPLER,
        "batch_size": 1,
        "n_iter": 1,
        "send_images": True,
        "save_images": False,
    }
    checkpoint = model.strip() or A1111_CHECKPOINT
    if checkpoint and checkpoint.lower() not in {"default", "none", "auto"}:
        payload["override_settings"] = {"sd_model_checkpoint": checkpoint}
        payload["override_settings_restore_afterwards"] = True
    return payload


@app.get("/")
def index():
    return render_template(
        "index.html",
        model_name=configured_model(),
        a1111_url=A1111_URL,
    )


@app.get("/generated/<path:filename>")
def generated_file(filename: str):
    return send_from_directory(OUTPUT_DIR, filename, max_age=86400)


@app.get("/api/status")
def status():
    started = time.perf_counter()
    try:
        response = requests.get(
            f"{A1111_URL}/sdapi/v1/options",
            headers=a1111_headers(),
            timeout=4,
        )
        response.raise_for_status()
        options = response.json() if response.content else {}
        active_model = options.get("sd_model_checkpoint", configured_model())
        return jsonify(
            {
                "ok": True,
                "automatic1111": "online",
                "model": active_model,
                "civitai": bool(CIVITAI_API_KEY),
                "latency_ms": round((time.perf_counter() - started) * 1000),
            }
        )
    except (requests.RequestException, ValueError, TypeError):
        return jsonify(
            {
                "ok": False,
                "automatic1111": "offline",
                "model": configured_model(),
                "civitai": bool(CIVITAI_API_KEY),
            }
        )


@app.get("/api/civitai/models")
def civitai_models():
    query = request.args.get("q", "").strip()
    try:
        limit = max(1, min(20, int(request.args.get("limit", "8"))))
    except ValueError:
        limit = 8

    params: dict[str, Any] = {"limit": limit, "sort": "Most Downloaded"}
    if query:
        params["query"] = query

    try:
        response = requests.get(
            f"{CIVITAI_URL}/models",
            params=params,
            headers=civitai_headers(),
            timeout=12,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as error:
        return jsonify({"error": f"Não foi possível consultar o Civitai: {error}"}), 502

    models = []
    for item in data.get("items", []):
        versions = item.get("modelVersions") or []
        latest = versions[0] if versions else {}
        models.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "type": item.get("type"),
                "nsfw": item.get("nsfw", False),
                "version_id": latest.get("id"),
                "version_name": latest.get("name"),
                "base_model": latest.get("baseModel"),
                "url": f"https://civitai.com/models/{item.get('id')}",
            }
        )
    return jsonify({"items": models})


@app.post("/api/generate")
def generate():
    body = request.get_json(silent=True) or {}
    prompt = str(body.get("prompt", "")).strip()
    model = str(body.get("model", "")).strip()

    if not prompt:
        return jsonify({"error": "Descreva a imagem antes de gerar."}), 400
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"O texto deve ter no máximo {MAX_PROMPT_LENGTH} caracteres."}), 400
    if len(model) > 240:
        return jsonify({"error": "Identificador de modelo inválido."}), 400

    payload = build_generation_payload(prompt, model)
    started = time.perf_counter()
    try:
        response = requests.post(
            f"{A1111_URL}/sdapi/v1/txt2img",
            json=payload,
            headers=a1111_headers(),
            timeout=A1111_TIMEOUT,
        )
        response.raise_for_status()
        result = response.json()
        images = result.get("images") or []
        if not images:
            return jsonify({"error": "O Automatic1111 não devolveu uma imagem."}), 502
        filename = save_image(str(images[0]))
    except requests.Timeout:
        return jsonify({"error": "A geração demorou mais que o limite configurado."}), 504
    except requests.RequestException as error:
        detail = compact_error(error.response) if error.response is not None else str(error)
        return jsonify({"error": f"Não foi possível falar com o Automatic1111: {detail}"}), 502
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        return jsonify({"error": f"Resposta inválida do Automatic1111: {error}"}), 502

    info = parse_generation_info(result.get("info"))
    return jsonify(
        {
            "ok": True,
            "image_url": f"/generated/{filename}",
            "seed": info.get("seed"),
            "model": info.get("sd_model_name") or model or configured_model(),
            "duration_ms": round((time.perf_counter() - started) * 1000),
        }
    )


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "A requisição é muito grande."}), 413


if __name__ == "__main__":
    port = int(os.getenv("IMAGE_APP_PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
