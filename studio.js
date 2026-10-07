const chat = document.getElementById("chat");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const statusLabel = document.getElementById("studioStatus");
const filesPane = document.getElementById("filesPane");
const fileTree = document.getElementById("fileTree");
const fileTreeEmpty = document.getElementById("fileTreeEmpty");
const filesToggle = document.getElementById("filesToggle");
const filesRefresh = document.getElementById("filesRefresh");
const filesClose = document.getElementById("filesClose");
const filesResize = document.getElementById("filesResize");
const chatResize = document.getElementById("chatResize");
const filesSearch = document.getElementById("filesSearch");
const filesCount = document.getElementById("filesCount");
const viewerTabs = document.getElementById("viewerTabs");
const viewerPanels = document.getElementById("viewerPanels");
const viewerEmpty = document.getElementById("viewerEmpty");
const btnStop = document.getElementById("btnStop");
const newChatButton = document.getElementById("newChat");
const chatList = document.getElementById("chatList");

const STORAGE_PREFIX = "nexa_studio:";
let HISTORY_KEY = "";
let CHATS_KEY = "";
let ACTIVE_CHAT_KEY = "";
const HISTORY_LIMIT = 40;
const KEY_PREFIX = "nexa_message_key:";
const FILES_WIDTH_KEY = "nexa_studio_files_width";
const CHAT_WIDTH_KEY = "nexa_studio_chat_width";
let TABS_KEY = "";
let TREE_OPEN_KEY = "";

let accountUsername = "";
let messageKey = "";
let history = [];
let studioChats = [];
let activeChatId = "";
let busy = false;
let abortController = null;
let sendSeq = 0;
let openTabs = new Map();
let activeTabPath = "";
let treeOpenPaths = new Set();
let currentFilter = "";

function setStatus(text, busyState) {
  statusLabel.textContent = text;
  if (busyState !== undefined) {
    busy = busyState;
    btnStop.hidden = !busy;
    composer.querySelector('button[type="submit"]').hidden = busy;
    if (busy) {
      statusLabel.classList.add("studio-loading");
    } else {
      statusLabel.classList.remove("studio-loading");
    }
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function configureAccountStorage(accountId) {
  const prefix = STORAGE_PREFIX + encodeURIComponent(accountId) + ":";
  HISTORY_KEY = prefix + "history";
  CHATS_KEY = prefix + "chats";
  ACTIVE_CHAT_KEY = prefix + "active";
  TABS_KEY = prefix + "tabs";
  TREE_OPEN_KEY = prefix + "tree_open";
}

function renderMarkdown(text) {
  const blocks = escapeHtml(text).split("```");
  let out = "";

  for (let index = 0; index < blocks.length; index += 1) {
    if (index % 2 === 1) {
      const body = blocks[index].replace(/^[^\n]*\n/, "").replace(/\n$/, "");
      const langMatch = body.match(/^(\w+)\n/);
      const lang = langMatch ? langMatch[1] : "";
      const code = langMatch ? body.slice(langMatch[0].length) : body;
      out += `<pre><code class="language-${lang} hljs">${code}</code></pre>`;
    } else {
      out += blocks[index]
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
    }
  }

  if (window.hljs) {
    setTimeout(() => {
      document.querySelectorAll(".bubble pre code.hljs").forEach(el => {
        if (!el.dataset.hljsHighlighted) {
          window.hljs.highlightElement(el);
          el.dataset.hljsHighlighted = "true";
        }
      });
    }, 0);
  }

  return out;
}

function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

function addMessage(role, text, note) {
  const article = document.createElement("article");
  article.className = "message message-" + role + (note ? " message-note" : "");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "user") {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  article.appendChild(bubble);
  chat.appendChild(article);
  scrollDown();

  return { article, bubble };
}

function describeTool(event) {
  const labels = {
    listar_arquivos: "Listou arquivos",
    ler_arquivo: "Leu",
    escrever_arquivo: "Salvou",
    salvar_memoria: "Anotou na memória",
  };

  const label = labels[event.name] || "Usou " + event.name;
  return event.detail ? label + " " + event.detail : label;
}

/*
  Conversas do Estúdio: cada chat fica salvo em localStorage por conta.
  Só o chat ativo vive em `history`; ao trocar, o anterior é gravado de
  volta antes de carregar o próximo.
*/
function makeStudioChat(messages) {
  return {
    id:
      "sc_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8),
    title: "Nova conversa",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: Array.isArray(messages) ? messages : []
  };
}

function findStudioChat(id) {
  return studioChats.find(item => item.id === id) || null;
}

function deriveChatTitle(messages) {
  const first = (messages || []).find(
    item => item && item.role === "user" && String(item.content || "").trim()
  );

  if (!first) {
    return "Conversa antiga";
  }

  const text = String(first.content).trim().replace(/\s+/g, " ");

  return text.length > 48 ? text.slice(0, 48).trim() + "…" : text;
}

function formatWhen(ms) {
  const when = new Date(ms);
  const now = new Date();
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();

  if (sameDay) {
    return when.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return when.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit"
  });
}

/*
  Chat vazio = tela de boas-vindas do Estúdio: as conversas salvas
  aparecem no próprio painel para o usuário retomar uma delas. No
  primeiro prompt a lista some da "aba" (a tela vazia) e a conversa
  assume o espaço.
*/
function renderSavedChats() {
  const empty = history.length === 0;

  chatList.hidden = !empty;
  chat.hidden = empty;
  chatList.innerHTML = "";

  if (!empty) {
    return;
  }

  const saved = studioChats
    .filter(item => item.id !== activeChatId && item.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (saved.length === 0) {
    const hint = document.createElement("p");

    hint.className = "studio-chat-list-hint";
    hint.textContent = "Nenhuma conversa salva ainda.";
    chatList.appendChild(hint);
    return;
  }

  const label = document.createElement("span");

  label.className = "studio-chat-list-label";
  label.textContent = "Conversas salvas";
  chatList.appendChild(label);

  saved.forEach(item => {
    const row = document.createElement("button");

    row.type = "button";
    row.className = "studio-chat-list-item";
    row.title = item.title;

    const title = document.createElement("span");

    title.className = "studio-chat-list-title";
    title.textContent = item.title;

    const when = document.createElement("span");

    when.className = "studio-chat-list-when";
    when.textContent = formatWhen(item.updatedAt);

    row.append(title, when);
    row.addEventListener("click", () => switchStudioChat(item.id));
    chatList.appendChild(row);
  });
}

function switchStudioChat(id) {
  const target = findStudioChat(id);

  if (!target || id === activeChatId) {
    return;
  }

  sendSeq += 1;

  if (busy) {
    stopGeneration();
  }

  const current = findStudioChat(activeChatId);

  if (current) {
    current.messages = history;
  }

  activeChatId = id;
  history = target.messages;
  chat.innerHTML = "";
  saveStudioChats();

  for (const message of history) {
    addMessage(
      message.role === "user" ? "user" : "assistant",
      String(message.content || "")
    );
  }

  renderSavedChats();
  setStatus("Pronto", false);
  input.focus();
}

function trimHistory() {
  if (history.length > HISTORY_LIMIT) {
    history = history.slice(-HISTORY_LIMIT);
  }
}

function saveStudioChats() {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(studioChats));
    localStorage.setItem(ACTIVE_CHAT_KEY, activeChatId || "");
  } catch (error) { }
}

function saveHistory() {
  const current = findStudioChat(activeChatId);

  if (current) {
    current.messages = history;
    current.updatedAt = Date.now();
  }

  saveStudioChats();
}

function loadHistory() {
  studioChats = [];

  try {
    const stored = JSON.parse(localStorage.getItem(CHATS_KEY) || "[]");

    if (Array.isArray(stored)) {
      studioChats = stored.filter(
        item =>
          item &&
          typeof item.id === "string" &&
          Array.isArray(item.messages)
      );
    }
  } catch (error) {
    studioChats = [];
  }

  /*
    A conversa única de antes da lista de chats vira o primeiro chat
    salvo: ninguém perde o histórico ao atualizar.
  */
  if (studioChats.length === 0) {
    let legacy = [];

    try {
      legacy = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch (error) {
      legacy = [];
    }

    if (Array.isArray(legacy) && legacy.length > 0) {
      const migrated = makeStudioChat(legacy);

      migrated.title = deriveChatTitle(legacy);
      studioChats.push(migrated);
    }
  }

  if (studioChats.length === 0) {
    studioChats.push(makeStudioChat());
  }

  studioChats.forEach(item => {
    if (!item.title) {
      item.title = deriveChatTitle(item.messages);
    }
    if (typeof item.updatedAt !== "number") {
      item.updatedAt = Date.now();
    }
    if (typeof item.createdAt !== "number") {
      item.createdAt = item.updatedAt;
    }
  });

  activeChatId = localStorage.getItem(ACTIVE_CHAT_KEY) || "";
  let current = findStudioChat(activeChatId);

  if (!current) {
    current = studioChats
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    activeChatId = current.id;
  }

  history = current.messages;

  if (history.length > HISTORY_LIMIT) {
    history = history.slice(-HISTORY_LIMIT);
    current.messages = history;
  }

  for (const message of history) {
    addMessage(
      message.role === "user" ? "user" : "assistant",
      String(message.content || "")
    );
  }

  saveStudioChats();
  renderSavedChats();
}

async function sendMessage(text) {
  const clean = text.trim();

  if (!clean || busy) {
    return;
  }

  busy = true;
  const mySeq = ++sendSeq;
  abortController = new AbortController();
  input.value = "";
  setStatus("Pensando…", true);

  const firstPrompt = history.length === 0;

  addMessage("user", clean);
  history.push({ role: "user", content: clean });
  trimHistory();

  /*
    Primeiro prompt: o chat ganha título e a lista de conversas salvas
    some da tela vazia — a conversa assume o painel.
  */
  if (firstPrompt) {
    const current = findStudioChat(activeChatId);

    if (current) {
      current.title = deriveChatTitle(history);
    }
  }

  saveHistory();
  renderSavedChats();

  const historyBefore = history.slice(0, -1);
  const { article, bubble } = addMessage("assistant", "");
  let fullText = "";

  const handleEvent = (payload) => {
    if (payload.type === "text") {
      fullText += payload.text;
      bubble.innerHTML = renderMarkdown(fullText);
      scrollDown();
    } else if (payload.type === "tool") {
      const toolText = "⚙ " + describeTool(payload);
      addMessage("assistant", toolText, true);

      if (payload.name === "escrever_arquivo" && payload.detail) {
        openTab(payload.detail);
      }
    } else if (payload.type === "error") {
      fullText += (fullText ? "\n\n" : "") + (payload.error || "Deu erro.");
      bubble.innerHTML = renderMarkdown(fullText);
    }
  };

  try {
    const response = await fetch("/api/studio/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey,
      },
      body: JSON.stringify({ message: clean, messages: historyBefore }),
      signal: abortController.signal,
    });

    if (response.status === 401) {
      localStorage.removeItem(KEY_PREFIX + accountUsername);
      location.replace("/");
      return;
    }

    if (!response.ok || !response.body) {
      let reason = "O Estúdio não respondeu (HTTP " + response.status + ").";
      try {
        const data = await response.json();
        reason = data.error || reason;
      } catch (error) { }
      throw new Error(reason);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");

      while (separator !== -1) {
        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) {
            continue;
          }
          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch (error) { }
        }

        separator = buffer.indexOf("\n\n");
      }
    }

    if (activeTabPath) {
      refreshTabContent(activeTabPath);
    }
  } catch (error) {
    if (error.name === "AbortError" || error.message.includes("Aborted")) {
      fullText += (fullText ? "\n\n" : "") + "*(interrompido)*";
    } else {
      fullText += (fullText ? "\n\n" : "") + "⚠ " + error.message;
    }
    bubble.innerHTML = renderMarkdown(fullText);
  }

  // A conversa pode ter sido reiniciada no meio da geração; nesse caso o
  // histórico já foi limpo e o status já foi zerado — não escreve por cima.
  if (mySeq !== sendSeq) {
    return;
  }

  if (!fullText.trim()) {
    article.remove();
  } else {
    history.push({ role: "assistant", content: fullText });
    trimHistory();
    saveHistory();
  }

  setStatus("Pronto", false);
  refreshFiles();
}

function stopGeneration() {
  if (abortController) {
    abortController.abort();
  }
}

btnStop.addEventListener("click", stopGeneration);

newChatButton.addEventListener("click", () => {
  sendSeq += 1;
  if (busy) {
    stopGeneration();
  }

  const current = findStudioChat(activeChatId);

  if (current) {
    current.messages = history;
  }

  /*
    Em chat vazio não há o que reiniciar: só garante a lista visível.
    Com conteúdo, muda para um chat vazio (reaproveita um existente,
    se houver) sem apagar a conversa atual.
  */
  if (history.length > 0) {
    let target = studioChats.find(item => item.messages.length === 0);

    if (!target) {
      target = makeStudioChat();
      studioChats.push(target);
    }

    activeChatId = target.id;
    history = target.messages;
  }

  chat.innerHTML = "";
  saveStudioChats();
  renderSavedChats();
  setStatus("Pronto", false);
  input.focus();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

function setPaneOpen(open) {
  filesPane.hidden = !open;
  filesToggle.setAttribute("aria-expanded", open);
  if (open) {
    refreshFiles();
  }
}

filesToggle.addEventListener("click", () => {
  setPaneOpen(filesPane.hidden);
});

filesClose.addEventListener("click", () => {
  setPaneOpen(false);
});

filesRefresh.addEventListener("click", refreshFiles);

filesSearch.addEventListener("input", (e) => {
  currentFilter = e.target.value.toLowerCase();
  renderFileTree();
});

function makeResizable(handle, cssVar, storageKey, fromLeftEdge) {
  let dragging = false;

  function finishResize(event) {
    if (!dragging) return;
    dragging = false;
    if (event && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    try {
      localStorage.setItem(
        storageKey,
        document.documentElement.style.getPropertyValue(cssVar),
      );
    } catch (error) { }
  }

  handle.addEventListener("pointerdown", (event) => {
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    const filesOpen = !filesPane.hidden;
    const filesWidth = filesOpen
      ? parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--files-width")) || 320
      : 0;
    const otherPanel = fromLeftEdge
      ? parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue("--chat-width")) || 380
      : filesWidth;
    const pagePadding = window.innerWidth <= 760 ? 0 : 48;
    const minimumCenter = 240;
    const maximum = Math.max(
      240,
      window.innerWidth - otherPanel - minimumCenter - pagePadding,
    );
    const target = fromLeftEdge
      ? event.clientX
      : window.innerWidth - event.clientX;
    const width = Math.min(Math.max(target, 240), maximum);

    document.documentElement.style.setProperty(cssVar, width + "px");
  });

  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("lostpointercapture", finishResize);

  try {
    const savedWidth = localStorage.getItem(storageKey);
    if (savedWidth) {
      const width = Number.parseFloat(savedWidth);
      if (Number.isFinite(width)) {
        document.documentElement.style.setProperty(
          cssVar,
          Math.min(Math.max(width, 240), window.innerWidth * 0.7) + "px",
        );
      }
    }
  } catch (error) { }
}

makeResizable(filesResize, "--files-width", FILES_WIDTH_KEY, true);
makeResizable(chatResize, "--chat-width", CHAT_WIDTH_KEY, false);

async function refreshFiles() {
  try {
    const response = await fetch("/api/studio/files", {
      headers: { "X-Nexa-Message-Key": messageKey },
    });

    if (!response.ok) return;

    const data = await response.json();
    const files = data.files || [];
    filesCount.textContent = files.length;

    buildTreeStructure(files);
    renderFileTree();

    if (files.length === 0) {
      fileTree.hidden = true;
      fileTreeEmpty.hidden = false;
    } else {
      fileTree.hidden = false;
      fileTreeEmpty.hidden = true;
    }
  } catch (error) { }
}

async function deleteFile(path, name) {
  if (!window.confirm('Excluir "' + name + '"? Essa ação não pode ser desfeita.')) {
    return;
  }

  try {
    const response = await fetch("/api/studio/file?caminho=" + encodeURIComponent(path), {
      method: "DELETE",
      headers: { "X-Nexa-Message-Key": messageKey },
    });

    if (response.status === 401) {
      localStorage.removeItem(KEY_PREFIX + accountUsername);
      location.replace("/");
      return;
    }

    if (!response.ok) {
      let reason = "Não foi possível excluir o arquivo.";
      try {
        const data = await response.json();
        reason = data.error || reason;
      } catch (error) { }
      window.alert(reason);
      return;
    }

    if (openTabs.has(path)) {
      closeTab(path);
    }

    await refreshFiles();
  } catch (error) {
    window.alert("Sem conexão com o Estúdio.");
  }
}

function buildTreeStructure(files) {
  const root = { name: "", path: "", type: "folder", children: {}, meta: null };

  for (const file of files) {
    const parts = file.caminho.split("/").filter(Boolean);
    let node = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: node.path ? node.path + "/" + part : part,
          type: isFile ? "file" : "folder",
          children: isFile ? null : {},
          meta: isFile ? { size: file.tamanho, modified: file.modificado } : null,
        };
      }
      node = node.children[part];
    }
  }
  window.__studioFileTree = root;
}

function renderFileTree() {
  const root = window.__studioFileTree;
  if (!root) return;

  fileTree.innerHTML = "";

  function renderNode(node, depth = 0) {
    if (node.type === "folder") {
      const details = document.createElement("details");
      if (treeOpenPaths.has(node.path)) {
        details.open = true;
      }
      details.addEventListener("toggle", () => {
        if (details.open) {
          treeOpenPaths.add(node.path);
        } else {
          treeOpenPaths.delete(node.path);
        }
        saveTreeState();
      });

      const summary = document.createElement("summary");
      summary.innerHTML = `
        <svg class="studio-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span class="studio-file-name">${escapeHtml(node.name)}</span>
      `;
      details.appendChild(summary);

      const ul = document.createElement("ul");
      for (const child of Object.values(node.children).sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })) {
        const li = document.createElement("li");
        li.appendChild(renderNode(child, depth + 1));
        ul.appendChild(li);
      }
      details.appendChild(ul);
      return details;
    } else {
      const li = document.createElement("li");
      const div = document.createElement("div");
      div.className = "studio-file-item";
      div.tabIndex = 0;
      div.dataset.path = node.path;
      div.dataset.size = node.meta?.size || 0;
      div.dataset.modified = node.meta?.modified || 0;

      if (node.path === activeTabPath) {
        div.classList.add("studio-active");
      }

      const sizeStr = formatSize(node.meta?.size || 0);
      const modStr = node.meta?.modified ? formatDate(node.meta.modified) : "";

      div.innerHTML = `
        <svg class="studio-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
        <span class="studio-file-name">${escapeHtml(node.name)}</span>
        <span class="studio-file-meta">${sizeStr}${modStr ? " · " + modStr : ""}</span>
        <button type="button" class="studio-file-delete" title="Excluir arquivo" aria-label="Excluir ${escapeHtml(node.name)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      `;

      div.addEventListener("click", () => openTab(node.path));
      div.addEventListener("keydown", (e) => {
        if (e.target !== div) {
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTab(node.path);
        }
      });

      div.querySelector(".studio-file-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteFile(node.path, node.name);
      });

      if (currentFilter && !node.name.toLowerCase().includes(currentFilter) &&
          !node.path.toLowerCase().includes(currentFilter)) {
        div.style.display = "none";
      }

      li.appendChild(div);
      return li;
    }
  }

  for (const child of Object.values(root.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    const li = document.createElement("li");
    li.appendChild(renderNode(child));
    fileTree.appendChild(li);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function saveTreeState() {
  try {
    localStorage.setItem(TREE_OPEN_KEY, JSON.stringify([...treeOpenPaths]));
  } catch (error) { }
}

function loadTreeState() {
  try {
    const stored = JSON.parse(localStorage.getItem(TREE_OPEN_KEY) || "[]");
    treeOpenPaths = new Set(stored);
  } catch (error) {
    treeOpenPaths = new Set();
  }
}

function saveTabsState() {
  try {
    const tabsData = {
      tabs: [...openTabs.entries()].map(([path, content]) => ({ path, content })),
      active: activeTabPath,
    };
    localStorage.setItem(TABS_KEY, JSON.stringify(tabsData));
  } catch (error) { }
}

function loadTabsState() {
  try {
    const stored = JSON.parse(localStorage.getItem(TABS_KEY) || "{}");
    if (stored.tabs) {
      for (const { path, content } of stored.tabs) {
        openTabs.set(path, content);
      }
    }
    activeTabPath = stored.active || "";
  } catch (error) {
    openTabs = new Map();
    activeTabPath = "";
  }
}

async function openTab(path) {
  if (!path) return;

  if (activeTabPath && openTabs.has(activeTabPath)) {
    const oldPanel = viewerPanels.querySelector(`[data-path="${escapeHtml(activeTabPath)}"]`);
    if (oldPanel) oldPanel.setAttribute("aria-hidden", "true");
    const oldTab = viewerTabs.querySelector(`[data-path="${escapeHtml(activeTabPath)}"]`);
    if (oldTab) oldTab.setAttribute("aria-selected", "false");
  }

  let content = openTabs.get(path);

  if (!content) {
    try {
      const response = await fetch("/api/studio/file?caminho=" + encodeURIComponent(path), {
        headers: { "X-Nexa-Message-Key": messageKey },
      });
      const data = await response.json();
      if (response.ok) {
        content = data.conteudo || "";
      } else {
        content = "Erro ao carregar: " + (data.error || "desconhecido");
      }
    } catch (error) {
      content = "Erro ao carregar: " + error.message;
    }
    openTabs.set(path, content);
  }

  activeTabPath = path;
  saveTabsState();
  renderTabs();
  updateViewerContent(path);
  viewerEmpty.hidden = true;

  document.querySelectorAll(".studio-file-item.studio-active").forEach(el => el.classList.remove("studio-active"));
  const activeFileItem = fileTree.querySelector(`[data-path="${escapeHtml(path)}"]`);
  if (activeFileItem) activeFileItem.classList.add("studio-active");
}

function renderTabs() {
  viewerTabs.innerHTML = "";

  if (openTabs.size === 0) {
    viewerTabs.hidden = true;
    return;
  }

  viewerTabs.hidden = false;

  for (const path of openTabs.keys()) {
    const tab = document.createElement("button");
    tab.className = "studio-viewer-tab";
    tab.role = "tab";
    tab.dataset.path = path;
    tab.setAttribute("aria-selected", path === activeTabPath ? "true" : "false");

    const shortName = path.split("/").pop() || path;

    tab.innerHTML = `
      <span class="studio-viewer-tab-name" title="${escapeHtml(path)}">${escapeHtml(shortName)}</span>
      <button class="studio-viewer-tab-close" aria-label="Fechar ${escapeHtml(shortName)}" data-path="${escapeHtml(path)}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    `;

    tab.addEventListener("click", (e) => {
      if (!e.target.closest(".studio-viewer-tab-close")) {
        openTab(path);
      }
    });

    tab.querySelector(".studio-viewer-tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(path);
    });

    viewerTabs.appendChild(tab);
  }
}

function closeTab(path) {
  if (!openTabs.has(path)) return;

  openTabs.delete(path);

  if (activeTabPath === path) {
    const remaining = [...openTabs.keys()];
    if (remaining.length > 0) {
      activeTabPath = remaining[remaining.length - 1];
    } else {
      activeTabPath = "";
      viewerEmpty.hidden = false;
      viewerTabs.hidden = true;
      viewerPanels.innerHTML = "";
    }
  }

  saveTabsState();
  renderTabs();
  if (activeTabPath) {
    updateViewerContent(activeTabPath);
  }
}

function updateViewerContent(path) {
  viewerPanels.querySelectorAll(".studio-viewer-panel").forEach(panel => {
    panel.setAttribute("aria-hidden", "true");
  });

  let panel = viewerPanels.querySelector(`[data-path="${escapeHtml(path)}"]`);

  if (!panel) {
    panel = document.createElement("div");
    panel.className = "studio-viewer-panel";
    panel.dataset.path = path;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-hidden", "false");
    panel.innerHTML = `
      <div class="studio-viewer-panel-header">
        <span class="studio-viewer-panel-path">${escapeHtml(path)}</span>
        <div class="studio-viewer-panel-actions">
          <button class="studio-viewer-panel-btn" data-action="copy" title="Copiar conteúdo" aria-label="Copiar conteúdo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          </button>
          <button class="studio-viewer-panel-btn" data-action="download" title="Baixar arquivo" aria-label="Baixar arquivo">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
        </div>
      </div>
      <div class="studio-viewer-panel-content"><pre><code class="hljs"></code></pre></div>
    `;
    viewerPanels.appendChild(panel);

    panel.querySelector("[data-action=copy]").addEventListener("click", () => copyTabContent(path));
    panel.querySelector("[data-action=download]").addEventListener("click", () => downloadTabContent(path));
  } else {
    panel.setAttribute("aria-hidden", "false");
  }

  const content = openTabs.get(path) || "";
  const codeEl = panel.querySelector("code");
  codeEl.textContent = content;

  if (window.hljs) {
    // A 1a chamada marca o elemento com data-highlighted="yes"; o reset acima
    // apaga os tokens mas não o atributo, e a partir daí o hljs ignora a
    // chamada — o texto ficava cru e cinza ao reselecionar o arquivo.
    codeEl.removeAttribute("data-highlighted");

    try {
      window.hljs.highlightElement(codeEl);
    } catch (error) { }
  }
}

async function refreshTabContent(path) {
  try {
    const response = await fetch("/api/studio/file?caminho=" + encodeURIComponent(path), {
      headers: { "X-Nexa-Message-Key": messageKey },
    });
    const data = await response.json();
    if (response.ok) {
      const content = data.conteudo || "";
      openTabs.set(path, content);
      saveTabsState();
      if (path === activeTabPath) {
        updateViewerContent(path);
      }
    }
  } catch (error) { }
}

function copyTabContent(path) {
  const content = openTabs.get(path);
  if (!content) return;
  navigator.clipboard.writeText(content).then(() => {
    setStatus("Copiado!", false);
    setTimeout(() => setStatus("Pronto", false), 1500);
  });
}

function downloadTabContent(path) {
  const content = openTabs.get(path);
  if (!content) return;
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = path.split("/").pop() || "arquivo";
  a.click();
  URL.revokeObjectURL(url);
}

async function initializeStudio() {
  try {
    const response = await fetch("/api/auth/me");

    if (!response.ok) {
      location.replace("/");
      return;
    }

    const data = await response.json();
    accountUsername = data.user.username;
    messageKey = localStorage.getItem(KEY_PREFIX + accountUsername) || "";

    if (!messageKey) {
      location.replace("/");
      return;
    }

    configureAccountStorage(data.user.id);
    loadHistory();
    loadTabsState();
    loadTreeState();

    if (activeTabPath && openTabs.has(activeTabPath)) {
      renderTabs();
      updateViewerContent(activeTabPath);
      viewerEmpty.hidden = true;
    } else {
      viewerEmpty.hidden = false;
      viewerTabs.hidden = true;
    }

    setStatus("Pronto", false);
    refreshFiles();
  } catch (error) {
    setStatus("Sem conexão", false);
  }
}

initializeStudio();