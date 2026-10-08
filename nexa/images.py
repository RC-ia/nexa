"""Gerador de imagens (Novita AI): config, agente de prompt e rotas."""
import json
import time
from .webhelpers import request_json_object
from .webhelpers import message_key_error
from flask import send_from_directory
from flask import jsonify
from auth import current_user
from .app import app
from .llm import extract_text
from .config import CONNECT_TIMEOUT
from .llm import auth_headers
from .config import API_BASE
import requests
from .prompts import current_spicy_prompt
from .config import API_KEY
from .config import MODEL
import uuid
import binascii
import base64
import os
from .config import BASE_DIR


IMAGE_OUTPUT_DIR = BASE_DIR / os.environ.get("IMAGE_OUTPUT_DIR", "generated")


IMAGE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


IMAGE_API_URL = os.environ.get(
    "IMAGE_API_URL", "https://api.novita.ai/openai/v1/images/generations"
).strip()


IMAGE_API_KEY = os.environ.get("API_IMAGE", "").strip()


IMAGE_MODEL = os.environ.get("MODEL_IMAGE", "").strip()


IMAGE_TIMEOUT = max(30, int(os.environ.get("IMAGE_GENERATION_TIMEOUT", "300")))


IMAGE_OUTPUT_FORMAT = os.environ.get("IMAGE_OUTPUT_FORMAT", "png").strip() or "png"


IMAGE_RESPONSE_FORMAT = (
    os.environ.get("IMAGE_RESPONSE_FORMAT", "b64_json").strip() or "b64_json"
)


IMAGE_SIZE = os.environ.get("IMAGE_SIZE", "1024x1024").strip() or "1024x1024"


IMAGE_WATERMARK = os.environ.get("IMAGE_WATERMARK", "false").strip().lower() in {
    "1", "true", "yes", "on",
}


MAX_PROMPT_LENGTH = max(100, min(10000, int(os.environ.get("MAX_PROMPT_LENGTH", "4000"))))


IMAGE_PROMPT_AGENT = os.environ.get(
    "IMAGE_PROMPT_AGENT", "true"
).strip().lower() not in {"0", "false", "no", "off", ""}


IMAGE_PROMPT_AGENT_TIMEOUT = max(
    15, int(os.environ.get("IMAGE_PROMPT_AGENT_TIMEOUT", "60"))
)


IMAGE_PROMPT_AGENT_MAX_TOKENS = max(
    120, min(2000, int(os.environ.get("IMAGE_PROMPT_AGENT_MAX_TOKENS", "600")))
)


IMAGE_PROMPT_AGENT_PROMPT = (
    "You are the image prompt agent for NEXA. You receive what a user wrote "
    "about the image they want, in any language, and you rewrite it as a "
    "single English prompt for a text-to-image model.\n\n"
    "Rules:\n"
    "- Always answer in English, even if the request is in another language.\n"
    "- Keep the subject, the action and the intent exactly as asked. Never "
    "change who or what is depicted, and never add text, logos or watermarks "
    "unless the user explicitly asked for words.\n"
    "- Enrich the prompt with concrete visual detail that fits the request: "
    "setting and background, composition and framing, camera angle and "
    "lens, lighting and time of day, colour palette, materials and textures, "
    "mood, and rendering style (for example photograph, illustration, 3D "
    "render, oil painting, anime, pixel art) when the user leaves it open.\n"
    "- Do not invent a specific real person, brand or copyrighted character. "
    "Describe the style instead when the user asks for something like that.\n"
    "- Do not contradict the user. If the request is vague, choose sensible "
    "defaults rather than asking questions.\n"
    "- Return one dense paragraph, no headings, no lists, no quotes, no "
    "explanation and no translation notes. 40 to 90 words."
)


def _image_configured():
    return bool(IMAGE_API_KEY and IMAGE_MODEL)


def _image_compact_error(response):
    try:
        payload = response.json()
        if isinstance(payload, dict):
            detail = payload.get("detail") or payload.get("error") or payload.get("message")
            if detail:
                return str(detail)[:300]
    except ValueError:
        pass
    return response.text.strip()[:300] or f"HTTP {response.status_code}"


def _image_save(encoded_image):
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
    (IMAGE_OUTPUT_DIR / filename).write_bytes(image_bytes)
    return filename


def image_prompt_agent_model():
    """Modelo do agente de imagem: o modelo base padrão."""
    return MODEL


def expand_image_prompt(prompt, spicy=False, user_id=""):
    """
    Agente de imagem: traduz o pedido do usuário para inglês e completa com
    detalhes de cena, luz, estilo e composição antes de chamar o modelo de
    imagem. Devolve (prompt_usado, reescrito).

    Com spicy=True (botão 😈 do modo imagem) o agente safadinho assume o
    system prompt: as instruções sensuais do próprio usuário, ou o padrão
    dele quando não houver personalização.

    Qualquer falha no agente não impede a geração: o prompt original segue
    para o modelo de imagem.
    """
    original = str(prompt or "").strip()

    if not IMAGE_PROMPT_AGENT or not original:
        return original, ""

    model = image_prompt_agent_model()

    if not API_KEY or not model:
        return original, ""

    system_prompt = (
        current_spicy_prompt(user_id) if spicy else IMAGE_PROMPT_AGENT_PROMPT
    )

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": original[:MAX_PROMPT_LENGTH]},
        ],
        "stream": False,
        "max_tokens": IMAGE_PROMPT_AGENT_MAX_TOKENS,
    }

    try:
        response = requests.post(
            API_BASE + "/chat/completions",
            headers=auth_headers(),
            json=body,
            timeout=(CONNECT_TIMEOUT, IMAGE_PROMPT_AGENT_TIMEOUT),
        )
        if response.status_code != 200:
            raise RuntimeError("HTTP %d" % response.status_code)
        rewritten = " ".join((extract_text(response.json()) or "").split())
    except (requests.RequestException, RuntimeError, ValueError) as error:
        print("[NEXA-IMAGEM-PROMPT] agente indisponível; usando o texto original: %s" % error)
        return original, ""

    if not rewritten:
        return original, ""

    return rewritten[:MAX_PROMPT_LENGTH], rewritten


@app.get("/api/images/status")
def image_status():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login."}), 401

    return jsonify({
        "ok": _image_configured(),
        "status": "configured" if _image_configured() else "unconfigured",
        "provider": "novita",
        "model": IMAGE_MODEL,
    })


@app.get("/generated/<path:filename>")
def generated_image(filename):
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login."}), 401

    return send_from_directory(IMAGE_OUTPUT_DIR, filename, max_age=86400)


@app.delete("/generated/<path:filename>")
def delete_generated_image(filename):
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login para apagar imagens."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    # Só o nome base dentro da pasta de saída: nada escapa por traversal.
    name = os.path.basename(filename.replace("\\", "/"))
    target = IMAGE_OUTPUT_DIR / name

    if not target.is_file():
        # Apagar é idempotente: já sumiu, sucesso.
        return jsonify({"ok": True, "apagado": False})

    try:
        target.unlink()
    except OSError as error:
        return jsonify({"error": "Não foi possível apagar: %s" % error}), 500

    return jsonify({"ok": True, "apagado": True, "caminho": name})


@app.post("/api/images/generate")
def generate_image():
    user = current_user()
    if user is None:
        return jsonify({"error": "Faça login."}), 401

    key_error = message_key_error(user)
    if key_error:
        return key_error

    body = request_json_object()
    prompt = str(body.get("prompt", "")).strip()

    if not prompt:
        return jsonify({"error": "Descreva a imagem antes de gerar."}), 400
    if len(prompt) > MAX_PROMPT_LENGTH:
        return jsonify({"error": f"O texto deve ter no máximo {MAX_PROMPT_LENGTH} caracteres."}), 400
    if not _image_configured():
        return jsonify({"error": "Configure API_IMAGE e MODEL_IMAGE no servidor."}), 503

    # Agente de prompt: o texto do usuário vira um prompt em inglês,
    # mais detalhado, antes de ir para o modelo de imagem. O botão 😈 do
    # modo imagem liga o agente safadinho nessa reescrita.
    spicy = body.get("spicy") is True
    user_id = "acct_%d" % user["id"]
    prompt, rewritten_prompt = expand_image_prompt(
        prompt, spicy=spicy, user_id=user_id
    )

    payload = {
        "model": IMAGE_MODEL,
        "prompt": prompt,
        "output_format": IMAGE_OUTPUT_FORMAT,
        "response_format": IMAGE_RESPONSE_FORMAT,
        "size": IMAGE_SIZE,
        "watermark": IMAGE_WATERMARK,
    }
    headers = {
        "Authorization": f"Bearer {IMAGE_API_KEY}",
        "Content-Type": "application/json",
    }
    started = time.perf_counter()
    result = {}
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
            filename = _image_save(str(encoded))
        else:
            image_url = first.get("url")
            if not image_url:
                return jsonify({"error": "A Novita AI devolveu uma resposta sem imagem."}), 502
            image_response = requests.get(image_url, timeout=IMAGE_TIMEOUT)
            image_response.raise_for_status()
            filename = _image_save(base64.b64encode(image_response.content).decode("ascii"))
    except requests.Timeout:
        return jsonify({"error": "A geração demorou mais que o limite configurado."}), 504
    except requests.RequestException as error:
        detail = _image_compact_error(error.response) if error.response is not None else str(error)
        return jsonify({"error": f"Não foi possível falar com a Novita AI: {detail}"}), 502
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        return jsonify({"error": f"Resposta inválida da Novita AI: {error}"}), 502

    return jsonify({
        "ok": True,
        "provider": "Novita AI",
        "image_url": f"/generated/{filename}",
        "model": IMAGE_MODEL,
        "prompt": rewritten_prompt or prompt,
        "prompt_agent": {
            "enabled": IMAGE_PROMPT_AGENT,
            "model": image_prompt_agent_model() if IMAGE_PROMPT_AGENT else "",
            "spicy": spicy,
        },
        "duration_ms": round((time.perf_counter() - started) * 1000),
    })
