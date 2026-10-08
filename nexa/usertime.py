"""Fuso horário por conta e utilitários de data/hora do usuário."""
from .config import WEEK_DAYS
from datetime import datetime, timedelta, timezone
from .prompts import SYSTEM_PROMPT_LOCK
import json
from .config import MEMORY_DIR
import os


TIME_DEFAULT_OFFSET = float(os.environ.get("NEXA_UTC_OFFSET", "-3"))


def time_offset(value):
    """Deslocamento válido, em horas, dentro de -12..14; senão, o padrão."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        return TIME_DEFAULT_OFFSET

    if not -12 <= value <= 14:
        return TIME_DEFAULT_OFFSET

    return round(value, 2)


def time_settings_path(user_id):
    safe_id = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )
    return MEMORY_DIR / ("%s.tz.json" % safe_id)


def get_time_settings(user_id):
    """Fuso da conta: {'offset': horas}. Sem arquivo, usa o padrão."""
    settings = {"offset": TIME_DEFAULT_OFFSET}

    if not user_id:
        return settings

    try:
        raw = json.loads(time_settings_path(user_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return settings

    if isinstance(raw, dict) and "offset" in raw:
        settings["offset"] = time_offset(raw.get("offset"))

    return settings


def save_time_settings(user_id, offset):
    """Grava o fuso da conta; devolve o efetivo."""
    settings = {"offset": time_offset(offset)}
    path = time_settings_path(user_id)

    with SYSTEM_PROMPT_LOCK:
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(settings, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(path)

    return settings


def format_offset(offset):
    """Deslocamento formatado para exibição: 'UTC-3', 'UTC+5:30'."""
    sign = "+" if offset >= 0 else "-"
    hours = abs(offset)
    whole = int(hours)
    minutes = int(round((hours - whole) * 60))

    if minutes:
        return "UTC%s%d:%02d" % (sign, whole, minutes)

    return "UTC%s%d" % (sign, whole)


def user_now(user_id):
    """Agora no fuso do usuário (naive), em vez do fuso da máquina."""
    offset = get_time_settings(user_id)["offset"]
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=offset)


def user_epoch(user_id, moment):
    """Epoch de um datetime naive interpretado no fuso do usuário."""
    offset = get_time_settings(user_id)["offset"]
    return int(moment.replace(tzinfo=timezone(timedelta(hours=offset))).timestamp())


def user_moment(user_id, epoch):
    """Datetime naive no fuso do usuário a partir de um epoch."""
    offset = get_time_settings(user_id)["offset"]
    return datetime.fromtimestamp(
        float(epoch), timezone(timedelta(hours=offset))
    ).replace(tzinfo=None)


def current_time_text(user_id):
    """Resposta da ferramenta data_hora: agora no fuso do usuário."""
    agora = user_now(user_id)
    return "Agora: %s, %s (%s)." % (
        WEEK_DAYS[(agora.weekday() + 1) % 7],
        agora.strftime("%d/%m/%Y %H:%M"),
        format_offset(get_time_settings(user_id)["offset"]),
    )
