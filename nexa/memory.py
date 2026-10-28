"""Memória de longo prazo: documento consolidado por conta + observações
do agente de memória.

O documento é um Markdown com seções, editável pelo usuário. O agente de
memória guarda observações estruturadas em JSON e promove ao documento
apenas o que já ganhou confiança.

A Fase 3 cuida do tempo: o decaimento reduz a confiança do que não é
reconfirmado, a camada estatística resume o perfil observado sem chamar o
modelo e a reflexão periódica revisa a loja inteira de observações.
"""
from .config import (
    MEMORY_ACTIVITY_DAYS_LIMIT,
    MEMORY_ARCHIVED_OBSERVATIONS_LIMIT,
    MEMORY_CATEGORY_SECTIONS,
    MEMORY_DECAY_ARCHIVE_AFTER_DAYS,
    MEMORY_DECAY_DROP_BELOW,
    MEMORY_DECAY_EXPLICIT_FACTOR,
    MEMORY_DECAY_FLOOR,
    MEMORY_DECAY_HALF_LIFE_DAYS,
    MEMORY_DIR,
    MEMORY_OBSERVATION_CONTEXT_CHARS,
    MEMORY_OBSERVATION_CONTEXT_COUNT,
    MEMORY_OBSERVATIONS_LIMIT,
    MEMORY_PROMOTION_CONFIDENCE,
    MEMORY_STATS_CONTEXT_CHARS,
    MEMORY_STATS_CONTEXT_COUNT,
)
from datetime import datetime
from datetime import timezone
import json
import threading


MEMORY_LOCK = threading.Lock()


MEMORY_FILE_LIMIT = 10000


MEMORY_HEADER = "# Contexto do usuário\n\n"


# Um lock por conta: serializa leitura + escrita. Sem ele, o chat e o
# agente de memória podem escrever ao mesmo tempo e a escrita mais nova
# apaga a mais antiga.
_ACCOUNT_LOCKS = {}
_ACCOUNT_LOCKS_GUARD = threading.Lock()


def account_lock(key):
    """Devolve o lock exclusivo de uma conta."""
    with _ACCOUNT_LOCKS_GUARD:
        lock = _ACCOUNT_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _ACCOUNT_LOCKS[key] = lock
        return lock


def init_db():
    try:
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        print("[NEXA] falha ao preparar a pasta de memória:", error)


def safe_account_name(user_id):
    return "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )


def memory_path(user_id):
    return MEMORY_DIR / ("%s.md" % safe_account_name(user_id))


def observations_path(user_id):
    return MEMORY_DIR / ("%s.observations.json" % safe_account_name(user_id))


def get_memories(user_id):
    """Devolve o documento de memória inteiro (lista com um único item)."""
    if not user_id:
        return []

    try:
        content = memory_path(user_id).read_text(encoding="utf-8").strip()
    except OSError:
        return []

    if not content:
        return []

    if content.startswith("#"):
        return [content]

    return [MEMORY_HEADER + content]


def read_memory_document(user_id):
    """Lê o documento cru da conta (sem acrescentar cabeçalho)."""
    try:
        return memory_path(user_id).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def write_memory_document(user_id, body):
    """Grava o documento. Quem chama precisa segurar o lock da conta."""
    path = memory_path(user_id)
    temporary = path.with_suffix(".md.tmp")
    try:
        temporary.write_text(body, encoding="utf-8")
        temporary.replace(path)
    except OSError as error:
        print("[NEXA] falha ao salvar memória:", error)
        return False

    return True


def save_memory(user_id, document):
    """Reescreve o arquivo inteiro da conta (edição manual do usuário)."""
    if not user_id or not document:
        return False

    body = document.strip()
    if not body:
        return False

    if not body.startswith("#"):
        body = MEMORY_HEADER + body

    if len(body) > MEMORY_FILE_LIMIT:
        body = body[:MEMORY_FILE_LIMIT]

    with account_lock(user_id):
        return write_memory_document(user_id, body)


def clear_memory(user_id):
    if not user_id:
        return False

    try:
        memory_path(user_id).unlink()
    except FileNotFoundError:
        pass
    except OSError as error:
        print("[NEXA] falha ao apagar memória:", error)
        return False

    # Apagar a memória é apagar o que a NEXA sabe sobre o usuário: as
    # observações do agente saem junto, senão elas voltariam no prompt.
    clear_observations(user_id, remove_from_document=False)
    return True


def sanitize_memory(text):
    """Normaliza o resumo mantendo a estrutura Markdown e o limite do arquivo."""
    if not isinstance(text, str):
        return ""

    lines = []
    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = " ".join(raw_line.split())
        if line:
            lines.append(line)

    document = "\n".join(lines).strip()

    if document and not document.startswith("#"):
        document = MEMORY_HEADER + document

    return document[:MEMORY_FILE_LIMIT]


# ---------------------------------------------------------------------------
# Observações do agente de memória
# ---------------------------------------------------------------------------


def load_observations(user_id):
    """Lê as observações registradas para a conta."""
    if not user_id:
        return []

    data = _read_observations_file(user_id)
    items = data.get("observacoes") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    return [item for item in items if isinstance(item, dict)]


def load_archived_observations(user_id):
    """Observações arquivadas pelo decaimento (histórico, fora do contexto)."""
    if not user_id:
        return []

    data = _read_observations_file(user_id)
    items = data.get("arquivadas") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []

    return [item for item in items if isinstance(item, dict)]


def _read_observations_file(user_id):
    try:
        data = json.loads(
            observations_path(user_id).read_text(encoding="utf-8")
        )
    except (OSError, ValueError):
        return {}

    return data if isinstance(data, dict) else {}


def write_observations(user_id, observations, archived=None, activity=None):
    """Grava as observações. Quem chama precisa segurar o lock da conta."""
    path = observations_path(user_id)
    temporary = path.with_suffix(".json.tmp")

    if archived is None:
        archived = load_archived_observations(user_id)

    if activity is None:
        activity = load_activity(user_id)

    payload = {
        "observacoes": observations,
        "arquivadas": archived,
        "atividade": activity,
    }

    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(path)
    except OSError as error:
        print("[NEXA] falha ao salvar observações:", error)
        return False

    return True


def save_observations(user_id, observations):
    with account_lock(user_id):
        return write_observations(user_id, observations)


def merge_observations(user_id, incoming, removals=(), count_occurrences=True):
    """Junta observações novas às já registradas.

    A chave é a identidade do fato: a mesma chave atualiza o texto e soma
    uma ocorrência; uma chave nova entra na lista.

    Com ``count_occurrences`` desligado a contagem não muda. É o que a
    reflexão periódica usa: refinar um fato não é uma evidência nova, é a
    mesma evidência olhada de novo.

    Devolve {"changed": [...], "removed": [...]}. Em "changed" vem o texto
    anterior do fato (para poder atualizar a linha no documento) e em
    "removed" vêm as observações que saíram (para apagar a linha do
    documento quando elas já tinham sido promovidas).
    """
    if not user_id:
        return {"changed": [], "removed": []}

    with account_lock(user_id):
        by_key = {}
        for item in load_observations(user_id):
            key = item.get("chave")
            if isinstance(key, str) and key:
                by_key[key] = item

        # Uma observação arquivada pelo decaimento pode voltar: quando a
        # pessoa volta a falar do mesmo fato, ela ressuscita com a
        # contagem e o estado de promoção que tinha.
        archived = load_archived_observations(user_id)
        archived_by_key = {}
        for item in archived:
            key = item.get("chave")
            if isinstance(key, str) and key:
                archived_by_key[key] = item

        removed = []
        for key in removals or ():
            if isinstance(key, str) and key:
                gone = by_key.pop(key, None)
                if gone:
                    removed.append(gone)

        changed = []
        for item in incoming or ():
            if not isinstance(item, dict):
                continue

            key = item.get("chave")
            if not isinstance(key, str) or not key:
                continue

            old = by_key.get(key)
            if old is None:
                old = archived_by_key.pop(key, None)

            if old:
                merged = dict(old)
                merged["fato"] = item.get("fato") or old.get("fato")
                merged["fato_anterior"] = old.get("fato")
                merged["categoria"] = (
                    item.get("categoria") or old.get("categoria")
                )

                if count_occurrences:
                    # Uma nova sighting só aumenta a confiança.
                    merged["confianca"] = max(
                        _as_float(old.get("confianca")),
                        _as_float(item.get("confianca")),
                    )
                else:
                    # Na reflexão quem decide é o modelo: ele pode
                    # rebaixar um fato que se mostrou errado.
                    reflected = _as_float(item.get("confianca"))
                    merged["confianca"] = (
                        reflected if reflected > 0
                        else _as_float(old.get("confianca"))
                    )

                if count_occurrences:
                    merged["ocorrencias"] = (
                        _as_int(old.get("ocorrencias"), 1) + 1
                    )

                merged["evidencia"] = (
                    item.get("evidencia") or old.get("evidencia")
                )
                merged["explicito"] = (
                    bool(old.get("explicito")) or bool(item.get("explicito"))
                )

                if count_occurrences:
                    merged["ultima_vez"] = (
                        item.get("ultima_vez") or old.get("ultima_vez")
                    )
                # Na reflexão o relógio do decaimento continua rodando:
                # refinar um fato não é reconfirmá-lo.
            else:
                merged = dict(item)
                merged.setdefault("ocorrencias", 1)
                merged["fato_anterior"] = ""

            by_key[key] = merged
            changed.append(merged)

        ordered = sorted(
            by_key.values(),
            key=lambda item: (
                _as_float(item.get("confianca")),
                _as_int(item.get("ocorrencias"), 1),
                str(item.get("ultima_vez") or ""),
            ),
            reverse=True,
        )
        ordered = ordered[:MEMORY_OBSERVATIONS_LIMIT]
        # O texto anterior só serve para o patch do documento: não fica
        # gravado no arquivo de observações.
        stored = [
            {key: value for key, value in item.items() if key != "fato_anterior"}
            for item in ordered
        ]
        # O que voltou do arquivo de histórico sai de lá: a chave tirada
        # de "archived_by_key" é a que ressuscitou.
        remaining_archived = [
            item for item in archived
            if item.get("chave") in archived_by_key
        ]
        write_observations(user_id, stored, remaining_archived)

    return {"changed": changed, "removed": removed}


def get_observations(user_id):
    """Observações da conta em ordem de confiança (para a API e a tela)."""
    return load_observations(user_id)


def delete_observation(user_id, key):
    """Apaga uma observação pelo identificador."""
    if not user_id or not key:
        return False

    with account_lock(user_id):
        current = load_observations(user_id)
        remaining = [
            item for item in current if item.get("chave") != key
        ]
        if len(remaining) == len(current):
            return False
        write_observations(user_id, remaining)

    return True


def clear_observations(user_id, remove_from_document=True):
    """Apaga todas as observações da conta.

    As linhas que já tinham vindo para o documento saem de lá também: sem
    observações, o documento não deve continuar repetindo o que o agente
    já promoveu.
    """
    if not user_id:
        return False

    with account_lock(user_id):
        current = load_observations(user_id)
        write_observations(user_id, [])

    if not remove_from_document:
        return True

    removals = [
        {"op": "remover", "secao": "", "texto": str(item.get("fato") or "")}
        for item in current
        if item.get("promovido") and str(item.get("fato") or "").strip()
    ]

    if removals:
        apply_memory_patch(user_id, removals)

    return True


def get_observation_context(
    user_id,
    limit=MEMORY_OBSERVATION_CONTEXT_COUNT,
    max_chars=MEMORY_OBSERVATION_CONTEXT_CHARS,
):
    """Bloco compacto de observações para entrar no system prompt.

    Observações já promovidas ao documento não entram: elas já estão no
    contexto, em texto definitivo. As que perderam confiança no decaimento
    também saem.
    """
    observations = load_observations(user_id)
    if not observations:
        return ""

    lines = []
    used = 0
    for item in observations:
        if item.get("promovido"):
            continue

        fact = str(item.get("fato") or "").strip()
        if not fact:
            continue

        confidence = effective_confidence(item)
        if confidence < MEMORY_DECAY_DROP_BELOW:
            continue

        line = "- [%s] %s (confiança %.2f)" % (
            item.get("categoria") or "contexto",
            fact,
            confidence,
        )
        if used + len(line) + 1 > max_chars:
            break

        lines.append(line)
        used += len(line) + 1
        if len(lines) >= limit:
            break

    return "\n".join(lines)


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


# ---------------------------------------------------------------------------
# Fase 3: decaimento, atividade e camada estatística
# ---------------------------------------------------------------------------


def _parse_moment(value):
    """Converte uma data ISO 8601 em datetime com fuso (ou None)."""
    if not isinstance(value, str) or not value:
        return None

    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None

    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)

    return moment


def observation_age_days(observation, now=None):
    """Dias desde a última vez que a observação apareceu."""
    moment = _parse_moment(observation.get("ultima_vez"))
    if moment is None:
        return 0.0

    current = now or datetime.now(timezone.utc)
    return max(0.0, (current - moment).total_seconds() / 86400.0)


def effective_confidence(observation, now=None):
    """Confiança da observação depois do decaimento.

    A confiança cai pela metade a cada meia-vida sem reconfirmação. Fato
    que o usuário declarou cai bem mais devagar (meia-vida maior). O piso
    impede que o fato vire zero do nada: ele pode voltar.
    """
    base = _as_float(observation.get("confianca"))
    days = observation_age_days(observation, now)

    half_life = MEMORY_DECAY_HALF_LIFE_DAYS
    if observation.get("explicito"):
        half_life = half_life / max(MEMORY_DECAY_EXPLICIT_FACTOR, 0.01)

    if half_life <= 0:
        factor = 1.0
    else:
        factor = 0.5 ** (days / half_life)

    return max(MEMORY_DECAY_FLOOR, min(1.0, base * factor))


def apply_decay(user_id, now=None):
    """Aplica o decaimento e tira da lista ativa o que já morreu.

    A confiança cai pela metade a cada meia-vida sem reconfirmação. O que
    cai abaixo de :data:`MEMORY_DECAY_DROP_BELOW` sai do contexto
    injetado, mas continua na lista ativa até passar
    :data:`MEMORY_DECAY_ARCHIVE_AFTER_DAYS` sem reconfirmação: aí vai para
    o arquivo de histórico (some do contexto, mas o rastro fica e o fato
    pode voltar se a pessoa voltar a falar dele).

    Devolve {"arquivadas": n, "rebaixadas": n, "ativas": n, "mortes": n}.
    """
    if not user_id:
        return {"arquivadas": 0, "rebaixadas": 0, "ativas": 0, "mortes": 0}

    current = now or datetime.now(timezone.utc)

    with account_lock(user_id):
        active = load_observations(user_id)
        archived = load_archived_observations(user_id)

        kept = []
        moved = []
        rebaixadas = 0
        mortes = 0
        mudou = False

        for item in active:
            days = observation_age_days(item, current)
            confidence = effective_confidence(item, current)
            old = _as_float(item.get("confianca_efetiva"))

            if old and confidence < old:
                rebaixadas += 1

            if not old or abs(confidence - old) > 0.01:
                mudou = True

            item["confianca_efetiva"] = round(confidence, 3)

            if confidence < MEMORY_DECAY_DROP_BELOW:
                mortes += 1

                if days >= MEMORY_DECAY_ARCHIVE_AFTER_DAYS:
                    dead = dict(item)
                    dead["arquivado_em"] = current.isoformat()
                    dead["dias_sem_reconfirmar"] = round(days, 1)
                    moved.append(dead)
                    continue

            kept.append(item)

        if moved:
            archived = (archived + moved)[-MEMORY_ARCHIVED_OBSERVATIONS_LIMIT:]
            write_observations(user_id, kept, archived)
        elif mudou:
            # Só o valor efetivo mudou: grava para a leitura ser estável.
            write_observations(user_id, kept, archived)

    return {
        "arquivadas": len(moved),
        "rebaixadas": rebaixadas,
        "ativas": len(kept),
        "mortes": mortes,
    }


# ---------------------------------------------------------------------------
# Atividade e camada estatística
# ---------------------------------------------------------------------------


def load_activity(user_id):
    """Contadores de atividade do agente (turnos vistos, dias ativos)."""
    data = _read_observations_file(user_id)
    activity = data.get("atividade") if isinstance(data, dict) else None

    if not isinstance(activity, dict):
        activity = {}

    days = activity.get("dias")
    activity["dias"] = days if isinstance(days, list) else []
    activity["turnos"] = int(activity.get("turnos") or 0)
    activity["primeira"] = str(activity.get("primeira") or "")
    activity["ultima"] = str(activity.get("ultima") or "")

    return activity


def update_activity(user_id, turns=0, moment=None):
    """Conta um turno observado e registra o dia da atividade."""
    if not user_id:
        return None

    stamp = moment or datetime.now(timezone.utc)
    day = stamp.date().isoformat()

    with account_lock(user_id):
        activity = load_activity(user_id)
        days = activity.get("dias") or []

        if day not in days:
            days.append(day)
            days = sorted(days)[-MEMORY_ACTIVITY_DAYS_LIMIT:]

        activity["dias"] = days
        activity["turnos"] = int(activity.get("turnos") or 0) + max(0, turns)
        activity["primeira"] = activity.get("primeira") or stamp.isoformat()
        activity["ultima"] = stamp.isoformat()

        write_observations(
            user_id,
            load_observations(user_id),
            load_archived_observations(user_id),
            activity,
        )

    return activity


def get_observation_stats(user_id):
    """Camada estatística: o perfil observado, sem chamar o modelo."""
    observations = load_observations(user_id)
    activity = load_activity(user_id)
    archived = load_archived_observations(user_id)

    categories = {}
    recurring = []
    promoted = 0
    confidence_total = 0.0

    for item in observations:
        category = str(item.get("categoria") or "contexto")
        categories[category] = categories.get(category, 0) + 1

        if item.get("promovido"):
            promoted += 1
        else:
            confidence_total += effective_confidence(item)

        recurring.append({
            "chave": item.get("chave") or "",
            "fato": item.get("fato") or "",
            "categoria": category,
            "ocorrencias": _as_int(item.get("ocorrencias"), 1),
            "confianca": round(effective_confidence(item), 3),
        })

    recurring.sort(
        key=lambda entry: (entry["ocorrencias"], entry["confianca"]),
        reverse=True,
    )

    pending = len(observations) - promoted
    average = confidence_total / pending if pending else 0.0

    return {
        "turnos_observados": int(activity.get("turnos") or 0),
        "dias_ativos": len(activity.get("dias") or []),
        "primeira_atividade": activity.get("primeira") or "",
        "ultima_atividade": activity.get("ultima") or "",
        "observacoes": len(observations),
        "arquivadas": len(archived),
        "promovidas": promoted,
        "pendentes": pending,
        "por_categoria": categories,
        "confianca_media": round(average, 3),
        "fatos_recorrentes": recurring[:MEMORY_STATS_CONTEXT_COUNT],
    }


def get_statistical_context(
    user_id,
    max_chars=MEMORY_STATS_CONTEXT_CHARS,
    limit=MEMORY_STATS_CONTEXT_COUNT,
):
    """Bloco compacto de estatísticas para entrar no system prompt.

    É a camada estatística pura: contagens, sem uma chamada ao modelo.
    """
    stats = get_observation_stats(user_id)
    if not stats["observacoes"] and not stats["turnos_observados"]:
        return ""

    lines = []
    used = 0

    def add(text):
        nonlocal used
        if used + len(text) + 1 > max_chars:
            return False
        lines.append(text)
        used += len(text) + 1
        return True

    if stats["turnos_observados"]:
        add(
            "- %d turno(s) observado(s) em %d dia(s) de conversa"
            % (stats["turnos_observados"], stats["dias_ativos"])
        )

    if stats["observacoes"]:
        categories = ", ".join(
            "%s %d" % (name, total)
            for name, total in sorted(
                stats["por_categoria"].items(),
                key=lambda pair: pair[1],
                reverse=True,
            )
        )
        add(
            "- %d observação(ões) ativas (%d no documento, %d pendentes): %s"
            % (
                stats["observacoes"],
                stats["promovidas"],
                stats["pendentes"],
                categories,
            )
        )

    facts = [
        '"%s" (%dx)' % (entry["fato"], entry["ocorrencias"])
        for entry in stats["fatos_recorrentes"][:limit]
        if entry["fato"]
    ]

    if facts:
        # A lista de fatos é montada do maior para o menor e para quando
        # o orçamento de caracteres acaba: o perfil continua legível.
        prefix = "- fatos recorrentes: "
        room = max_chars - used - 1 - len(prefix)
        chosen = []
        length = 0

        for fact in facts:
            extra = len(fact) + (2 if chosen else 0)
            if length + extra > room:
                break
            chosen.append(fact)
            length += extra

        if chosen:
            add(prefix + "; ".join(chosen))

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Documento de memória com semântica de patch
# ---------------------------------------------------------------------------


def _normalize(text):
    return " ".join(str(text or "").split()).strip().lower().rstrip(".!;,")


def _bullet_text(line):
    stripped = line.strip()
    if stripped.startswith("- "):
        return stripped[2:].strip()
    if stripped.startswith("* "):
        return stripped[2:].strip()
    return ""


def _section_index(lines, title):
    wanted = _normalize(title)
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("## ") and _normalize(stripped[3:]) == wanted:
            return index
    return -1


def _section_end(lines, start):
    for index in range(start + 1, len(lines)):
        if lines[index].strip().startswith("## "):
            return index
    return len(lines)


def canonical_section(section):
    """Traduz a seção pedida para o nome canônico do documento."""
    title = str(section or "").strip()
    if not title:
        return "Contexto"

    plain = _normalize(title)
    for key, value in MEMORY_CATEGORY_SECTIONS.items():
        if plain in (_normalize(key), _normalize(value)):
            return value

    return title[:60]


def apply_memory_patch(user_id, operations):
    """Aplica operações pontuais no documento de memória.

    Cada operação mexe em uma linha: 'adicionar' cria um item novo em uma
    seção, 'atualizar' troca o texto de um item existente e 'remover' apaga
    um item. O resto do documento fica intacto.
    """
    if not user_id or not operations:
        return 0

    with account_lock(user_id):
        body = read_memory_document(user_id) or MEMORY_HEADER.strip()
        lines = body.split("\n")
        changed = 0

        for operation in operations:
            if not isinstance(operation, dict):
                continue

            action = str(operation.get("op") or "").strip().lower()
            text = str(operation.get("texto") or "").strip()[:400]
            if not text:
                continue

            if action == "remover":
                target = _normalize(text)
                for index, line in enumerate(lines):
                    bullet = _bullet_text(line)
                    if bullet and _normalize(bullet) == target:
                        del lines[index]
                        changed += 1
                        break
                continue

            if action == "atualizar":
                previous = str(operation.get("anterior") or "").strip()
                if not previous:
                    # Sem o texto antigo não dá para trocar: vira adição.
                    action = "adicionar"
                else:
                    target = _normalize(previous)
                    for index, line in enumerate(lines):
                        bullet = _bullet_text(line)
                        if bullet and _normalize(bullet) == target:
                            lines[index] = "- " + text
                            changed += 1
                            break
                    else:
                        # O item antigo não está mais no documento (talvez o
                        # usuário tenha editado). Não duplica: descarta.
                        print(
                            "[NEXA] memória: item antigo não encontrado para "
                            "atualização (%s)." % previous[:60]
                        )
                        continue
            elif action != "adicionar":
                continue

            title = canonical_section(operation.get("secao"))
            bullet = "- " + text
            start = _section_index(lines, title)

            if start < 0:
                if lines and lines[-1].strip():
                    lines.append("")
                lines.append("## " + title)
                lines.append(bullet)
                changed += 1
                continue

            end = _section_end(lines, start)
            duplicate = False
            for index in range(start + 1, end):
                existing = _bullet_text(lines[index])
                if existing and _normalize(existing) == _normalize(text):
                    duplicate = True
                    break

            if duplicate:
                continue

            insert_at = end
            while insert_at > start + 1 and not lines[insert_at - 1].strip():
                insert_at -= 1
            lines.insert(insert_at, bullet)
            changed += 1

        document = "\n".join(lines).strip()
        if not document:
            return 0
        if not document.startswith("#"):
            document = MEMORY_HEADER + document
        if len(document) > MEMORY_FILE_LIMIT:
            document = document[:MEMORY_FILE_LIMIT]

        write_memory_document(user_id, document)

    return changed


def promotion_ready(observation):
    """Diz se a observação já merece entrar no documento de memória."""
    if not isinstance(observation, dict):
        return False

    if not str(observation.get("fato") or "").strip():
        return False

    if _as_float(observation.get("confianca")) < MEMORY_PROMOTION_CONFIDENCE:
        return False

    if bool(observation.get("explicito")):
        return True

    return _as_int(observation.get("ocorrencias"), 1) >= 2


def promote_observations(user_id, result, force=False):
    """Move observações confiantes para o documento consolidado.

    ``result`` é o retorno de :func:`merge_observations`. Cada observação
    pronta vira uma linha na seção da sua categoria. Se o fato mudou desde
    a promoção, a linha é atualizada em vez de duplicada; se a observação
    foi removida e já estava no documento, a linha sai de lá.

    Com ``force`` a confiança mínima é ignorada (promoção pedida pelo
    usuário).

    Devolve o número de linhas tocadas no documento.
    """
    if isinstance(result, dict):
        changed = result.get("changed") or []
        removed = result.get("removed") or []
    else:
        changed = list(result or ())
        removed = []

    operations = []
    promoted_keys = set()

    for item in changed:
        if not isinstance(item, dict):
            continue

        fact = str(item.get("fato") or "").strip()
        if not fact:
            continue

        category = str(item.get("categoria") or "contexto")
        section = MEMORY_CATEGORY_SECTIONS.get(category, "Contexto")

        if item.get("promovido"):
            previous = str(item.get("fato_anterior") or "").strip()
            if previous and _normalize(previous) != _normalize(fact):
                operations.append({
                    "op": "atualizar",
                    "secao": section,
                    "texto": fact,
                    "anterior": previous,
                })
                promoted_keys.add(item.get("chave"))
            continue

        if not force and not promotion_ready(item):
            continue

        operations.append({
            "op": "adicionar",
            "secao": section,
            "texto": fact,
        })
        promoted_keys.add(item.get("chave"))

    for item in removed:
        if not isinstance(item, dict) or not item.get("promovido"):
            continue
        fact = str(item.get("fato") or "").strip()
        if not fact:
            continue
        operations.append({
            "op": "remover",
            "secao": "",
            "texto": fact,
        })

    touched = apply_memory_patch(user_id, operations) if operations else 0

    if promoted_keys:
        with account_lock(user_id):
            current = load_observations(user_id)
            for item in current:
                if item.get("chave") in promoted_keys:
                    item["promovido"] = True
                    item["promovido_texto"] = str(item.get("fato") or "")
                    item.pop("fato_anterior", None)
            write_observations(user_id, current)

    return touched


def promote_observation(user_id, key, force=False):
    """Promove uma observação ao documento (botão "promover" da tela).

    Com ``force`` a promoção acontece mesmo sem a confiança mínima: a
    decisão é do usuário, não do agente.
    """
    if not user_id or not key:
        return False

    with account_lock(user_id):
        current = load_observations(user_id)
        found = next(
            (dict(item) for item in current if item.get("chave") == key),
            None,
        )

    if found is None:
        return False

    if not force and not promotion_ready(found):
        return False

    found["fato_anterior"] = ""
    found["promovido"] = False

    return promote_observations(
        user_id,
        {"changed": [found], "removed": []},
        force=force,
    ) > 0


def discard_observation(user_id, key):
    """Descarta uma observação e tira a linha correspondente do documento."""
    if not user_id or not key:
        return False

    with account_lock(user_id):
        current = load_observations(user_id)
        item = next(
            (entry for entry in current if entry.get("chave") == key),
            None,
        )

        if item is None:
            return False

        remaining = [
            entry for entry in current if entry.get("chave") != key
        ]
        write_observations(user_id, remaining)

    if item.get("promovido"):
        apply_memory_patch(user_id, [{
            "op": "remover",
            "secao": "",
            "texto": str(item.get("fato") or ""),
        }])

    return True
