"""Configurações da pesquisa profunda por conta (nome do agente e rodadas)."""
from .prompts import SYSTEM_PROMPT_LOCK
from .config import DEEP_ROUNDS_LIMIT
import json
from .config import DEEP_RESEARCH_MAX_ROUNDS
from .config import DEEP_RESEARCH_AGENT
from .config import MEMORY_DIR


def deep_settings_path(user_id):
    safe_id = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )
    return MEMORY_DIR / ("%s.deep.json" % safe_id)


def get_deep_settings(user_id):
    """
    Configuração da pesquisa profunda da conta: nome do agente e limite de
    rodadas (cada rodada é um loop do pesquisador). Sem arquivo, padrões.
    """
    settings = {"agent": DEEP_RESEARCH_AGENT, "rounds": DEEP_RESEARCH_MAX_ROUNDS}

    if not user_id:
        return settings

    try:
        raw = json.loads(deep_settings_path(user_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return settings

    if not isinstance(raw, dict):
        return settings

    agent = raw.get("agent")
    if isinstance(agent, str) and agent.strip():
        settings["agent"] = agent.strip()[:40]

    rounds = raw.get("rounds")
    if isinstance(rounds, int) and not isinstance(rounds, bool):
        settings["rounds"] = max(1, min(DEEP_ROUNDS_LIMIT, rounds))

    return settings


def save_deep_settings(user_id, agent, rounds):
    """Grava a configuração da pesquisa profunda; devolve a efetiva."""
    settings = {
        "agent": agent.strip()[:40] or DEEP_RESEARCH_AGENT,
        "rounds": max(1, min(DEEP_ROUNDS_LIMIT, rounds)),
    }

    path = deep_settings_path(user_id)

    with SYSTEM_PROMPT_LOCK:
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(settings, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(path)

    return settings
