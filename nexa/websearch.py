"""Busca web (DuckDuckGo/Bing), leitura de páginas e cache de resultados."""
import requests
import time
import base64
import urllib.parse
import html
import re
import threading
import os


SEARCH_URL = "https://html.duckduckgo.com/html/"


SEARCH_ENDPOINTS = (
    ("https://html.duckduckgo.com/html/", "post"),
    ("https://lite.duckduckgo.com/lite/", "post"),
    ("https://www.bing.com/search", "get"),
)


SEARCH_TIMEOUT = (5, 15)


SEARCH_RESULT_LIMIT = 5


SEARCH_MAX_RESULTS = 8


SEARCH_SNIPPET_LIMIT = 400


SEARCH_PATIENCE = int(os.environ.get("SEARCH_PATIENCE", "120"))


SEARCH_RETRY_DELAY = float(os.environ.get("SEARCH_RETRY_DELAY", "4"))


SEARCH_MAX_ATTEMPTS = int(os.environ.get("SEARCH_MAX_ATTEMPTS", "12"))


SEARCH_UNAVAILABLE_MESSAGE = (
    "A busca não respondeu dentro do tempo limite. Avise o usuário que a "
    "pesquisa na web não respondeu a tempo e pergunte se ele quer que você "
    "tente de novo (não refaça a busca sozinha nesta resposta). Enquanto "
    "espera, responda com o que você já sabe e deixe claro o que não deu "
    "para verificar. Não invente fatos, números, datas ou fontes."
)


def search_reason_label(reason):
    """Traduz o motivo de uma falha de busca para a cadeia de pensamento."""
    if reason == "limitado":
        return "o buscador está limitando as requisições"
    if reason.startswith("rede"):
        detail = reason.split(":", 1)[-1].strip()
        return "falha de rede (%s)" % detail if detail else "falha de rede"
    if reason.startswith("http_"):
        return "erro do buscador (HTTP %s)" % reason[5:]
    return "erro do buscador (%s)" % reason


SEARCH_HEARTBEAT = int(os.environ.get("SEARCH_HEARTBEAT", "15"))


SEARCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"
    ),
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml",
}


_last_search_cache = {}


_search_cache_lock = threading.Lock()


RESULT_LINK_PATTERN = re.compile(
    r'<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S
)


RESULT_SNIPPET_PATTERN = re.compile(
    r'<a[^>]+class="result__snippet"[^>]*>(.*?)</a>', re.S
)


LITE_LINK_PATTERN = re.compile(
    "<a[^>]+href=\"([^\"]+)\"[^>]*class=['\"]result-link['\"][^>]*>(.*?)</a>",
    re.S,
)


LITE_SNIPPET_PATTERN = re.compile(
    "<td[^>]+class=['\"]result-snippet['\"][^>]*>(.*?)</td>", re.S
)


BING_LINK_PATTERN = re.compile(
    "<h2[^>]*><a[^>]+href=\"([^\"]+)\"[^>]*>(.*?)</a></h2>", re.S
)


BING_SNIPPET_PATTERN = re.compile(
    "<p class=\"b_lineclamp[^\"]*\"[^>]*>(.*?)</p>", re.S
)


TAG_PATTERN = re.compile(r"<[^>]+>")


def clean_search_text(fragment):
    """Tira o HTML e as entidades que o buscador devolve."""
    if not fragment:
        return ""

    text = TAG_PATTERN.sub("", fragment)
    text = html.unescape(text)

    return " ".join(text.split()).strip()


def unwrap_duckduckgo_url(url):
    """
    O DuckDuckGo embrulha os links em /l/?uddg=<url>. Sem desembrulhar, o
    modelo receberia uma URL de redirecionamento inútil.
    """
    if not url:
        return ""

    if url.startswith("//"):
        url = "https:" + url

    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return url

    if not parsed.path.startswith("/l/"):
        return url

    query = urllib.parse.parse_qs(parsed.query)
    target = query.get("uddg")

    return target[0] if target else url


def unwrap_bing_url(url):
    """
    O Bing embrulha os links em /ck/a?u=a1<base64 url-safe>; sem abrir, o
    modelo receberia um redirecionamento do buscador.
    """
    if not url or "/ck/a" not in url:
        return url

    # O atributo href chega com &amp; no lugar de &.
    url = html.unescape(url)

    query = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    target = (query.get("u") or [""])[0]

    if not target.startswith("a1"):
        return url

    data = target[2:]
    data += "=" * (-len(data) % 4)

    try:
        return base64.urlsafe_b64decode(data).decode("utf-8", "replace")
    except (ValueError, TypeError):
        return url


def search_once(term, limit, deadline):
    """
    Uma passada pelas tentativas: cada endpoint do buscador é chamado uma
    vez, alternando entre eles. Devolve (resultados, motivo_da_falha).
    """
    throttled = False
    last_error = "A pesquisa não retornou nada útil."

    for endpoint, method in SEARCH_ENDPOINTS:
        if deadline is not None and time.monotonic() >= deadline:
            return [], "tempo_esgotado"

        try:
            if method == "get":
                response = requests.get(
                    endpoint,
                    headers=SEARCH_HEADERS,
                    params={"q": term},
                    timeout=SEARCH_TIMEOUT,
                )
            else:
                response = requests.post(
                    endpoint,
                    headers=SEARCH_HEADERS,
                    data={"q": term},
                    timeout=SEARCH_TIMEOUT,
                )
        except requests.RequestException as error:
            print("[NEXA-PESQUISA] rede falhou em %s: %s" % (endpoint, error))
            last_error = "rede: %s" % error.__class__.__name__
            continue

        if response.status_code == 202:
            # Limite de requisicoes do DuckDuckGo para este IP.
            throttled = True
            continue

        if response.status_code != 200:
            print(
                "[NEXA-PESQUISA] %s respondeu HTTP %d"
                % (endpoint, response.status_code)
            )
            last_error = "http_%d" % response.status_code
            continue

        results = parse_search_results(response.text, limit)

        if results:
            return results, ""

        last_error = "vazio"

    if throttled:
        return [], "limitado"

    return [], last_error


def run_web_search(term, limit=SEARCH_RESULT_LIMIT, patience=None, progress=None):
    """
    Busca no DuckDuckGo insistindo até conseguir, dentro de SEARCH_PATIENCE
    segundos (2 minutos por padrão). Se nada voltar nesse tempo, devolve a
    mensagem genérica de ferramenta fora do ar.

    patience=0 desliga o limite de tempo: se o buscador não responder
    (rede, limite de requisições, HTTP ruim), insiste para sempre até ele
    responder. Resposta vazia conta como resposta — aí devolve sem
    resultados para o agente tentar outro termo. A pesquisa profunda usa
    esse modo.

    progress, quando informado, recebe uma nota a cada punhado de
    tentativas falhas — é o que mantém a cadeia de pensamento viva
    enquanto o buscador não responde.

    Devolve (resultados, erro).
    """
    if not term or not isinstance(term, str):
        return [], "Informe um termo de busca."

    term = term.strip()[:200]

    if not term:
        return [], "Informe um termo de busca."

    if patience is None:
        patience = SEARCH_PATIENCE

    unlimited = patience <= 0
    deadline = None if unlimited else time.monotonic() + patience
    attempt = 0

    while True:
        attempt += 1
        results, reason = search_once(term, limit, deadline)

        if results:
            print(
                "[NEXA-PESQUISA] %r -> %d resultado(s) na tentativa %d."
                % (term, len(results), attempt)
            )
            return results, ""

        if unlimited:
            if reason == "vazio":
                print(
                    "[NEXA-PESQUISA] %r respondeu sem resultados "
                    "(modo sem limite de tempo)." % term
                )
                return [], "A pesquisa não retornou nada útil."

            if progress and (attempt == 1 or attempt % 5 == 0):
                progress(
                    "«%s»: %s (tentativa %d). Continuo tentando."
                    % (term, search_reason_label(reason), attempt)
                )

            print(
                "[NEXA-PESQUISA] %r falhou (%s); nova tentativa em %.1fs "
                "(sem limite de tempo)."
                % (term, reason, SEARCH_RETRY_DELAY)
            )
            time.sleep(SEARCH_RETRY_DELAY)
            continue

        remaining = deadline - time.monotonic()

        if remaining <= 0:
            print(
                "[NEXA-PESQUISA] %r sem resultado apos %d tentativa(s) em %ds "
                "(ultima: %s). Devolvendo aviso de ferramenta fora do ar."
                % (term, attempt, patience, reason)
            )
            return [], SEARCH_UNAVAILABLE_MESSAGE

        if attempt >= SEARCH_MAX_ATTEMPTS:
            print(
                "[NEXA-PESQUISA] %r parou no limite de %d tentativa(s) "
                "(ultima: %s)."
                % (term, attempt, reason)
            )
            return [], SEARCH_UNAVAILABLE_MESSAGE

        # Espera curta antes de tentar de novo, sem estourar o orçamento.
        delay = min(SEARCH_RETRY_DELAY, max(0.5, remaining))
        print(
            "[NEXA-PESQUISA] %r falhou (%s); nova tentativa em %.1fs "
            "(restam %.0fs no orçamento)."
            % (term, reason, delay, remaining)
        )

        time.sleep(delay)


def parse_search_results(page, limit):
    """Puxa títulos, links e trechos da página de resultados."""
    if not page:
        return []

    links = RESULT_LINK_PATTERN.findall(page)
    snippets = [
        clean_search_text(item) for item in RESULT_SNIPPET_PATTERN.findall(page)
    ]

    if not links:
        # Layout do endpoint lite (entra quando o html limita o IP).
        links = LITE_LINK_PATTERN.findall(page)
        snippets = [
            clean_search_text(item)
            for item in LITE_SNIPPET_PATTERN.findall(page)
        ]

    if not links:
        # Layout do Bing (entra quando os dois do DuckDuckGo falham).
        links = BING_LINK_PATTERN.findall(page)
        snippets = [
            clean_search_text(item)
            for item in BING_SNIPPET_PATTERN.findall(page)
        ]

    results = []
    seen = set()

    for position, (url, raw_title) in enumerate(links):
        title = clean_search_text(raw_title)

        if not title:
            continue

        final_url = unwrap_duckduckgo_url(unwrap_bing_url(url))

        if not final_url or final_url in seen:
            continue

        seen.add(final_url)

        snippet = (
            snippets[position]
            if position < len(snippets)
            else ""
        )[:SEARCH_SNIPPET_LIMIT]

        results.append({
            "titulo": title,
            "url": final_url,
            "trecho": snippet,
        })

        if len(results) >= min(limit, SEARCH_MAX_RESULTS):
            break

    return results


def format_search_results(term, results, user_id=None):
    """
    Formata resultados com prefixos P1, P2... para o modelo referenciar.
    Se user_id for passado, guarda o mapeamento no cache para a ferramenta
    visitar_pagina resolver depois.
    """
    lines = ['Resultados da busca por "%s":' % term, ""]

    prefix_map = {}
    for position, item in enumerate(results, start=1):
        prefix = "P%d" % position
        prefix_map[prefix] = item["url"]
        lines.append("%s. %s" % (prefix, item["titulo"]))
        lines.append("   %s" % item["url"])

        if item["trecho"]:
            lines.append("   %s" % item["trecho"])

    if user_id and prefix_map:
        with _search_cache_lock:
            _last_search_cache[user_id] = prefix_map

    return "\n".join(lines)


def fetch_pages(user_id, prefixes):
    """
    Busca o conteúdo completo das páginas indicadas pelos prefixos P1, P2...
    Devolve texto formatado para o modelo.
    """
    if not prefixes:
        return "Nenhuma página indicada."

    with _search_cache_lock:
        prefix_map = _last_search_cache.get(user_id, {})

    if not prefix_map:
        return "Nenhuma busca anterior encontrada. Use pesquisar primeiro."

    lines = []
    for prefix in prefixes:
        url = prefix_map.get(prefix)
        if not url:
            lines.append("%s: prefixo não encontrado na última busca." % prefix)
            continue

        try:
            resp = requests.get(url, headers=SEARCH_HEADERS, timeout=(5, 15))
            if resp.status_code != 200:
                lines.append("%s (%s): erro HTTP %d" % (prefix, url, resp.status_code))
                continue

            text = extract_main_text(resp.text)
            if not text:
                lines.append("%s (%s): não foi possível extrair texto." % (prefix, url))
                continue

            # Limita para não estourar tokens
            if len(text) > 8000:
                text = text[:8000] + "\n... [truncado]"

            lines.append("=== %s (%s) ===" % (prefix, url))
            lines.append(text)
            lines.append("")

        except requests.RequestException as e:
            lines.append("%s (%s): erro de rede: %s" % (prefix, url, e))

    return "\n".join(lines) if lines else "Nenhuma página pôde ser lida."


def extract_main_text(html):
    """
    Extrai o texto principal de uma página HTML, removendo scripts, styles,
    nav, footer, etc. Usa BeautifulSoup se disponível, senão regex simples.
    """
    try:
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(html, "html.parser")

        # Remove elementos que não são conteúdo
        for tag in soup(["script", "style", "nav", "footer", "header", "aside",
                         "noscript", "iframe", "form", "button", "input"]):
            tag.decompose()

        # Tenta achar o conteúdo principal
        main = soup.find("main") or soup.find("article") or soup.find(role="main")
        if main:
            text = main.get_text(separator="\n", strip=True)
        else:
            text = soup.get_text(separator="\n", strip=True)

        # Limpa linhas vazias excessivas
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        return "\n".join(lines)

    except ImportError:
        # Fallback sem BeautifulSoup: regex simples
        text = TAG_PATTERN.sub(" ", html)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:8000]
