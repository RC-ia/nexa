"""Executor das ferramentas de chat (pesquisar, visitar, memória, lembrete...)."""
from concurrent.futures import ThreadPoolExecutor

from .websearch import fetch_pages
from .websearch import format_search_results
from .websearch import run_web_search
from .usertime import current_time_text
from .config import RESEARCH_TOOL_NAMES
from .llm import tool_call_id
from .memory import sanitize_memory
from .memory import save_memory
from .llm import parse_tool_arguments
from .llm import tool_call_name
from .config import API_KEY


# Ferramentas de leitura: independentes entre si e limitadas pela rede,
# rodam em paralelo no pool abaixo.
READ_TOOL_NAMES = frozenset(("pesquisar", "visitar_pagina", "data_hora"))


READ_POOL_MAX_WORKERS = 4


def run_memory_tool(user_id, calls):
    """
    Executa as chamadas de salvar_memoria vindas do modelo em conversa e
    grava o documento consolidado. Devolve o texto de resposta da
    ferramenta, que volta para o modelo no proximo turno.
    """
    if not user_id or not API_KEY:
        return ""

    saved = False

    for call in calls:
        if tool_call_name(call) != "salvar_memoria":
            continue

        arguments = parse_tool_arguments(call)
        document = arguments.get("documento")

        if not isinstance(document, str) or not document.strip():
            continue

        saved = save_memory(user_id, sanitize_memory(document)) or saved

    if not saved:
        return ""

    print("[NEXA] memória atualizada pela ferramenta do modelo.")
    return "Memória atualizada."


def run_tools(user_id, calls, reasoning=None, progress=None,
              allow_research=True):
    """
    Executa todas as ferramentas chamadas pelo modelo e devolve
    (resultados_por_id, memoria_atualizada, pesquisa_realizada).

    Cada resultado é o texto que volta para o modelo no papel "tool",
    indexado pelo id da chamada para o OpenAI poder casar tudo.

    "pesquisa_realizada" só é True quando a busca trouxe resultado de
    verdade. Falha e busca vazia continuam devolvendo texto para o modelo
    responder, mas não acendem o aviso de pesquisa no chat.

    Ferramentas de leitura (pesquisar, visitar_pagina, data_hora) rodam em
    paralelo num pool próprio: são independentes e o tempo delas é ditado
    pela rede. As de estado (memória, lembrete) e a pesquisa profunda
    seguem em sequência.
    """
    # Imports tardios: quebram o ciclo tools -> agents/reminders
    from .agents import run_deep_research
    from .reminders import create_reminder

    results = {}
    memory_updated = False
    searched = False

    def note(text):
        if progress:
            progress(text)

    if not calls:
        return results, memory_updated, searched

    read_calls = []
    sequential_calls = []

    for call in calls:
        name = tool_call_name(call)
        blocked = name in RESEARCH_TOOL_NAMES and not allow_research
        if name in READ_TOOL_NAMES and not blocked:
            read_calls.append(call)
        else:
            sequential_calls.append(call)

    def execute_read(call):
        name = tool_call_name(call)
        call_id = tool_call_id(call)
        arguments = parse_tool_arguments(call)

        if name == "pesquisar":
            term = arguments.get("termo")
            note("🔍 Pesquisando na web: «%s»" % term)
            found, error = run_web_search(term)
            print(
                "[NEXA-PESQUISA] %r -> %d resultado(s)%s"
                % (term, len(found), " (%s)" % error if error else "")
            )

            if found:
                note("✅ Pesquisa comum concluída: %d resultado(s)." % len(found))
                return call_id, format_search_results(term, found, user_id), True

            if error:
                return call_id, error, False

            return call_id, "A pesquisa não retornou nada útil.", False

        if name == "visitar_pagina":
            paginas = arguments.get("paginas", [])
            if not isinstance(paginas, list):
                paginas = []
            note(
                "📄 Lendo %d página(s) da pesquisa anterior."
                % len(paginas)
            )
            content = fetch_pages(user_id, paginas)
            note("✅ Leitura das páginas concluída.")
            return call_id, content, False

        return call_id, current_time_text(user_id), False

    if read_calls:
        if len(read_calls) == 1:
            call_id, content, found = execute_read(read_calls[0])
            results[call_id] = content
            searched = searched or found
        else:
            workers = min(READ_POOL_MAX_WORKERS, len(read_calls))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for call_id, content, found in pool.map(execute_read, read_calls):
                    results[call_id] = content
                    searched = searched or found

    for call in sequential_calls:
        name = tool_call_name(call)
        call_id = tool_call_id(call)
        arguments = parse_tool_arguments(call)

        if name in RESEARCH_TOOL_NAMES and not allow_research:
            results[call_id] = (
                "A pesquisa já foi executada antes desta resposta. "
                "Use o relatório disponível e não faça outra pesquisa."
            )
            if progress:
                progress(
                    "A ferramenta de pesquisa foi bloqueada porque o relatório "
                    "da pesquisa profunda já está disponível."
                )
            continue

        if name == "salvar_memoria":
            text = run_memory_tool(user_id, [call])

            if text:
                memory_updated = True
                results[call_id] = text
            continue

        if name == "criar_lembrete":
            text, created = create_reminder(user_id, arguments)
            print(
                "[NEXA-LEMBRETE] ferramenta: %s"
                % ("criado" if created else text)
            )
            results[call_id] = text
            continue

        if name == "pesquisa_profunda":
            topic = arguments.get("topico")
            print("[NEXA-PROFUNDA] ferramenta chamada: %r" % topic)
            note("🔎 O modelo chamou a pesquisa profunda: «%s»" % topic)
            results[call_id] = run_deep_research(
                user_id, topic, progress=progress, reasoning=reasoning
            )
            note("✅ Pesquisa profunda concluída e devolvida ao modelo.")
            searched = True
            continue

        # Toda chamada precisa de uma resposta de ferramenta, senão a
        # próxima rodada quebra com tool_call sem resultado correspondente.
        results[call_id] = "Ferramenta desconhecida para este executor."

    return results, memory_updated, searched
