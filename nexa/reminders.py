"""Lembretes: criação, agendamento, agentes de execução e disparo."""
from concurrent.futures import ThreadPoolExecutor

from .push import send_push_notification
from .tools import run_tools
from .llm import parse_tool_arguments
from .llm import tool_call_name
from .llm import tool_call_id
from .llm import extract_text
from .llm import extract_tool_calls
from .config import DEEP_RESEARCH_TIMEOUT
from .config import MAX_OUTPUT_TOKENS
from .config import TIME_TOOL
from .config import VISIT_TOOL
from .config import SEARCH_TOOL
from .config import STREAM_TIMEOUT
from .config import CONNECT_TIMEOUT
from .llm import model_for_reasoning
from .llm import call_model
from .config import API_BASE
import requests
from .config import API_KEY
import uuid
import time
from .usertime import user_now
import json
from .config import WEEK_DAYS
from .usertime import user_epoch
import calendar
from .usertime import user_moment
from datetime import datetime, timedelta
import re
from .config import MEMORY_DIR
import os
import threading


REMINDERS_LOCK = threading.Lock()


REMINDERS_TICK_SECONDS = 30


REMINDERS_LIMIT = 50


PENDING_LIMIT = 50


PENDING_RETENTION_SECONDS = 7 * 86400


REMINDER_FILE_SUFFIX = ".reminders.json"


REMINDER_AGENT_PROMPT = (
    "Você é o agente de lembretes da NEXA. Recebe a tarefa de um lembrete e "
    "o horário do disparo e devolve a mensagem final que será mostrada ao "
    "usuário, em português brasileiro. Seja curto, direto e natural; sem "
    "saudações, sem perguntas, sem citar regras ou ferramentas. Não invente "
    "dados que a tarefa não traz. Responda apenas com a mensagem, pronta "
    "para exibição."
)


REMINDER_ACTION_PROMPT = (
    "Você é o agente de ações dos lembretes da NEXA. Recebe uma instrução "
    "programada pelo usuário e a executa agora, usando as ferramentas de "
    "busca e de leitura de páginas quando ajudarem. Entregue o resultado "
    "final em português brasileiro, pronto para ser enviado como a mensagem "
    "do lembrete: objetivo, com os fatos que encontrou e as fontes; sem "
    "saudações, sem perguntas, sem citar regras ou ferramentas. Se não "
    "conseguiu cumprir a instrução, diga o que faltou de forma direta."
)


REMINDER_ACTION_ROUNDS = int(os.environ.get("REMINDER_ACTION_ROUNDS", "5"))


def reminder_path(user_id):
    safe_id = "".join(
        char if char.isalnum() or char in "-_" else "_" for char in str(user_id)
    )
    return MEMORY_DIR / ("%s%s" % (safe_id, REMINDER_FILE_SUFFIX))


def parse_hour(value):
    """Aceita 'HH:MM' (24h) e devolve (hora, minuto) ou None."""
    if not isinstance(value, str):
        return None

    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value.strip())
    if not match:
        return None

    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None

    return hour, minute


def parse_when(value):
    """Aceita data e hora local em ISO ('2026-10-02T09:00') ou None."""
    if not isinstance(value, str) or not value.strip():
        return None

    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None

    if parsed.tzinfo is not None:
        return None

    return parsed


def format_epoch(user_id, epoch):
    try:
        return user_moment(user_id, epoch).strftime("%d/%m/%Y %H:%M")
    except (TypeError, ValueError, OSError):
        return "—"


def next_daily(now, hour, minute):
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


def next_weekly(now, day, hour, minute):
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    # A ferramenta usa 0=domingo; o datetime usa 0=segunda.
    target += timedelta(days=((day + 6) % 7 - target.weekday()) % 7)
    if target <= now:
        target += timedelta(days=7)
    return target


def next_monthly(now, day, hour, minute):
    year, month = now.year, now.month
    # Mês sem o dia pedido usa o último dia disponível (31 vira 28/29/30).
    target = datetime(
        year, month, min(day, calendar.monthrange(year, month)[1]), hour, minute
    )
    if target <= now:
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
        target = datetime(
            year, month, min(day, calendar.monthrange(year, month)[1]), hour, minute
        )
    return target


def compute_next_fire(reminder, now_epoch, user_id):
    """Próximo disparo de um recorrente; None quando o lembrete está corrompido."""
    frequencia = reminder.get("frequencia")

    if frequencia == "hora_em_hora":
        next_at = reminder.get("next_at")
        if not isinstance(next_at, (int, float)):
            next_at = now_epoch
        while next_at <= now_epoch:
            next_at += 3600
        return int(next_at)

    parsed = parse_hour(reminder.get("hora"))
    if parsed is None:
        return None
    hour, minute = parsed
    now = user_moment(user_id, now_epoch)

    if frequencia == "diario":
        return user_epoch(user_id, next_daily(now, hour, minute))

    if frequencia == "semanal":
        day = reminder.get("dia_semana")
        if not isinstance(day, int) or not 0 <= day <= 6:
            return None
        return user_epoch(user_id, next_weekly(now, day, hour, minute))

    if frequencia == "mensal":
        day = reminder.get("dia_mes")
        if not isinstance(day, int) or not 1 <= day <= 31:
            return None
        return user_epoch(user_id, next_monthly(now, day, hour, minute))

    return None


def describe_reminder(reminder):
    """Descrição curta do padrão do lembrete, para a página e para o modelo."""
    tipo = reminder.get("tipo")
    if tipo == "unico":
        return "Uma vez"

    frequencia = reminder.get("frequencia")
    hora = reminder.get("hora") or ""

    if frequencia == "hora_em_hora":
        return "De hora em hora"
    if frequencia == "diario":
        return "Todo dia às %s" % hora
    if frequencia == "semanal":
        day = reminder.get("dia_semana")
        name = WEEK_DAYS[day] if isinstance(day, int) and 0 <= day <= 6 else "?"
        return "Toda %s às %s" % (name, hora)
    if frequencia == "mensal":
        return "Todo dia %s às %s" % (reminder.get("dia_mes"), hora)
    return "—"


def load_reminder_data(path):
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"reminders": [], "pending": [], "seq": 0}

    if not isinstance(data, dict):
        return {"reminders": [], "pending": [], "seq": 0}

    reminders = data.get("reminders")
    pending = data.get("pending")
    seq = data.get("seq")
    return {
        "reminders": reminders if isinstance(reminders, list) else [],
        "pending": pending if isinstance(pending, list) else [],
        "seq": seq if isinstance(seq, int) and not isinstance(seq, bool) else 0,
    }


def save_reminder_data(path, data):
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )
    temporary.replace(path)


def create_reminder(user_id, arguments):
    """
    Valida a chamada da ferramenta e grava o lembrete.
    Devolve (mensagem_para_o_modelo, criado).
    """
    if not user_id:
        return "Não deu para criar o lembrete: conta não identificada.", False

    if not isinstance(arguments, dict):
        arguments = {}

    tipo = str(arguments.get("tipo") or "").strip().lower()
    tarefa = arguments.get("tarefa")
    if not isinstance(tarefa, str):
        tarefa = ""
    tarefa = " ".join(tarefa.split())[:1000]

    instrucao = arguments.get("instrucao")
    if not isinstance(instrucao, str):
        instrucao = ""
    instrucao = " ".join(instrucao.split())[:500]

    if tipo not in ("recorrente", "unico"):
        return "Não deu para criar o lembrete: 'tipo' deve ser recorrente ou unico.", False
    if not tarefa:
        return "Não deu para criar o lembrete: 'tarefa' vazia. Descreva o que o agente faz no disparo.", False

    now = user_now(user_id)
    now_epoch = int(time.time())
    path = reminder_path(user_id)

    with REMINDERS_LOCK:
        data = load_reminder_data(path)

        if len(data["reminders"]) >= REMINDERS_LIMIT:
            return (
                "Não deu para criar o lembrete: limite de %d lembretes ativos por conta."
                % REMINDERS_LIMIT,
                False,
            )

        reminder = {
            "id": uuid.uuid4().hex[:10],
            "tarefa": tarefa,
            "tipo": tipo,
            "created_at": now_epoch,
        }

        if instrucao:
            reminder["instrucao"] = instrucao

        if tipo == "unico":
            quando = parse_when(arguments.get("quando"))
            if quando is None:
                return (
                    "Não deu para criar o lembrete: 'quando' inválido. Use "
                    "YYYY-MM-DDTHH:MM, ex.: 2026-10-02T09:00.",
                    False,
                )
            if quando <= now:
                return (
                    "Não deu para criar o lembrete: %s já passou (agora são %s). "
                    "Use um horário futuro."
                    % (quando.strftime("%d/%m/%Y %H:%M"), now.strftime("%d/%m/%Y %H:%M")),
                    False,
                )
            reminder["next_at"] = user_epoch(user_id, quando)
        else:
            frequencia = str(arguments.get("frequencia") or "").strip().lower()
            if frequencia not in ("hora_em_hora", "diario", "semanal", "mensal"):
                return (
                    "Não deu para criar o lembrete: 'frequencia' deve ser "
                    "hora_em_hora, diario, semanal ou mensal.",
                    False,
                )
            reminder["frequencia"] = frequencia

            if frequencia == "hora_em_hora":
                reminder["next_at"] = now_epoch + 3600
            else:
                parsed = parse_hour(arguments.get("hora"))
                if parsed is None:
                    return (
                        "Não deu para criar o lembrete: informe 'hora' no "
                        "formato HH:MM (24h), ex.: 08:30.",
                        False,
                    )
                hour, minute = parsed
                reminder["hora"] = "%02d:%02d" % (hour, minute)

                if frequencia == "diario":
                    target = next_daily(now, hour, minute)
                elif frequencia == "semanal":
                    dia_semana = arguments.get("dia_semana")
                    if (
                        not isinstance(dia_semana, int)
                        or isinstance(dia_semana, bool)
                        or not 0 <= dia_semana <= 6
                    ):
                        return (
                            "Não deu para criar o lembrete: informe "
                            "'dia_semana' de 0 (domingo) a 6 (sábado).",
                            False,
                        )
                    reminder["dia_semana"] = dia_semana
                    target = next_weekly(now, dia_semana, hour, minute)
                else:
                    dia_mes = arguments.get("dia_mes")
                    if (
                        not isinstance(dia_mes, int)
                        or isinstance(dia_mes, bool)
                        or not 1 <= dia_mes <= 31
                    ):
                        return (
                            "Não deu para criar o lembrete: informe 'dia_mes' "
                            "de 1 a 31.",
                            False,
                        )
                    reminder["dia_mes"] = dia_mes
                    target = next_monthly(now, dia_mes, hour, minute)

                reminder["next_at"] = user_epoch(user_id, target)

        data["reminders"].append(reminder)
        try:
            save_reminder_data(path, data)
        except OSError as error:
            print("[NEXA-LEMBRETE] falha ao salvar lembrete:", error)
            return "Não foi possível salvar o lembrete. Tente novamente.", False

    print(
        "[NEXA-LEMBRETE] criado para %s: %s (%s)"
        % (
            format_epoch(user_id, reminder["next_at"]),
            describe_reminder(reminder),
            tarefa,
        )
    )
    return (
        "Lembrete criado: %s. Próximo disparo: %s. Tarefa do agente: %s. "
        "Confirme isso ao usuário em uma frase curta."
        % (
            describe_reminder(reminder),
            format_epoch(user_id, reminder["next_at"]),
            tarefa,
        ),
        True,
    )


def user_reminders(user_id):
    """Lista dos lembretes ativos, já ordenada pelo próximo disparo."""
    with REMINDERS_LOCK:
        data = load_reminder_data(reminder_path(user_id))

    items = sorted(
        data["reminders"], key=lambda item: item.get("next_at") or 0
    )

    return [
        {
            "id": item.get("id") or "",
            "tarefa": item.get("tarefa") or "",
            "tipo": item.get("tipo") or "",
            "descricao": describe_reminder(item),
            "next_at": int(item.get("next_at") or 0),
        }
        for item in items
        if item.get("id")
    ]


def delete_reminder(user_id, reminder_id):
    path = reminder_path(user_id)

    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        remaining = [
            item for item in data["reminders"] if item.get("id") != reminder_id
        ]
        if len(remaining) == len(data["reminders"]):
            return False
        data["reminders"] = remaining
        save_reminder_data(path, data)

    return True


def take_pending_reminders(user_id):
    """Cliente antigo (poll sem cursor): devolve e esvazia a fila."""
    path = reminder_path(user_id)

    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        pending = data["pending"]
        if pending:
            data["pending"] = []
            save_reminder_data(path, data)

    return pending


def pending_reminders_since(user_id, after_seq):
    """
    Itens com seq > cursor, sem esvaziar a fila: cada aparelho recebe tudo
    uma vez e avança o próprio cursor. Itens antigos (sem seq) ganham
    número aqui; itens fora da retenção são podados.
    """
    path = reminder_path(user_id)

    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        changed = False

        for item in data["pending"]:
            if not isinstance(item.get("seq"), int):
                data["seq"] += 1
                item["seq"] = data["seq"]
                changed = True

        cutoff = int(time.time()) - PENDING_RETENTION_SECONDS
        kept = [
            item for item in data["pending"]
            if int(item.get("at") or 0) >= cutoff
        ]
        if len(kept) != len(data["pending"]):
            data["pending"] = kept
            changed = True

        items = [item for item in data["pending"] if item["seq"] > after_seq]

        if changed:
            save_reminder_data(path, data)

    return items


def run_reminder_agent(tarefa, when_text):
    """Agente do lembrete: system prompt próprio e resposta curta ('' em falha)."""
    if not API_KEY or not tarefa:
        return ""

    try:
        response = call_model(
            {
                "model": model_for_reasoning("none"),
                "messages": [
                    {"role": "system", "content": REMINDER_AGENT_PROMPT},
                    {
                        "role": "user",
                        "content": "Tarefa: %s\nHorário do disparo: %s" % (tarefa, when_text),
                    },
                ],
                "stream": False,
                "max_tokens": 200,
            },
            timeout=(CONNECT_TIMEOUT, STREAM_TIMEOUT),
        )

        if response.status_code != 200:
            print(
                "[NEXA-LEMBRETE] agente HTTP %d: %s"
                % (response.status_code, response.text[:300])
            )
            return ""

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        return (content or "").strip()
    except (requests.RequestException, ValueError, KeyError, IndexError) as error:
        print("[NEXA-LEMBRETE] agente falhou:", error)
        return ""


def run_reminder_action(user_id, instrucao, when_text):
    """Agente de ação do lembrete: executa a instrução (busca na web,
    leitura de páginas, data e hora) e devolve o texto final ('' em falha).

    Roda dentro do ciclo do agendador; uma ação demorada atrasa o próximo
    tick dos lembretes.
    """
    if not API_KEY or not instrucao:
        return ""

    messages = [
        {"role": "system", "content": REMINDER_ACTION_PROMPT},
        {
            "role": "user",
            "content": "Instrução: %s\nHorário do disparo: %s"
            % (instrucao, when_text),
        },
    ]

    last_text = ""

    for _ in range(REMINDER_ACTION_ROUNDS):
        body = {
            "model": model_for_reasoning("ultra"),
            "messages": messages,
            "tools": [SEARCH_TOOL, VISIT_TOOL, TIME_TOOL],
            "tool_choice": "auto",
            "stream": False,
            "max_tokens": MAX_OUTPUT_TOKENS,
        }
        try:
            response = call_model(
                body,
                timeout=(CONNECT_TIMEOUT, DEEP_RESEARCH_TIMEOUT),
            )
        except requests.RequestException as error:
            print("[NEXA-LEMBRETE] ação falhou:", error)
            return last_text

        if response.status_code != 200:
            print(
                "[NEXA-LEMBRETE] ação HTTP %d: %s"
                % (response.status_code, response.text[:300])
            )
            return last_text

        try:
            payload = response.json()
        except ValueError:
            return last_text

        calls = extract_tool_calls(payload)
        text = (extract_text(payload) or "").strip()

        if not calls:
            return text or last_text

        last_text = text or last_text

        messages.append({
            "role": "assistant",
            "content": text or None,
            "tool_calls": [
                {
                    "id": tool_call_id(call),
                    "type": "function",
                    "function": {
                        "name": tool_call_name(call),
                        "arguments": json.dumps(
                            parse_tool_arguments(call), ensure_ascii=False
                        ),
                    },
                }
                for call in calls
            ],
        })

        results, _, _ = run_tools(user_id, calls, "none")

        for call in calls:
            call_id = tool_call_id(call)
            messages.append({
                "role": "tool",
                "tool_call_id": call_id,
                "content": results.get(call_id) or "Sem resultado.",
            })

    return last_text


def process_reminder_file(path):
    """Dispara os lembretes vencidos de um arquivo de conta (síncrono)."""
    now_epoch = time.time()
    user_id = path.name[: -len(REMINDER_FILE_SUFFIX)]

    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        due_ids = [
            item.get("id")
            for item in data["reminders"]
            if isinstance(item.get("next_at"), (int, float))
            and item["next_at"] <= now_epoch
        ]

    for reminder_id in due_ids:
        if reminder_id:
            _fire_reminder(path, user_id, reminder_id)


def _fire_reminder(path, user_id, reminder_id):
    """Dispara um lembrete vencido: roda o agente, enfileira a mensagem e
    reagenda (ou remove) o lembrete. Pode rodar fora da thread do scheduler
    (pool de disparos) sem segurar o tick dos lembretes."""
    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        reminder = next(
            (item for item in data["reminders"] if item.get("id") == reminder_id),
            None,
        )
    if reminder is None:
        return

    tarefa = reminder.get("tarefa") or ""
    instrucao = reminder.get("instrucao") or ""
    when_text = format_epoch(user_id, reminder.get("next_at") or time.time())

    if instrucao:
        message = (
            run_reminder_action(user_id, instrucao, when_text)
            or tarefa
            or "Lembrete da NEXA."
        )
    else:
        message = run_reminder_agent(tarefa, when_text) or tarefa or "Lembrete da NEXA."

    with REMINDERS_LOCK:
        data = load_reminder_data(path)
        current = next(
            (item for item in data["reminders"] if item.get("id") == reminder_id),
            None,
        )
        if current is None:
            return

        data["seq"] += 1
        data["pending"].append(
            {"at": int(time.time()), "message": message, "seq": data["seq"]}
        )
        data["pending"] = data["pending"][-PENDING_LIMIT:]

        if current.get("tipo") == "unico":
            data["reminders"] = [
                item for item in data["reminders"]
                if item.get("id") != reminder_id
            ]
        else:
            next_at = compute_next_fire(current, int(time.time()), user_id)
            if next_at is None:
                data["reminders"] = [
                    item for item in data["reminders"]
                    if item.get("id") != reminder_id
                ]
            else:
                current["next_at"] = next_at

        save_reminder_data(path, data)

    print("[NEXA-LEMBRETE] disparado: %s" % message[:120])
    send_push_notification(user_id, "Lembrete da NEXA", message)


# Pool de disparos: uma ação de lembrete pode levar minutos (busca na web
# + agente). Rodando fora do tick, o ciclo de 30s continua pontual mesmo
# com disparos demorados em andamento.
_ACTION_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="nexa-lembretes")

_INFLIGHT_LOCK = threading.Lock()

_INFLIGHT = set()


def _fire_reminder_async(path, user_id, reminder_id):
    """Enfileira o disparo de um lembrete no pool, sem duplicar: a chave
    (conta, lembrete) marca o que já está em andamento, então o próximo
    tick não reagenda o mesmo lembrete enquanto o agente ainda trabalha."""
    key = (user_id, reminder_id)

    with _INFLIGHT_LOCK:
        if key in _INFLIGHT:
            return
        _INFLIGHT.add(key)

    def job():
        try:
            _fire_reminder(path, user_id, reminder_id)
        except Exception as error:  # noqa: BLE001
            print(
                "[NEXA-LEMBRETE] erro ao disparar %s: %s" % (reminder_id, error)
            )
        finally:
            with _INFLIGHT_LOCK:
                _INFLIGHT.discard(key)

    _ACTION_EXECUTOR.submit(job)


def tick_reminders():
    """Uma passada do scheduler: enfileira os disparos vencidos no pool."""
    now_epoch = time.time()

    for path in MEMORY_DIR.glob("*" + REMINDER_FILE_SUFFIX):
        try:
            user_id = path.name[: -len(REMINDER_FILE_SUFFIX)]

            with REMINDERS_LOCK:
                data = load_reminder_data(path)
                due_ids = [
                    item.get("id")
                    for item in data["reminders"]
                    if isinstance(item.get("next_at"), (int, float))
                    and item["next_at"] <= now_epoch
                ]

            for reminder_id in due_ids:
                if reminder_id:
                    _fire_reminder_async(path, user_id, reminder_id)

        except Exception as error:
            print("[NEXA-LEMBRETE] erro ao processar %s: %s" % (path.name, error))


def reminder_scheduler_loop():
    print(
        "[NEXA] agente de lembretes ativo (verificação a cada %d s)."
        % REMINDERS_TICK_SECONDS
    )

    while True:
        try:
            tick_reminders()
        except Exception as error:
            # A thread é daemon e não pode morrer: um erro fica só no log.
            print("[NEXA-LEMBRETE] erro no ciclo:", error)
        time.sleep(REMINDERS_TICK_SECONDS)
