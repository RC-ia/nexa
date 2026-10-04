"""Interface web para geração de imagens usando a API da Novita AI."""

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

IMAGE_API_URL = os.getenv(
    "IMAGE_API_URL", "https://api.novita.ai/openai/v1/images/generations"
).strip()
IMAGE_API_KEY = os.getenv("API_IMAGE", "").strip()
IMAGE_MODEL = os.getenv("MODEL_IMAGE", "").strip()
IMAGE_TIMEOUT = max(30, int(os.getenv("IMAGE_GENERATION_TIMEOUT", "300")))
IMAGE_OUTPUT_FORMAT = os.getenv("IMAGE_OUTPUT_FORMAT", "png").strip() or "png"
IMAGE_RESPONSE_FORMAT = os.getenv("IMAGE_RESPONSE_FORMAT", "b64_json").strip() or "b64_json"
IMAGE_SIZE = os.getenv("IMAGE_SIZE", "1024x1024").strip() or "1024x1024"
IMAGE_WATERMARK = os.getenv("IMAGE_WATERMARK", "false").strip().lower() in {
    "1", "true", "yes", "on"
}
MAX_PROMPT_LENGTH = max(100, min(10000, int(os.getenv("MAX_PROMPT_LENGTH", "4000"))))

app = Flask(
    __name__,
    template_folder=str(BASE_DIR / "templates"),
    static_folder=str(BASE_DIR / "static"),
)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024


def configured() -> bool:
    return bool(IMAGE_API_KEY and IMAGE_MODEL)


def configured_model() -> str:
    return IMAGE_MODEL or "modelo não configurado"


def compact_error(response: requests.Response) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            detail = payload.get("detail") or payload.get("error") or payload.get("message")
            if detail:
                return str(detail)[:300]
    except ValueError:
        pass
    return response.text.strip()[:300] or f"HTTP {response.status_code}"


def save_image(encoded_image: str) -> str:
    if "," in encoded_image and encoded_image.startswith("data:"):
        encoded_image = encoded_image.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(encoded_image, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("O provedor devolveu uma imagem inválida.") from error

    if not image_bytes or len(image_bytes) > 25 * 1024 * 1024:
        raise ValueError("A imagem devolvida excede o limite permitido.")

    extension = IMAGE_OUTPUT_FORMAT.lower().lstrip(".")
    if extension == "jpeg":
        extension = "jpg"
    filename = f"{uuid.uuid4().hex}.{extension or 'png'}"
    (OUTPUT_DIR / filename).write_bytes(image_bytes)
    return filename


def build_generation_payload(prompt: str) -> dict[str, Any]:
    return {
        "model": IMAGE_MODEL,
        "prompt": prompt,
        "output_format": IMAGE_OUTPUT_FORMAT,
        "response_format": IMAGE_RESPONSE_FORMAT,
        "size": IMAGE_SIZE,
        "watermark": IMAGE_WATERMARK,
    }


@app.get("/")
def index():
    return render_template(
        "index.html",
        model_name=configured_model(),
    )


@app.get("/generated/<path:filename>")
def generated_file(filename: str):
    return send_from_directory(OUTPUT_DIR, filename, max_age=86400)


@app.get("/api/status")
def status():
    started = time.perf_counter()
    ready = configured()
    return jsonify(
        {
            "ok": ready,
            "status": "configured" if ready else "unconfigured",
            "provider": "novita",
            "model": IMAGE_MODEL,
            "latency_ms": round((time.perf_counter() - started) * 1000),
        }
    )


@app.post("/api/generate")
def generate():
    body = request.get_json(silent=True) or {}
    prompt = str(body.get("prompt", "")).strip()

    if not prompt:
        return jsonify({"error": "Descreva a imagem antes de gerar."}), 400
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"O texto deve ter no máximo {MAX_PROMPT_LENGTH} caracteres."}), 400
    if not configured():
        return jsonify({"error": "Configure API_IMAGE e MODEL_IMAGE no servidor."}), 503

    payload = build_generation_payload(prompt)
    headers = {
        "Authorization": f"Bearer {IMAGE_API_KEY}",
        "Content-Type": "application/json",
    }
    started = time.perf_counter()
    result: dict[str, Any] = {}
    try:
        response = requests.post(
            IMAGE_API_URL,
            json=payload,
            headers=headers,
            timeout=IMAGE_TIMEOUT,
        )
        response.raise_for_status()
        result = response.json()
        images = result.get("data") or []
        if not images:
            return jsonify({"error": "A Novita AI não devolveu uma imagem."}), 502
        first = images[0]
        encoded = first.get("b64_json")
        if encoded:
            filename = save_image(str(encoded))
        else:
            image_url = first.get("url")
            if not image_url:
                return jsonify({"error": "A Novita AI devolveu uma resposta sem imagem."}), 502
            image_response = requests.get(image_url, timeout=IMAGE_TIMEOUT)
            image_response.raise_for_status()
            filename = save_image(base64.b64encode(image_response.content).decode("ascii"))
    except requests.Timeout:
        return jsonify({"error": "A geração demorou mais que o limite configurado."}), 504
    except requests.RequestException as error:
        detail = compact_error(error.response) if error.response is not None else str(error)
        return jsonify({"error": f"Não foi possível falar com a Novita AI: {detail}"}), 502
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        return jsonify({"error": f"Resposta inválida da Novita AI: {error}"}), 502

    generator_root = request.script_root.rstrip("/")
    return jsonify(
        {
            "ok": True,
            "provider": "Novita AI",
            "image_url": f"{generator_root}/generated/{filename}",
            "model": IMAGE_MODEL,
            "duration_ms": round((time.perf_counter() - started) * 1000),
        }
    )


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({"error": "A requisição é muito grande."}), 413


if __name__ == "__main__":
    port = int(os.getenv("IMAGE_APP_PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)