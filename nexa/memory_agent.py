"""Agente de memória: observa as conversas em segundo plano e registra o que
é durável sobre o usuário.

Ele nunca entra no caminho da resposta. Cada turno concluído vira uma
observação pendente; quando a janela enche (5 turnos), quando os turnos
passam de 1 dia esperando ou quando um chat novo é criado, o observador é
chamado em uma thread própria, grava observações estruturadas e promove ao
documento de memória o que já tem confiança.

A Fase 3 acrescenta a reflexão periódica: uma vez por dia o mesmo agente
olha a loja inteira de observações e consolida, refina e limpa o que está
velho. A reflexão roda em segundo plano, na fila dos workers, com o seu
próprio orçamento de tentativas.
"""
from .config import (
    API_KEY,
    MEMORY_AGENT_MAX_AGE,
    MEMORY_AGENT_MAX_FAILURES,
    MEMORY_AGENT_MAX_TOKENS,
    MEMORY_AGENT_MODEL,
    MEMORY_AGENT_PENDING_LIMIT,
    MEMORY_AGENT_POLL_SECONDS,
    MEMORY_AGENT_PROMPT,
    MEMORY_AGENT_TRIGGER_TURNS,
    MEMORY_AGENT_WINDOW_TURNS,
    MEMORY_CATEGORIES,
    MEMORY_DIR,
    MEMORY_REFLECTION_CONTEXT_COUNT,
    MEMORY_REFLECTION_INTERVAL,
    MEMORY_REFLECTION_MAX_FAILURES,
    MEMORY_REFLECTION_MAX_TOKENS,
    MEMORY_REFLECTION_MIN_OBSERVATIONS,
    MEMORY_REFLECTION_POLL_SECONDS,
    MEMORY_REFLECTION_PROMPT,
)
from .llm import RetryBudget
from .llm import call_model
from .llm import extract_text
from .llm import log_upstream_error
from .memory import account_lock
from .memory import apply_decay
from .memory import get_observation_stats
from .memory import load_observations
from .memory import merge_observations
from .memory import promote_observations
from .memory import safe_account_name
from .memory import update_activity
from datetime import datetime
from datetime import timezone
import json
import queue
import re
import threading
import time
import unicodedata


STATE_SUFFIX = ".memory_agent.json"


# Limites de tamanho por turno: o observador precisa de contexto, não de
# transcrição.
TURN_USER_LIMIT = 1200
TURN_ASSISTANT_LIMIT = 1200
FACT_LIMIT = 240
EVIDENCE_LIMIT = 300


# Frases que transformariam uma observação em instrução para o modelo do
# chat. Observação é contexto; se parece ordem, é descartada.
_INSTRUCTION_PATTERNS = (
    re.compile(r"ignore\s+(all\s+)?(the\s+)?(previous|above|prior)", re.I),
    re.compile(r"ignora\s+(as\s+)?(instru|regras|previous)", re.I),
    re.compile(r"\bsystem\s*:", re.I),
    re.compile(r"\bassistant\s*:", re.I),
    re.compile(r"\byou are\s+", re.I),
    re.compile(r"voc[eê]\s+[eé]\s+(um|uma)\s+(agente|assistente|sistema)", re.I),
    re.compile(r"instru[cç][aã]o\s*:", re.I),
    re.compile(r"\bprompt\s*:", re.I),
    re.compile(r"sempre\s+(responda|fa[cç]a|use|execute)", re.I),
    re.compile(r"nunca\s+(responda|mencione|use|execute)", re.I),
    re.compile(r"chame\s+(a\s+)?ferramenta", re.I),
    re.compile(r"tool[_ ]?call", re.I),
    re.compile(r"<\|"),
    re.compile(r"```"),
    re.compile(r"execute\s+(code|script|comando)", re.I),
)


# Segredos nunca entram na memória.
_SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{16,}", re.I),
    re.compile(
        r"\b(senha|password|passwd|api[_ -]?key|secret|token)\b"
        r"(?:\s+\S+){0,3}\s*[:=]\s*\S+",
        re.I,
    ),
    re.compile(r"\b[A-Fa-f0-9]{40,}\b"),
    re.compile(r"\b[A-Za-z0-9+/]{48,}={0,2}\b"),
)


_JOBS = queue.Queue()
_WORKERS_GUARD = threading.Lock()
_WORKERS_STARTED = False
WORKER_COUNT = 2


# Tipos de trabalho na fila do agente.
JOB_OBSERVE = "observe"
JOB_REFLECT = "reflect"
JOB_REFLECT_NOW = "reflect_now"


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _clip(text, limit):
    if not isinstance(text, str):
        return ""
    cleaned = " ".join(text.split())
    return cleaned[:limit]


def _state_path(user_id):
    return MEMORY_DIR / ("%s%s" % (safe_account_name(user_id), STATE_SUFFIX))


def load_state(user_id):
    """Estado do agente para uma conta (turnos pendentes e controles)."""
    try:
        data = json.loads(_state_path(user_id).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}

    if not isinstance(data, dict):
        data = {}

    pending = data.get("pending")
    seen = data.get("seen_chats")

    data["pending"] = pending if isinstance(pending, list) else []
    data["seen_chats"] = seen if isinstance(seen, list) else []
    data["last_run_at"] = str(data.get("last_run_at") or "")
    data["last_attempt_at"] = float(data.get("last_attempt_at") or 0.0)
    data["failures"] = int(data.get("failures") or 0)
    data["runs"] = int(data.get("runs") or 0)
    data["force_run"] = bool(data.get("force_run"))
    data["running"] = bool(data.get("running"))

    # Estado da reflexão periódica (Fase 3).
    data["last_reflection_at"] = str(data.get("last_reflection_at") or "")
    data["reflection_failures"] = int(data.get("reflection_failures") or 0)
    data["reflections"] = int(data.get("reflections") or 0)
    data["reflection_running"] = bool(data.get("reflection_running"))
    data["force_reflection"] = bool(data.get("force_reflection"))

    return data


def save_state(user_id, state):
    """Grava o estado do agente. Quem chama precisa do lock da conta."""
    path = _state_path(user_id)
    temporary = path.with_suffix(".json.tmp")
    try:
        temporary.write_text(
            json.dumps(state, ensure_ascii=False), encoding="utf-8"
        )
        temporary.replace(path)
    except OSError as error:
        print("[NEXA-MEMÓRIA] falha ao salvar estado:", error)
        return False

    return True


def enqueue_turn(user_id, user_message, assistant_message, chat_id="",
                enabled=True):
    """Guarda um turno (usuário + resposta) para o observador.

    Devolve na hora: nada de esperar o modelo aqui. Quem chama é o fim do
    fluxo da conversa e não pode ser atrasado por um segundo request.
    """
    if not enabled:
        return False

    if not user_id or not API_KEY:
        return False

    user_text = _clip(user_message, TURN_USER_LIMIT)
    assistant_text = _clip(assistant_message, TURN_ASSISTANT_LIMIT)

    if not user_text or not assistant_text:
        return False

    turn = {
        "usuario": user_text,
        "assistente": assistant_text,
        "em": _now_iso(),
        "chat": _clip(chat_id, 100),
    }

    with account_lock(user_id):
        state = load_state(user_id)
        pending = state.get("pending") or []
        pending.append(turn)
        state["pending"] = pending[-MEMORY_AGENT_PENDING_LIMIT:]

        # Um turno novo é uma chance nova: zera a contagem de falhas.
        state["failures"] = 0

        if chat_id:
            seen = state.get("seen_chats") or []
            if chat_id not in seen:
                seen.append(chat_id)
                state["seen_chats"] = seen[-50:]
                state["force_run"] = True

        save_state(user_id, state)

    # Camada estatística: a atividade da conta é contada aqui, sem
    # chamar o modelo.
    update_activity(user_id, turns=1)

    _ensure_workers()
    _JOBS.put((JOB_OBSERVE, user_id))
    return True


def notify_new_chat(user_id, chat_id):
    """Avisa que um chat novo apareceu: o observador roda na hora."""
    if not user_id or not chat_id or not API_KEY:
        return False

    with account_lock(user_id):
        state = load_state(user_id)
        seen = state.get("seen_chats") or []
        if chat_id in seen:
            return False

        seen.append(chat_id)
        state["seen_chats"] = seen[-50:]
        state["force_run"] = True
        save_state(user_id, state)

    _ensure_workers()
    _JOBS.put((JOB_OBSERVE, user_id))
    return True


def _ensure_workers():
    global _WORKERS_STARTED

    with _WORKERS_GUARD:
        if _WORKERS_STARTED:
            return
        _WORKERS_STARTED = True

        for index in range(WORKER_COUNT):
            threading.Thread(
                target=_worker_loop,
                daemon=True,
                name="nexa-memoria-%d" % index,
            ).start()

        threading.Thread(
            target=_scheduler_loop,
            daemon=True,
            name="nexa-memoria-agenda",
        ).start()

        threading.Thread(
            target=_reflection_scheduler_loop,
            daemon=True,
            name="nexa-memoria-reflexao",
        ).start()


def _worker_loop():
    while True:
        job = _JOBS.get()
        try:
            kind, user_id = _read_job(job)
            if kind == JOB_REFLECT:
                _run_reflection(user_id, force=False)
            elif kind == JOB_REFLECT_NOW:
                _run_reflection(user_id, force=True)
            else:
                _process_account(user_id)
        except Exception as error:  # noqa: BLE001
            print("[NEXA-MEMÓRIA] falha inesperada no worker:", error)
        finally:
            _JOBS.task_done()


def _read_job(job):
    """Lê um trabalho da fila. Aceita o formato antigo (só o usuário)."""
    if isinstance(job, (tuple, list)) and len(job) >= 2:
        kind = str(job[0] or JOB_OBSERVE)
        user_id = str(job[1] or "")
        return kind, user_id

    return JOB_OBSERVE, str(job or "")


def _scheduler_loop():
    """Procura contas com turnos velhos: a regra de 1 dia precisa de um
    relógio, senão o agente só roda quando o usuário volta a falar."""
    while True:
        time.sleep(MEMORY_AGENT_POLL_SECONDS)
        try:
            _scan_accounts()
        except Exception as error:  # noqa: BLE001
            print("[NEXA-MEMÓRIA] falha na varredura:", error)


def _reflection_scheduler_loop():
    """Agenda da Fase 3: uma vez por hora aplica o decaimento em todas as
    contas e pede a reflexão das que já podem ser refletidas."""
    while True:
        time.sleep(MEMORY_REFLECTION_POLL_SECONDS)
        try:
            _scan_reflections()
        except Exception as error:  # noqa: BLE001
            print("[NEXA-MEMÓRIA] falha na varredura de reflexões:", error)


def _scan_accounts():
    try:
        paths = list(MEMORY_DIR.glob("*%s" % STATE_SUFFIX))
    except OSError:
        return

    for path in paths:
        account = path.name[:-len(STATE_SUFFIX)]
        if not account:
            continue

        state = load_state(account)
        pending = state.get("pending") or []
        if not pending:
            continue

        if _pending_age(pending) < MEMORY_AGENT_MAX_AGE:
            continue

        _JOBS.put(account)


def _pending_age(pending):
    """Idade, em segundos, do turno pendente mais antigo."""
    if not pending:
        return 0.0

    oldest = None
    for turn in pending:
        if not isinstance(turn, dict):
            continue
        stamp = turn.get("em")
        if not isinstance(stamp, str) or not stamp:
            continue
        try:
            moment = datetime.fromisoformat(stamp)
        except ValueError:
            continue
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        oldest = moment if oldest is None or moment < oldest else oldest

    if oldest is None:
        return 0.0

    return max(0.0, (datetime.now(timezone.utc) - oldest).total_seconds())


def _process_account(user_id):
    """Decide se o observador roda e, se sim, coleta a janela de turnos."""
    with account_lock(user_id):
        state = load_state(user_id)
        if state.get("running"):
            return False

        pending = state.get("pending") or []
        forced = bool(state.get("force_run"))

        if not forced and len(pending) < MEMORY_AGENT_TRIGGER_TURNS:
            if _pending_age(pending) < MEMORY_AGENT_MAX_AGE:
                return False

        if state.get("failures") >= MEMORY_AGENT_MAX_FAILURES:
            return False

        if not pending:
            # Nada para observar ainda. O pedido fica guardado: assim, o
            # observador roda assim que entrar o primeiro turno do chat
            # novo (ou de qualquer chat).
            save_state(user_id, state)
            return False

        turns = pending[-MEMORY_AGENT_WINDOW_TURNS:]
        state["pending"] = pending[:-len(turns)]
        state["running"] = True
        state["last_attempt_at"] = time.time()
        state["force_run"] = False
        save_state(user_id, state)

    try:
        observations, removals = observe(user_id, turns)
    except Exception as error:  # noqa: BLE001
        print("[NEXA-MEMÓRIA] observador falhou:", error)
        with account_lock(user_id):
            state = load_state(user_id)
            state["running"] = False
            state["failures"] = int(state.get("failures") or 0) + 1
            # Devolve os turnos para a próxima tentativa.
            state["pending"] = (
                turns + (state.get("pending") or [])
            )[-MEMORY_AGENT_PENDING_LIMIT:]
            save_state(user_id, state)
        return False

    changed = merge_observations(user_id, observations, removals)
    promoted = promote_observations(user_id, changed)
    updated = changed.get("changed") or []

    with account_lock(user_id):
        state = load_state(user_id)
        state["running"] = False
        state["failures"] = 0
        state["last_run_at"] = _now_iso()
        state["runs"] = int(state.get("runs") or 0) + 1
        save_state(user_id, state)

    if updated or changed.get("removed"):
        print(
            "[NEXA-MEMÓRIA] %d observação(ões) atualizada(s), %d removida(s); "
            "%d linha(s) tocada(s) no documento."
            % (
                len(updated),
                len(changed.get("removed") or []),
                promoted,
            )
        )

    return True


# ---------------------------------------------------------------------------
# Fase 3: reflexão periódica
# ---------------------------------------------------------------------------


def reflect(user_id):
    """Chama o agente de reflexão e devolve (observações, chaves removidas).

    A reflexão olha a loja inteira de observações e devolve a versão
    consolidada dela. É uma operação lógica própria: tem o seu orçamento
    de tentativas e nunca divide o orçamento do observador.
    """
    if not API_KEY:
        return [], []

    observations = load_observations(user_id)
    if not observations:
        return [], []

    stats = get_observation_stats(user_id)

    payload = {
        "model": MEMORY_AGENT_MODEL,
        "messages": [
            {"role": "system", "content": MEMORY_REFLECTION_PROMPT},
            {
                "role": "user",
                "content": _build_reflection_input(observations, stats),
            },
        ],
        "stream": False,
        "max_tokens": MEMORY_REFLECTION_MAX_TOKENS,
        "temperature": 0.2,
    }

    budget = RetryBudget()

    text = _ask(payload, budget)
    data = _parse_json(text)

    if data is None:
        # Uma tentativa de conserto: o modelo respondeu fora do formato.
        repaired = list(payload["messages"])
        repaired.append({"role": "assistant", "content": _clip(text, 2000)})
        repaired.append({
            "role": "user",
            "content": (
                "Responda apenas com o JSON no formato combinado, sem "
                "nenhum texto em volta."
            ),
        })
        payload["messages"] = repaired
        text = _ask(payload, budget)
        data = _parse_json(text)

    if data is None:
        print("[NEXA-MEMÓRIA] reflexão devolveu algo que não é JSON.")
        return [], []

    return validate_observations(data)


def _build_reflection_input(observations, stats):
    """Monta a entrada da reflexão: o que a NEXA já sabe e as contagens."""
    parts = [
        "Observações registradas até agora (consolide esta lista):",
        "",
    ]

    visible = [
        item for item in observations
        if isinstance(item, dict) and str(item.get("fato") or "").strip()
    ]
    visible = visible[:MEMORY_REFLECTION_CONTEXT_COUNT]

    for item in visible:
        marker = (
            " [já está no documento de memória]"
            if item.get("promovido")
            else ""
        )
        parts.append("- %s | %s (confiança %.2f, %d ocorrência(s), %s)%s" % (
            item.get("chave") or "",
            item.get("fato") or "",
            _as_float(item.get("confianca")),
            _as_int(item.get("ocorrencias"), 1),
            "explícito" if item.get("explicito") else "inferido",
            marker,
        ))
        evidence = _clip(item.get("evidencia"), EVIDENCE_LIMIT)
        if evidence:
            parts.append("  evidência: %s" % evidence)

    parts.append("")
    parts.append("Contagens de uso (use só para registrar padrões claros):")
    parts.append(
        "- %d turno(s) observado(s) em %d dia(s) de conversa"
        % (
            int(stats.get("turnos_observados") or 0),
            int(stats.get("dias_ativos") or 0),
        )
    )

    categories = stats.get("por_categoria") or {}
    if categories:
        parts.append(
            "- observações por categoria: %s"
            % ", ".join(
                "%s %d" % (name, total)
                for name, total in sorted(
                    categories.items(),
                    key=lambda pair: pair[1],
                    reverse=True,
                )
            )
        )

    recurring = stats.get("fatos_recorrentes") or []
    if recurring:
        parts.append(
            "- fatos recorrentes: %s"
            % "; ".join(
                '"%s" (%dx)' % (entry.get("fato") or "", entry.get("ocorrencias") or 1)
                for entry in recurring
                if entry.get("fato")
            )
        )

    parts.append("")
    parts.append("Responda só com o JSON no formato combinado.")
    return "\n".join(parts)


def _reflection_due(user_id, force=False):
    """Diz se a conta já pode passar por uma reflexão.

    A reflexão é diária (configurável), só acontece com material
    suficiente e não insiste depois de várias falhas seguidas.
    """
    if not user_id:
        return False

    state = load_state(user_id)

    if force or state.get("force_reflection"):
        return True

    if int(state.get("reflection_failures") or 0) >= MEMORY_REFLECTION_MAX_FAILURES:
        return False

    last = state.get("last_reflection_at")
    if last:
        try:
            moment = datetime.fromisoformat(last)
        except ValueError:
            moment = None

        if moment is not None:
            if moment.tzinfo is None:
                moment = moment.replace(tzinfo=timezone.utc)
            elapsed = (datetime.now(timezone.utc) - moment).total_seconds()
            if elapsed < MEMORY_REFLECTION_INTERVAL:
                return False

    observations = load_observations(user_id)
    if len(observations) < MEMORY_REFLECTION_MIN_OBSERVATIONS:
        return False

    return True


def request_reflection(user_id):
    """Pede uma reflexão imediata (botão "Refletir agora").

    A reflexão acontece em segundo plano: a resposta para a tela é
    imediata e o trabalho sai na fila dos workers.
    """
    if not user_id or not API_KEY:
        return False

    with account_lock(user_id):
        state = load_state(user_id)
        state["force_reflection"] = True
        save_state(user_id, state)

    _ensure_workers()
    _JOBS.put((JOB_REFLECT_NOW, user_id))
    return True


def _run_reflection(user_id, force=False):
    """Executa uma rodada de reflexão da conta."""
    if not user_id:
        return False

    with account_lock(user_id):
        state = load_state(user_id)
        if state.get("reflection_running"):
            return False

        if not force and not _reflection_due(user_id):
            return False

        state["reflection_running"] = True
        state["force_reflection"] = False
        save_state(user_id, state)

    try:
        observations, removals = reflect(user_id)
    except Exception as error:  # noqa: BLE001
        print("[NEXA-MEMÓRIA] reflexão falhou:", error)
        with account_lock(user_id):
            state = load_state(user_id)
            state["reflection_running"] = False
            state["reflection_failures"] = (
                int(state.get("reflection_failures") or 0) + 1
            )
            save_state(user_id, state)
        return False

    if not observations:
        # Reflexão sem resultado: nada é aplicado. A loja continua como
        # está, e a rodada conta como feita para não repetir já agora.
        with account_lock(user_id):
            state = load_state(user_id)
            state["reflection_running"] = False
            state["reflection_failures"] = 0
            state["last_reflection_at"] = _now_iso()
            state["reflections"] = int(state.get("reflections") or 0) + 1
            save_state(user_id, state)
        return False

    # A reflexão refina o que já foi observado: ela não soma evidência
    # nova, então a contagem de ocorrências não infla.
    changed = merge_observations(
        user_id,
        observations,
        removals,
        count_occurrences=False,
    )
    promoted = promote_observations(user_id, changed)

    with account_lock(user_id):
        state = load_state(user_id)
        state["reflection_running"] = False
        state["reflection_failures"] = 0
        state["last_reflection_at"] = _now_iso()
        state["reflections"] = int(state.get("reflections") or 0) + 1
        save_state(user_id, state)

    updated = changed.get("changed") or []
    if updated or changed.get("removed"):
        print(
            "[NEXA-MEMÓRIA] reflexão: %d observação(ões) consolidada(s), "
            "%d removida(s); %d linha(s) tocada(s) no documento."
            % (
                len(updated),
                len(changed.get("removed") or []),
                promoted,
            )
        )

    return True


def _scan_reflections():
    """Varre as contas: aplica o decaimento e agenda as reflexões devidas."""
    for account in _known_accounts():
        try:
            apply_decay(account)
        except Exception as error:  # noqa: BLE001
            print("[NEXA-MEMÓRIA] decaimento falhou em %s: %s"
                  % (account, error))

        try:
            if _reflection_due(account):
                _JOBS.put((JOB_REFLECT, account))
        except Exception as error:  # noqa: BLE001
            print("[NEXA-MEMÓRIA] agendamento da reflexão falhou em %s: %s"
                  % (account, error))


def _known_accounts():
    """Contas que já têm memória gravada (estado ou observações)."""
    accounts = set()

    try:
        paths = list(MEMORY_DIR.glob("*%s" % STATE_SUFFIX))
    except OSError:
        paths = []

    for path in paths:
        account = path.name[:-len(STATE_SUFFIX)]
        if account:
            accounts.add(account)

    try:
        paths = list(MEMORY_DIR.glob("*.observations.json"))
    except OSError:
        paths = []

    for path in paths:
        account = path.name[:-len(".observations.json")]
        if account:
            accounts.add(account)

    return sorted(accounts)


def observe(user_id, turns):
    """Chama o observador e devolve (observações, chaves removidas)."""
    if not API_KEY or not turns:
        return [], []

    existing = load_observations(user_id)
    payload = {
        "model": MEMORY_AGENT_MODEL,
        "messages": [
            {"role": "system", "content": MEMORY_AGENT_PROMPT},
            {"role": "user", "content": _build_input(turns, existing)},
        ],
        "stream": False,
        "max_tokens": MEMORY_AGENT_MAX_TOKENS,
        "temperature": 0.2,
    }

    # O observador é uma operação lógica própria: tem o seu orçamento de
    # tentativas, separado do orçamento do chat. A correção de formato
    # abaixo consome o mesmo orçamento (não soma 10 + 10).
    budget = RetryBudget()

    text = _ask(payload, budget)
    data = _parse_json(text)

    if data is None:
        # Uma tentativa de conserto: o modelo respondeu fora do formato.
        repaired = list(payload["messages"])
        repaired.append({"role": "assistant", "content": _clip(text, 2000)})
        repaired.append({
            "role": "user",
            "content": (
                "Responda apenas com o JSON no formato combinado, sem "
                "nenhum texto em volta."
            ),
        })
        payload["messages"] = repaired
        text = _ask(payload, budget)
        data = _parse_json(text)

    if data is None:
        print("[NEXA-MEMÓRIA] observador devolveu algo que não é JSON.")
        return [], []

    return validate_observations(data)


def _ask(payload, budget):
    """Chama o modelo do observador."""
    response = call_model(
        payload,
        timeout=(10, 60),
        budget=budget,
    )

    try:
        if response.status_code != 200:
            log_upstream_error(response)
            raise RuntimeError(
                "observador respondeu HTTP %d" % response.status_code
            )

        try:
            return extract_text(response.json()) or ""
        except ValueError:
            return ""
    finally:
        response.close()


def _build_input(turns, observations):
    parts = ["Turnos observados (mensagem do usuário e resposta da NEXA):"]

    for index, turn in enumerate(turns, start=1):
        parts.append("")
        parts.append("Turno %d:" % index)
        parts.append("Usuário: %s" % (turn.get("usuario") or "(vazio)"))
        parts.append("NEXA: %s" % (turn.get("assistente") or "(vazio)"))

    if observations:
        parts.append("")
        parts.append(
            "Observações já registradas (use a mesma chave para refinar um "
            "fato; não repita o que já está aqui):"
        )
        for item in observations:
            marker = (
                " [já está no documento de memória]"
                if item.get("promovido")
                else ""
            )
            parts.append("- %s | %s (confiança %.2f, %d ocorrência(s))%s" % (
                item.get("chave") or "",
                item.get("fato") or "",
                _as_float(item.get("confianca")),
                _as_int(item.get("ocorrencias"), 1),
                marker,
            ))

    parts.append("")
    parts.append("Responda só com o JSON no formato combinado.")
    return "\n".join(parts)


def _parse_json(text):
    """Extrai o objeto JSON da resposta do observador."""
    if not isinstance(text, str):
        return None

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        return None

    try:
        data = json.loads(cleaned[start:end + 1])
    except ValueError:
        return None

    return data if isinstance(data, dict) else None


def validate_observations(data):
    """Valida o que o modelo devolveu. O modelo não é fonte de verdade."""
    observations = []
    removals = []

    raw = data.get("observacoes")
    if isinstance(raw, list):
        for item in raw:
            observation = _clean_observation(item)
            if observation:
                observations.append(observation)

    raw_removals = data.get("remover")
    if isinstance(raw_removals, list):
        for key in raw_removals:
            normalized = normalize_key(key)
            if normalized:
                removals.append(normalized)

    return observations, removals


def _clean_observation(item):
    if not isinstance(item, dict):
        return None

    fact = _clip(item.get("fato"), FACT_LIMIT)
    if not fact:
        return None

    if looks_like_instruction(fact):
        print("[NEXA-MEMÓRIA] observação descartada (parece instrução).")
        return None

    if looks_like_secret(fact):
        print("[NEXA-MEMÓRIA] observação descartada (parece segredo).")
        return None

    evidence = _clip(item.get("evidencia"), EVIDENCE_LIMIT)
    if not evidence:
        # Sem evidência não entra: é opinião do modelo, não fato do usuário.
        print("[NEXA-MEMÓRIA] observação descartada (sem evidência).")
        return None

    category = str(item.get("categoria") or "").strip().lower()
    if category not in MEMORY_CATEGORIES:
        category = "contexto"

    key = normalize_key(item.get("chave")) or normalize_key(
        "%s:%s" % (category, fact)
    )
    if not key:
        return None

    return {
        "chave": key[:60],
        "fato": fact,
        "categoria": category,
        "confianca": round(_as_float(item.get("confianca")), 2),
        "explicito": bool(item.get("explicito")),
        "evidencia": evidence,
        "ocorrencias": 1,
        "primeira_vez": _now_iso(),
        "ultima_vez": _now_iso(),
    }


def normalize_key(text):
    """Transforma um texto em identificador estável de observação."""
    if not isinstance(text, str):
        return ""

    plain = unicodedata.normalize("NFKD", text.lower())
    plain = "".join(char for char in plain if not unicodedata.combining(char))
    plain = re.sub(r"[^a-z0-9:_-]+", "-", plain).strip("-:")

    # "categoria: chave" fica "categoria:chave": separadores seguidos
    # viram um só.
    plain = re.sub(r":-+", ":", plain)
    plain = re.sub(r"-{2,}", "-", plain)

    return plain[:60]


def looks_like_instruction(text):
    """Diz se o texto parece uma ordem para o modelo (não é memória)."""
    if not isinstance(text, str):
        return False

    return any(pattern.search(text) for pattern in _INSTRUCTION_PATTERNS)


def looks_like_secret(text):
    """Diz se o texto parece conter um segredo."""
    if not isinstance(text, str):
        return False

    return any(pattern.search(text) for pattern in _SECRET_PATTERNS)


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _as_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
