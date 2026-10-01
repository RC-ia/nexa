const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const chat = document.getElementById("chat");

/* A conversa rola dentro de .feed; o composer fica fixo no rodapé. */
const feed = document.querySelector(".feed");

const micButton = document.getElementById("micButton");
const liveCallButton = document.getElementById("liveCallButton");
const sendButton = composer.querySelector('button[type="submit"]');
const newChatButton = document.getElementById("newChatButton");

const app = document.querySelector(".app");
const drawerToggle = document.getElementById("drawerToggle");
const drawerClose = document.getElementById("drawerClose");
const drawerScrim = document.getElementById("drawerScrim");
const drawerNewChat = document.getElementById("drawerNewChat");
const drawerChats = document.getElementById("drawerChats");
const drawerSettings = document.getElementById("drawerSettings");
const settingsPanel = document.getElementById("settingsPanel");
const settingsClose = document.getElementById("settingsClose");
const settingsHome = document.getElementById("settingsHome");
const settingsTitle = document.getElementById("settingsTitle");
const settingsViews = {
  live: document.getElementById("settingsLive"),
  memory: document.getElementById("settingsMemory"),
  instructions: document.getElementById("settingsInstructions"),
  reminders: document.getElementById("settingsReminders"),
  more: document.getElementById("settingsMore")
};
const liveVoiceSelect = document.getElementById("liveVoiceSelect");
const liveVoiceStatus = document.getElementById("liveVoiceStatus");
const liveCallOpenButton = document.getElementById("liveCallOpen");
const memoryToggle = document.getElementById("memoryToggle");
const memoryList = document.getElementById("memoryList");
const memoryStatus = document.getElementById("memoryStatus");
const customInstructionsInput = document.getElementById("customInstructions");
const instructionStatus = document.getElementById("instructionStatus");
const systemPromptInput = document.getElementById("systemPromptInput");
const systemPromptStatus = document.getElementById("systemPromptStatus");
const reminderList = document.getElementById("reminderList");
const reminderStatus = document.getElementById("reminderStatus");
const pushStatusLine = document.getElementById("pushStatus");
const reminderNotificationButton = document.getElementById("reminderNotification");

const MEMORY_KEY = "nexa_conversation";
const MESSAGE_KEY_STORAGE_PREFIX = "nexa_message_key:";
let CHATS_KEY = "nexa_chats";
let ACTIVE_CHAT_KEY = "nexa_active_chat";
const CHATS_PUSH_DELAY_MS = 1500;
const REASONING_KEY = "nexa_reasoning";
const LIVE_VOICE_KEY = "nexa_live_voice";
const MEMORY_ENABLED_KEY = "nexa_memory_enabled:";
const INSTRUCTIONS_KEY = "nexa_custom_instructions:";

const REASONING_LABELS = {
  none: "Rápido",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Máximo",
};

/* Quantidade de barras acesas no medidor, por nível. */
const REASONING_LEVELS = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
};

const history = [];

/*
  ==========================================
  REFORÇO DE RACIOCÍNIO
  ==========================================
*/

let reasoningLevel = "none";

function loadReasoning() {
  reasoningLevel = "none";

  try {
    const saved =
      localStorage.getItem(REASONING_KEY);

    if (
      saved &&
      REASONING_LABELS.hasOwnProperty(saved)
    ) {
      reasoningLevel = saved;
    }
  } catch (error) {
    console.error(
      "Erro ao carregar reforço de raciocínio:",
      error
    );
  }
}

function saveReasoning() {
  try {
    localStorage.setItem(
      REASONING_KEY,
      reasoningLevel
    );
  } catch (error) {
    console.error(
      "Erro ao salvar reforço de raciocínio:",
      error
    );
  }
}

function renderReasoning() {
  const label =
    document.getElementById("reasoningLabel");
  const button =
    document.getElementById("reasoningButton");
  const dropdown =
    document.getElementById("reasoningDropdown");

  const level =
    REASONING_LEVELS[reasoningLevel] ?? 0;

  if (label) {
    label.textContent =
      REASONING_LABELS[reasoningLevel] ||
      "Rápido";
  }

  if (button) {
    button.classList.toggle(
      "active",
      level > 0
    );

    /*
      O medidor de barras usa data-level
      para acender só as barras do nível.
    */

    button.dataset.level = String(level);
  }

  if (dropdown) {
    dropdown
      .querySelectorAll(".reasoning-item")
      .forEach(item => {
        const isActive =
          item.dataset.reasoning === reasoningLevel;

        item.classList.toggle(
          "active",
          isActive
        );

        item.setAttribute(
          "aria-checked",
          isActive ? "true" : "false"
        );
      });
  }
}

function setupReasoningUI() {
  const button =
    document.getElementById("reasoningButton");
  const dropdown =
    document.getElementById("reasoningDropdown");

  if (!button || !dropdown) {
    return;
  }

  function setOpen(isOpen) {
    dropdown.classList.toggle(
      "open",
      isOpen
    );

    button.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );
  }

  button.addEventListener(
    "click",
    function (event) {
      event.stopPropagation();

      setOpen(
        !dropdown.classList.contains("open")
      );
    }
  );

  dropdown.addEventListener(
    "click",
    function (event) {
      const item =
        event.target.closest(".reasoning-item");

      if (!item) {
        return;
      }

      reasoningLevel =
        item.dataset.reasoning || "none";

      saveReasoning();
      renderReasoning();
      setOpen(false);
    }
  );

  document.addEventListener(
    "click",
    function () {
      setOpen(false);
    }
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape") {
        setOpen(false);
        button.focus();
      }
    }
  );
}


/*
  ==========================================
  MEMÓRIA LOCAL DAS CONVERSAS
  `history` continua sendo a conversa aberta; `chats` guarda
  todas. A primeira versão guardava uma conversa só em
  nexa_conversation, e a migração abaixo traz ela para cá.
  ==========================================
*/

let chats = [];
let activeChatId = null;
let drawerOpen = false;

function makeId() {
  return (
    "chat_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 7)
  );
}

/* Id da mensagem: o merge entre aparelhos usa para não duplicar. */
function makeMessageId() {
  return (
    "msg_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 7)
  );
}

function cleanMessages(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .filter(
      item =>
        item &&
        typeof item.role === "string" &&
        typeof item.content === "string"
    )
    .map(item => ({
      role: item.role,
      content: item.content,
      id: typeof item.id === "string" ? item.id : undefined,
      thinking: item.thinking,
      memoryUpdated: item.memoryUpdated === true,
      searched: item.searched === true
    }));
}

function chatTitle(messages) {
  const first = messages.find(
    item =>
      item.role === "user" &&
      item.content.trim()
  );

  if (!first) {
    return "Nova conversa";
  }

  const single = first.content
    .replace(/\s+/g, " ")
    .trim();

  return single.length > 42
    ? single.slice(0, 42) + "…"
    : single;
}

function formatWhen(timestamp) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();

  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(
    yesterday.getDate() - 1
  );

  const dayBefore =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();

  const hour = date
    .toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });

  if (sameDay) {
    return hour;
  }

  if (dayBefore) {
    return "Ontem, " + hour;
  }

  const day = date
    .toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit"
    });

  return day + " " + hour;
}

function makeChat() {
  return {
    id: makeId(),
    title: "Nova conversa",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    rev: 0,
    dirty: false
  };
}

function normalizeChat(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const messages = cleanMessages(raw.messages);

  return {
    id:
      typeof raw.id === "string" &&
      raw.id
        ? raw.id
        : makeId(),

    title:
      typeof raw.title === "string" &&
      raw.title
        ? raw.title
        : chatTitle(messages),

    createdAt:
      Number(raw.createdAt) ||
      Date.now(),

    updatedAt:
      Number(raw.updatedAt) ||
      Date.now(),

    rev: Math.max(
      0,
      Math.floor(Number(raw.rev) || 0)
    ),

    dirty: raw.dirty === true,

    messages
  };
}

function findChat(id) {
  if (!id) {
    return null;
  }

  return (
    chats.find(item => item.id === id) ||
    null
  );
}

function currentChat() {
  return findChat(activeChatId);
}

function saveChats() {
  localStorage.setItem(
    CHATS_KEY,
    JSON.stringify(chats)
  );

  localStorage.setItem(
    ACTIVE_CHAT_KEY,
    activeChatId || ""
  );
}

/*
  ==========================================
  SINCRONIZAÇÃO DAS CONVERSAS (servidor)
  ==========================================
  O servidor guarda a lista por conta e cada conversa tem uma `rev`.
  Gravação baseada em rev antiga é recusada (409): o outro aparelho
  chegou primeiro — a versão dele fica e as nossas mensagens novas
  entram depois dela.
*/

let chatsPushTimer = null;

function mergeChatMessages(localMessages, serverMessages) {
  let common = 0;
  const max = Math.min(localMessages.length, serverMessages.length);

  while (
    common < max &&
    localMessages[common].role === serverMessages[common].role &&
    localMessages[common].content === serverMessages[common].content
  ) {
    common += 1;
  }

  /*
    Mensagem local que já está no servidor não entra de novo — o envio
    pode ter funcionado sem a resposta chegar de volta.
  */
  const serverIds = new Set();

  serverMessages.forEach(function (message) {
    if (message && typeof message.id === "string" && message.id) {
      serverIds.add(message.id);
    }
  });

  const extra = localMessages
    .slice(common)
    .filter(function (message) {
      return !(
        message &&
        typeof message.id === "string" &&
        message.id &&
        serverIds.has(message.id)
      );
    });

  return serverMessages.concat(extra);
}

function applyChatContent(local, source) {
  local.title = source.title;
  local.updatedAt = source.updatedAt;
  local.messages = source.messages;
  local.rev = source.rev || 0;
}

async function pushChat(chat, attempt) {
  const body = {
    chat: {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messages: chat.messages
    },
    base_rev: chat.rev || 0
  };

  try {
    const data = await api(
      "PUT",
      "/api/chats/" + encodeURIComponent(chat.id),
      body
    );

    chat.rev = Number(data.rev) || chat.rev || 0;
    chat.dirty = false;
    saveChats();
  } catch (error) {
    const serverChat = error.data && error.data.chat;

    if (error.status === 409 && serverChat && attempt < 2) {
      chat.messages = mergeChatMessages(
        chat.messages,
        serverChat.messages || []
      );
      chat.rev = Number(serverChat.rev) || 0;

      if (typeof serverChat.title === "string" && serverChat.title) {
        chat.title = serverChat.title;
      }

      chat.updatedAt = Date.now();

      if (chat.id === activeChatId && !sendButton.disabled) {
        history.length = 0;
        history.push(...chat.messages);
        renderChat();
      }

      return pushChat(chat, attempt + 1);
    }

    if (error.status === 410) {
      /* Apagada em outro aparelho: some daqui também. */
      deleteChat(chat.id);
      return;
    }

    /* Sem rede: fica "dirty" e tenta de novo depois. */
  }
}

async function pushDirtyChats() {
  const pending = chats.filter(chat => chat.dirty);

  for (const chat of pending) {
    await pushChat(chat, 1);
  }
}

function scheduleChatsPush() {
  if (chatsPushTimer) {
    return;
  }

  chatsPushTimer = setTimeout(function () {
    chatsPushTimer = null;
    pushDirtyChats().catch(function () {});
  }, CHATS_PUSH_DELAY_MS);
}

/* Puxa do servidor e aplica o que houver de novo (e envia o pendente). */
async function syncChatsFromServer() {
  if (!messageKey) {
    return;
  }

  const data = await api("GET", "/api/chats");
  const serverChats = Array.isArray(data.chats) ? data.chats : [];
  const onServer = new Set(serverChats.map(item => item.id));
  const activeBefore = activeChatId;
  let activeTouched = false;

  /*
    Conversa que estava no servidor e sumiu foi apagada em outro
    aparelho. Conversa local nova (rev 0) ou com envio pendente fica.
  */
  chats = chats.filter(function (chat) {
    if (chat.dirty || onServer.has(chat.id) || !(chat.rev > 0)) {
      return true;
    }

    if (chat.id === activeBefore) {
      activeTouched = true;
    }

    return false;
  });

  serverChats.forEach(function (item) {
    const incoming = normalizeChat(item);

    if (!incoming) {
      return;
    }

    const local = findChat(incoming.id);

    if (!local) {
      chats.push(incoming);
      return;
    }

    if (local.dirty || incoming.rev < local.rev) {
      return;
    }

    if (
      incoming.rev !== local.rev ||
      incoming.updatedAt !== local.updatedAt ||
      incoming.messages.length !== local.messages.length
    ) {
      applyChatContent(local, incoming);

      if (local.id === activeBefore) {
        activeTouched = true;
      }
    }
  });

  /* Conversa local que nunca foi ao servidor entra na fila de envio. */
  chats.forEach(function (chat) {
    if (!chat.dirty && !(chat.rev > 0) && chat.messages.length) {
      chat.dirty = true;
    }
  });

  if (!findChat(activeChatId)) {
    if (chats.length === 0) {
      chats.push(makeChat());
    }

    activeChatId = chats[0].id;
    activeTouched = true;
  }

  if (activeTouched) {
    const chat = currentChat();

    history.length = 0;

    if (chat) {
      history.push(...chat.messages);
    }

    renderChat();
  }

  saveChats();
  renderChatList();

  pushDirtyChats().catch(function () {});
}

/* Esvazia `history` dentro do chat aberto e grava. */
function saveMemory() {
  const chat = currentChat();

  if (!chat) {
    return;
  }

  chat.messages = history.slice();
  // Só atualiza o título se for o padrão "Nova conversa" ou se foi gerado automaticamente da primeira mensagem
  // Não sobrescreve títulos gerados pela IA
  const isDefaultTitle = chat.title === "Nova conversa" || chat.title === chatTitle(chat.messages);
  if (isDefaultTitle) {
    chat.title = chatTitle(chat.messages);
  }
  chat.updatedAt = Date.now();
  chat.dirty = true;

  saveChats();
  renderChatList();
  scheduleChatsPush();
}

function loadChats() {
  try {
    const saved = localStorage.getItem(CHATS_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed)) {
        chats = parsed
          .map(normalizeChat)
          .filter(Boolean);
      }
    }

  } catch (error) {
    console.error(
      "Erro ao carregar conversas:",
      error
    );
  }

  /*
    Primeira execução depois da migração: a conversa antiga
    morava sozinha em nexa_conversation.
  */

  if (chats.length === 0) {
    const legacy =
      localStorage.getItem(MEMORY_KEY);

    if (legacy) {
      try {
        const messages = cleanMessages(
          JSON.parse(legacy)
        );

        if (messages.length > 0) {
          chats.push({
            id: makeId(),
            title: chatTitle(messages),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages
          });
        }

        localStorage.removeItem(MEMORY_KEY);

      } catch (error) {
        console.error(
          "Erro ao migrar conversa antiga:",
          error
        );
      }
    }
  }

  /*
    Conversa em branco é só uma: se sobraram várias (o botão Nova
    conversa criava uma por clique), mantém só a que estava aberta.
  */
  const blankActive = localStorage.getItem(ACTIVE_CHAT_KEY) || "";
  let blankKept = false;

  chats = chats.filter(function (chat) {
    if (chat.messages.length > 0) {
      return true;
    }

    if (blankKept) {
      return false;
    }

    if (blankActive && chat.id !== blankActive) {
      return false;
    }

    blankKept = true;
    return true;
  });

  if (chats.length === 0) {
    chats.push(makeChat());
  }

  const saved = localStorage.getItem(
    ACTIVE_CHAT_KEY
  );

  activeChatId = findChat(saved)
    ? saved
    : chats[0].id;

  const chat = currentChat();

  history.length = 0;
  history.push(...chat.messages);

  saveChats();
}

/*
  ==========================================
  MENSAGENS
  ==========================================
*/

/* Instância do markdown-it para renderizar markdown nas respostas da NEXA */
const md = window.markdownit
  ? window.markdownit({
      html: true,
      linkify: true,
      typographer: true,
      highlight: function (str, lang) {
        if (lang && window.hljs && window.hljs.getLanguage(lang)) {
          try {
            return (
              '<pre class="hljs"><code>' +
              window.hljs.highlight(str, { language: lang, ignoreIllicits: true }).value +
              "</code></pre>"
            );
          } catch (__) {}
        }
        return (
          '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + "</code></pre>"
        );
      },
    })
  : null;

/* Carrega highlight.js para syntax highlighting nos blocos de código */
(function loadHighlightJS() {
  if (window.hljs) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/atom-one-dark.min.css";
  document.head.appendChild(link);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/highlight.min.js";
  script.onload = () => window.hljs.highlightAll();
  document.head.appendChild(script);
})();

function addMessage(text, type, thinkingText, memoryUpdated) {
  const message = document.createElement("div");
  message.className = "message " + type;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = type === "user" ? "VOCÊ" : "NEXA";

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";

  if (type !== "user" && md) {
    // Renderiza markdown para mensagens da NEXA
    contentDiv.innerHTML = md.render(text);
  } else {
    // Mensagens do usuário: texto puro (escapa HTML)
    const p = document.createElement("p");
    p.textContent = text;
    contentDiv.appendChild(p);
  }

  message.appendChild(label);

  if (type !== "user") {
    const thinking = createThinkingBlock();
    thinking.setContent(thinkingText || "");
    message.appendChild(thinking.button);
    message.appendChild(thinking.panel);

    const memoryNotice = createMemoryNotice();
    memoryNotice.restore(memoryUpdated === true);
    message.appendChild(memoryNotice.element);
  }

  message.appendChild(contentDiv);
  chat.appendChild(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });
}

/*
  ==========================================
  INDICADOR DE DIGITAÇÃO
  ==========================================
*/

function showTyping() {
  if (
    document.getElementById(
      "nexaTyping"
    )
  ) {
    return;
  }

  const message =
    document.createElement("div");

  message.className =
    "message nexa typing-message";

  message.id =
    "nexaTyping";

  const label =
    document.createElement("span");

  label.className = "label";
  label.textContent = "NEXA";

  const typing =
    document.createElement("p");

  typing.className = "typing";

  typing.innerHTML = `
    <span></span>
    <span></span>
    <span></span>
  `;

  message.appendChild(label);
  message.appendChild(typing);

  chat.appendChild(message);

  message.scrollIntoView({
    behavior: "smooth",
    block: "end"
  });
}

function hideTyping() {
  const typing =
    document.getElementById(
      "nexaTyping"
    );

  if (typing) {
    typing.remove();
  }
}

/*
  ==========================================
  PENSAMENTO (POR MENSAGEM)
  ==========================================
*/

/*
  O painel de pensamento é criado junto de cada
  resposta da NEXA, então o estado vive no próprio
  elemento em vez de uma variável global.
*/

/*
  ==========================================
  AVISOS DE FERRAMENTA
  ==========================================
*/

const NOTICE_ITEMS = {
  memory: {
    className: "memory-notice",
    icon: "✦",
    text: "Memória atualizada com o que você me contou."
  },
  search: {
    className: "search-notice",
    icon: "⌕",
    text: "Pesquisei na web para responder."
  }
};

function createNotice(kind) {
  const config =
    NOTICE_ITEMS[kind];

  const notice =
    document.createElement("p");

  notice.className = config.className;
  notice.hidden = true;

  const icon =
    document.createElement("span");

  icon.className = config.className + "-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = config.icon;

  const text =
    document.createElement("span");

  text.className = config.className + "-text";
  text.textContent = config.text;

  notice.appendChild(icon);
  notice.appendChild(text);

  let shown = false;

  return {
    element: notice,

    show() {
      if (shown) {
        return;
      }

      shown = true;
      notice.hidden = false;
    },

    restore(wasShown) {
      if (wasShown) {
        shown = true;
        notice.hidden = false;
      }
    }
  };
}

function createMemoryNotice() {
  return createNotice("memory");
}

function createSearchNotice() {
  return createNotice("search");
}

function createThinkingBlock() {
  const button =
    document.createElement("button");

  button.type = "button";
  button.className = "thinking-toggle";
  button.setAttribute("aria-expanded", "false");

  const dot =
    document.createElement("span");

  dot.className = "thinking-dot";
  dot.setAttribute("aria-hidden", "true");

  const label =
    document.createElement("span");

  label.className = "thinking-toggle-text";
  label.textContent = "Pensamento";

  const caret =
    document.createElement("span");

  caret.className = "thinking-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = "▾";

  button.appendChild(dot);
  button.appendChild(label);
  button.appendChild(caret);

  const panel =
    document.createElement("div");

  panel.className = "thinking-panel";
  panel.hidden = true;

  const text =
    document.createElement("p");

  text.className = "thinking-text";

  panel.appendChild(text);

  let content = "";
  let open = false;

  function render(state) {
    text.textContent = content;

    button.classList.toggle(
      "has-thinking",
      content.length > 0
    );

    button.classList.toggle(
      "is-thinking",
      state === "thinking"
    );

    button.setAttribute(
      "aria-expanded",
      open ? "true" : "false"
    );

    panel.hidden = !open;
  }

  button.addEventListener(
    "click",
    function (event) {
      event.stopPropagation();

      open = !open;
      render();
    }
  );

  render("idle");

  return {
    button,
    panel,

    append(chunk) {
      content += chunk;
      render("thinking");
    },

    done() {
      render("done");
    },

    setContent(value) {
      content = typeof value === "string"
        ? value
        : "";

      render("done");
    },
  };
}


/*
  ==========================================
  MENSAGEM STREAMING
  ==========================================
*/

function createStreamingMessage() {
  const message = document.createElement("div");
  message.className = "message nexa";

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "NEXA";

  const contentDiv = document.createElement("div");
  contentDiv.className = "message-content";

  const thinking = createThinkingBlock();
  const memoryNotice = createMemoryNotice();

  message.appendChild(label);
  message.appendChild(thinking.button);
  message.appendChild(thinking.panel);
  message.appendChild(contentDiv);
  message.appendChild(memoryNotice.element);

  chat.appendChild(message);
  message.scrollIntoView({ behavior: "smooth", block: "end" });

  let fullText = "";

  function appendText(chunk) {
    fullText += chunk;
    // Durante o streaming, mostra texto puro para performance
    contentDiv.textContent = fullText;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }

  function flushText() {
    // No final, renderiza markdown completo
    if (md && fullText.trim()) {
      contentDiv.innerHTML = md.render(fullText);
    }
  }

  return {
    message,
    appendText,
    flushText,
    thinking,
    memoryNotice
  };
}

/*
  ==========================================
  STREAMING DA NEXA
  ==========================================
*/

async function askNexa(text) {
  const response =
    await fetch("/api/chat", {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",
        "X-Nexa-Message-Key": messageKey
      },

      body: JSON.stringify({
        message: text,

        history:
          history.slice(-12),

        reasoning: reasoningLevel,
        memoryEnabled,
        customInstructions
      })
    });

  /*
    Se o servidor responder com
    JSON de erro antes do streaming.
  */

  if (response.status === 401) {
    showAuth();
    throw new Error(
      "Sua sessão expirou. Entre de novo."
    );
  }

  if (!response.ok) {
    let data = null;

    try {
      data =
        await response.json();
    } catch {
      // Resposta não era JSON.
    }

    throw new Error(
      data?.error ||
      `Erro na API (HTTP ${response.status}).`
    );
  }

  if (!response.body) {
    throw new Error(
      "O navegador não conseguiu iniciar o streaming."
    );
  }

  /*
    Cria a mensagem vazia da NEXA.
  */

  hideTyping();

  const {
    appendText,
    flushText,
    thinking,
    memoryNotice,
    searchNotice
  } = createStreamingMessage();

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let fullReply = "";
  let fullThinking = "";
  let finished = false;
  let memoryUpdated = false;
  let searched = false;

  /*
    Processa um evento SSE.
  */

  function processEvent(event) {
    const lines =
      event.split(/\r?\n/);

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const dataText =
        line.slice(5).trim();

      if (!dataText) {
        continue;
      }

      let data;

      try {
        data =
          JSON.parse(dataText);
      } catch {
        continue;
      }

      /*
        Pedaço normal da resposta.
      */

      if (
        data.type === "text" &&
        typeof data.text === "string"
      ) {
        fullReply += data.text;
        appendText(data.text);
      }

      /*
        Raciocínio do modelo, exibido
        no painel de pensamento.
      */

      if (
        data.type === "reasoning" &&
        typeof data.text === "string"
      ) {
        fullThinking += data.text;

        thinking.append(data.text);
      }

      /*
        A memória foi reescrita pela
        ferramenta chamada pelo modelo.
      */

      if (data.type === "memory") {
        memoryUpdated = true;
        memoryNotice.show();
      }

      /*
        O modelo consultou a web
        antes de responder.
      */

      if (data.type === "search") {
        searched = true;
        thinking.append("\n\n🔍 **Pesquisa na web**");
      }

      /*
        A memória foi atualizada.
      */

      if (data.type === "memory") {
        memoryUpdated = true;
        thinking.append("\n\n💾 **Memória atualizada**");
      }

      /*
        Streaming terminou.
      */

      if (
        data.type === "done"
      ) {
        finished = true;

        thinking.done();
      }

      /*
        O backend encontrou um erro
        durante o streaming.
      */

      if (
        data.type === "error"
      ) {
        throw new Error(
          data.error ||
          "Erro durante a resposta da NEXA."
        );
      }
    }
  }

  /*
    Lê o stream até terminar. O painel
    fecha o estado "pensando" mesmo
    se o stream quebrar no meio.
  */

  try {
    while (true) {
      const {
        value,
        done
      } = await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true
          }
        );

      /*
        Eventos SSE são separados
        por uma linha vazia.
      */

      const events =
        buffer.split(/\r?\n\r?\n/);

      buffer =
        events.pop() || "";

      for (const event of events) {
        processEvent(event);
      }
    }

    /*
      Processa qualquer resto do buffer.
    */

    if (buffer.trim()) {
      processEvent(buffer);
    }
  } finally {
    flushText();
    thinking.done();
  }

  if (!fullReply.trim()) {
    /*
      Acontece quando o modelo só pediu ferramenta e a
      continuação não trouxe texto. Aviso claro, sem
      quebrar a página.
    */

    throw new Error(
      memoryUpdated || searched
        ? "A NEXA usou uma ferramenta, mas não respondeu. Tente de novo."
        : "A NEXA não retornou nenhum texto."
    );
  }

  /*
    Salva a conversa somente depois
    que a resposta terminou.
  */

  history.push({
    role: "user",
    content: text,
    id: makeMessageId()
  });

  history.push({
    role: "model",
    content: fullReply,
    id: makeMessageId(),
    thinking: fullThinking,
    memoryUpdated,
    searched
  });

  saveMemory();

  return {
    reply: fullReply,
    finished
  };
}

/*
  ==========================================
  NAVEGAÇÃO ENTRE CONVERSAS
  ==========================================
*/

/* Joga o que está em `history` de volta no chat que estava aberto. */
function stashCurrent() {
  const chat = currentChat();

  if (!chat) {
    return;
  }

  chat.messages = history.slice();
  const fallbackTitle = chatTitle(chat.messages);
  if (chat.title === "Nova conversa" || chat.title === fallbackTitle) {
    chat.title = fallbackTitle;
  }
  chat.updatedAt = Date.now();
}

function renderChat() {
  if (history.length === 0) {
    chat.innerHTML = "";
  } else {
    restoreConversation();
  }

  if (feed) {
    feed.scrollTop = feed.scrollHeight;
  }
}

function startNewChat() {
  const current = currentChat();

  /* Já está numa conversa em branco: não cria outra. */
  if (current && current.messages.length === 0) {
    closeDrawer();
    input.value = "";
    input.focus();
    return;
  }

  /*
    Se sobrou uma conversa em branco (criada antes de recarregar),
    usa ela em vez de empilhar outra.
  */
  const blank = chats.find(
    chat => chat.id !== activeChatId && chat.messages.length === 0
  );

  if (blank) {
    openChat(blank.id);
    return;
  }

  stashCurrent();

  const fresh = makeChat();

  chats.unshift(fresh);
  activeChatId = fresh.id;
  history.length = 0;

  hideTyping();
  saveChats();
  renderChat();
  renderChatList();
  closeDrawer();

  input.value = "";
  input.focus();
}

function openChat(id) {
  if (id === activeChatId) {
    closeDrawer();
    input.focus();
    return;
  }

  const target = findChat(id);

  if (!target) {
    return;
  }

  stashCurrent();

  activeChatId = target.id;
  history.length = 0;
  history.push(...target.messages);

  hideTyping();
  saveChats();
  renderChat();
  renderChatList();
  closeDrawer();

  syncChatsFromServer().catch(function () {});

  input.value = "";
  input.focus();
}

function deleteChat(id) {
  const index = chats.findIndex(
    item => item.id === id
  );

  if (index === -1) {
    return;
  }

  const wasActive = chats[index].id === activeChatId;

  chats.splice(index, 1);

  if (wasActive) {
    if (chats.length === 0) {
      const fresh = makeChat();

      chats.push(fresh);
      activeChatId = fresh.id;
      history.length = 0;
    } else {
      /*
        Chat removido era o aberto: entra o que ficou
        logo depois dele, ou o último da lista.
      */

      const next =
        chats[
          Math.min(index, chats.length - 1)
        ];

      activeChatId = next.id;
      history.length = 0;
      history.push(...next.messages);
    }

    renderChat();
  }

  api(
    "DELETE",
    "/api/chats/" + encodeURIComponent(id)
  ).catch(function () {});

  saveChats();
  renderChatList();
}


/*
  ==========================================
  LISTA DE CHATS ANTERIORES
  ==========================================
*/

function renderChatList() {
  if (!drawerChats) {
    return;
  }

  drawerChats.innerHTML = "";

  if (chats.length === 0) {
    const empty = document.createElement("p");

    empty.className = "drawer-empty";
    empty.textContent =
      "Nenhuma conversa ainda.";

    drawerChats.appendChild(empty);

    return;
  }

  const ordered = chats
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);

  ordered.forEach(chat => {
    const row = document.createElement("div");

    row.className =
      "drawer-chat" +
      (chat.id === activeChatId
        ? " is-active"
        : "");

    row.dataset.id = chat.id;

    const open = document.createElement("button");

    open.type = "button";
    open.className = "drawer-chat-open";

    const title = document.createElement("span");

    title.className = "drawer-chat-title";
    title.textContent = chat.title;
    title.title = chat.title;

    const when = document.createElement("span");

    when.className = "drawer-chat-when";
    when.textContent = formatWhen(
      chat.updatedAt
    );

    open.append(title, when);
    open.addEventListener(
      "click",
      () => openChat(chat.id)
    );

    const remove = document.createElement("button");

    remove.type = "button";
    remove.className = "drawer-chat-delete";
    remove.setAttribute(
      "aria-label",
      "Apagar conversa: " + chat.title
    );

    remove.textContent = "✕";

    remove.addEventListener(
      "click",
      () => deleteChat(chat.id)
    );

    row.append(open, remove);
    drawerChats.appendChild(row);
  });
}


/*
  ==========================================
  GESTOS NA TELA
  ==========================================
  Puxar para a direita abre a gaveta; para a esquerda abre a
  chamada; para cima, já no fim da conversa, cria outra.
*/

(function () {
  const SIDE_MIN = 70;
  const PULL_MIN = 90;
  const PULL_ZONE = 0.6;

  const pullBall = document.getElementById("pullBall");

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let pullTracking = false;

  function setPullProgress(progress) {
    if (!pullBall) {
      return;
    }

    pullBall.hidden = false;
    pullBall.style.opacity = String(0.35 + 0.65 * progress);
    pullBall.style.transform =
      "scale(" + (0.55 + 0.45 * progress) + ")";
    pullBall.classList.toggle("ready", progress >= 1);
  }

  function resetPull() {
    pullTracking = false;

    if (pullBall) {
      pullBall.classList.remove("ready");
      pullBall.hidden = true;
    }
  }

  function atConversationEnd() {
    return (
      feed.scrollTop + feed.clientHeight >=
      feed.scrollHeight - 4
    );
  }

  document.addEventListener(
    "touchstart",
    function (event) {
      const target = event.target;

      if (
        event.touches.length !== 1 ||
        (target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT"))
      ) {
        tracking = false;
        pullTracking = false;
        return;
      }

      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;

      pullTracking =
        authPanel.hidden &&
        !drawerOpen &&
        !sendButton.disabled &&
        startY >= window.innerHeight * PULL_ZONE &&
        atConversationEnd();
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    function (event) {
      if (!pullTracking || event.touches.length !== 1) {
        return;
      }

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (-dy <= 0 || -dy < 2 * Math.abs(dx)) {
        return;
      }

      setPullProgress(
        Math.min(1, -dy / PULL_MIN)
      );
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    function (event) {
      if (!tracking) {
        resetPull();
        return;
      }

      tracking = false;

      const touch =
        event.changedTouches &&
        event.changedTouches[0];

      if (!touch || !authPanel.hidden) {
        resetPull();
        return;
      }

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (
        Math.abs(dx) >= SIDE_MIN &&
        Math.abs(dx) >= 2 * Math.abs(dy)
      ) {
        resetPull();

        if (dx > 0) {
          if (!drawerOpen) {
            openDrawer();
          }
        } else if (drawerOpen) {
          closeDrawer();
        } else {
          window.location.href = "/live.html";
        }

        return;
      }

      /* Para cima só vale no fim da conversa, puxando pela parte de baixo. */
      const pulled =
        pullTracking &&
        -dy >= PULL_MIN &&
        -dy >= 2 * Math.abs(dx) &&
        atConversationEnd();

      resetPull();

      if (pulled) {
        startNewChat();
      }
    },
    { passive: true }
  );
})();

/*
  ==========================================
  GAVETA E CONFIGURAÇÕES
  ==========================================
*/

function openDrawer() {
  if (drawerOpen) {
    return;
  }

  drawerOpen = true;
  app.classList.add("drawer-open");
  drawerScrim.hidden = false;

  drawerToggle.setAttribute(
    "aria-expanded",
    "true"
  );

  drawerToggle.setAttribute(
    "aria-label",
    "Fechar menu"
  );

  renderChatList();
  drawerClose.focus();
}

function closeDrawer() {
  if (!drawerOpen) {
    return;
  }

  drawerOpen = false;
  app.classList.remove("drawer-open");
  drawerScrim.hidden = true;

  drawerToggle.setAttribute(
    "aria-expanded",
    "false"
  );

  drawerToggle.setAttribute(
    "aria-label",
    "Abrir menu"
  );
}

function accountSettingKey(prefix) {
  return prefix + (currentUser ? currentUser.username : "anonymous");
}

function loadAccountSettings(user) {
  try {
    memoryEnabled = localStorage.getItem(
      MEMORY_ENABLED_KEY + user.username
    ) !== "false";
    customInstructions = localStorage.getItem(
      INSTRUCTIONS_KEY + user.username
    ) || "";
  } catch (error) {
    memoryEnabled = true;
    customInstructions = "";
  }

  memoryToggle.checked = memoryEnabled;
  customInstructionsInput.value = customInstructions;
}

let liveVoices = [];
let liveVoiceSaved = "Kore";

function loadLiveVoicePreference() {
  try {
    return localStorage.getItem(LIVE_VOICE_KEY) || "";
  } catch {
    return "";
  }
}

function saveLiveVoicePreference(voice) {
  try {
    localStorage.setItem(LIVE_VOICE_KEY, voice);
  } catch (error) {
    console.error("Erro ao salvar a voz da chamada:", error);
  }
}

function applyLiveVoiceSelection() {
  const saved = loadLiveVoicePreference();
  liveVoiceSaved = liveVoices.includes(saved) ? saved : liveVoices[0] || "Kore";

  liveVoiceSelect.replaceChildren();

  liveVoices.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    liveVoiceSelect.appendChild(option);
  });

  liveVoiceSelect.value = liveVoiceSaved;
}

async function loadLiveSettings() {
  liveVoiceStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/live/voices");
    liveVoices = Array.isArray(data.voices) ? data.voices : [];
    applyLiveVoiceSelection();

    if (!data.enabled) {
      liveVoiceSelect.disabled = true;
      liveVoiceStatus.textContent = "API_GEMA não configurada no servidor.";
      return;
    }

    liveVoiceSelect.disabled = false;
    liveVoiceStatus.textContent = "";
  } catch (error) {
    console.error("Erro ao carregar as vozes:", error);
    liveVoices = [];
    applyLiveVoiceSelection();
    liveVoiceSelect.disabled = true;
    liveVoiceStatus.textContent = "Não foi possível carregar as vozes.";
  }
}

liveVoiceSelect.addEventListener("change", function () {
  liveVoiceSaved = liveVoiceSelect.value;
  saveLiveVoicePreference(liveVoiceSaved);
});

liveCallOpenButton.addEventListener("click", function () {
  window.location.assign("/live.html");
});

function showSettingsView(viewName) {
  const titles = {
    home: "Configurações",
    live: "Chamada",
    memory: "Memória",
    instructions: "Instruções",
    reminders: "Lembretes",
    more: "Mais"
  };

  settingsHome.hidden = viewName !== "home";
  Object.entries(settingsViews).forEach(([name, view]) => {
    view.hidden = name !== viewName;
  });
  settingsTitle.textContent = titles[viewName] || titles.home;

  if (viewName === "live") {
    loadLiveSettings();
  } else if (viewName === "memory") {
    loadMemories();
  } else if (viewName === "instructions") {
    customInstructionsInput.value = customInstructions;
    loadSystemPrompt();
  } else if (viewName === "reminders") {
    loadServerReminders();
  }
}

async function loadSystemPrompt() {
  systemPromptStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/system-prompt");
    systemPromptInput.value = data.prompt || "";
    systemPromptStatus.textContent = data.is_custom
      ? ""
      : "Usando o prompt padrão do sistema.";
  } catch (error) {
    systemPromptStatus.textContent = error.message;
  }
}

async function loadMemories() {
  memoryList.replaceChildren();
  memoryStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/memories");
    memoryList.replaceChildren();

    const memoryDocument = data.memories[0]?.memory || "";
    const limit = data.limit || 10000;

    if (!memoryDocument) {
      const empty = document.createElement("p");
      empty.className = "settings-status";
      empty.textContent = "Nenhuma memória salva ainda.";
      memoryList.appendChild(empty);
      memoryStatus.textContent = "";
      return;
    }

    const row = document.createElement("div");
    row.className = "settings-item settings-item-stack";

    const copy = document.createElement("div");
    copy.className = "settings-item-copy";

    const heading = document.createElement("strong");
    heading.textContent = "Documento de memória";
    copy.appendChild(heading);

    const editor = document.createElement("textarea");
    editor.className = "settings-field";
    editor.setAttribute("aria-label", "Memória da NEXA");
    editor.value = memoryDocument;
    copy.appendChild(editor);

    const date = document.createElement("small");
    date.textContent = data.memories[0].created_at || "";
    copy.appendChild(date);

    const actions = document.createElement("div");
    actions.className = "settings-more-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "settings-action";
    save.textContent = "Salvar documento";

    save.addEventListener("click", async function () {
      save.disabled = true;
      try {
        await api("PUT", "/api/memories", { document: editor.value });
        await loadMemories();
        memoryStatus.textContent = "Documento de memória salvo.";
      } catch (error) {
        memoryStatus.textContent = error.message;
      } finally {
        save.disabled = false;
      }
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "settings-danger";
    remove.textContent = "Apagar memória";

    remove.addEventListener("click", async function () {
      if (!confirm("Apagar a memória desta conta?")) {
        return;
      }
      try {
        await api("DELETE", "/api/memories");
        await loadMemories();
        memoryStatus.textContent = "Memória apagada.";
      } catch (error) {
        memoryStatus.textContent = error.message;
      }
    });

    actions.append(save, remove);
    row.append(copy, actions);
    memoryList.appendChild(row);

    const used = memoryDocument.length;
    memoryStatus.textContent =
      `${used} de ${limit} caracteres usados.`;
  } catch (error) {
    memoryStatus.textContent = error.message;
  }
}

const REMINDER_POLL_MS = 30000;
const REMINDER_CURSOR_PREFIX = "nexa_reminder_cursor";
let reminderPollTimer = null;
let pushToken = "";

async function loadServerReminders() {
  reminderList.replaceChildren();
  reminderStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/reminders");
    renderReminderList(data.reminders || []);
    reminderStatus.textContent = "";
    updatePushStatus();
  } catch (error) {
    reminderStatus.textContent = error.message;
  }
}

/*
  Diagnóstico do push FCM: mostra se o servidor tem chave e google-auth
  e quantos aparelhos registrados — assim dá para saber por que a
  notificação do app não chegou.
*/
async function updatePushStatus() {
  if (!pushStatusLine) {
    return;
  }

  pushStatusLine.textContent = "";

  try {
    const data = await api("GET", "/api/push-status");
    const parts = [];

    if (!data.key_file) {
      parts.push("Servidor sem a chave do Firebase — push desligado.");
    } else if (!data.google_auth) {
      parts.push("Servidor sem a biblioteca google-auth — push desligado.");
    }

    if (data.tokens > 0) {
      parts.push(
        "Push ativo: " + data.tokens +
        (data.tokens === 1
          ? " aparelho registrado."
          : " aparelhos registrados.")
      );
    } else {
      parts.push(
        "Nenhum aparelho registrado para push — abra o app logado para registrar."
      );
    }

    pushStatusLine.textContent = parts.join(" ");
  } catch (error) {
    // Servidor antigo (sem o endpoint) ou sessão fora: deixa em branco.
  }
}

function renderReminderList(items) {
  reminderList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "settings-status";
    empty.textContent = "Nenhum lembrete programado.";
    reminderList.appendChild(empty);
    return;
  }

  items.forEach(reminder => {
    const row = document.createElement("div");
    row.className = "settings-item";

    const copy = document.createElement("div");
    copy.className = "settings-item-copy";
    copy.textContent = reminder.tarefa;

    const when = document.createElement("small");
    const date = new Date((reminder.next_at || 0) * 1000)
      .toLocaleString("pt-BR");
    when.textContent = reminder.tipo === "unico"
      ? `Uma vez: ${date}`
      : `${reminder.descricao} • próximo: ${date}`;
    copy.appendChild(when);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "settings-item-delete";
    remove.textContent = "Apagar";
    remove.addEventListener("click", async function () {
      remove.disabled = true;
      try {
        await api("DELETE", `/api/reminders/${reminder.id}`);
        await loadServerReminders();
        reminderStatus.textContent = "Lembrete apagado.";
      } catch (error) {
        reminderStatus.textContent = error.message;
        remove.disabled = false;
      }
    });

    row.append(copy, remove);
    reminderList.appendChild(row);
  });
}

async function pollDueReminders() {
  if (!currentUser || !messageKey) {
    return;
  }

  const cursorKey = REMINDER_CURSOR_PREFIX + ":" + currentUser.username;
  const cursor = parseInt(localStorage.getItem(cursorKey), 10) || 0;

  try {
    const data = await api("GET", `/api/reminders/due?since=${cursor}`);

    (data.due || []).forEach(function (item) {
      if (!item || !item.message) {
        return;
      }

      addMessage(item.message, "nexa", "", false);

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Lembrete da NEXA", { body: item.message });
        } catch (error) {
          // Navegador móvel pode recusar Notification direto; a mensagem
          // no chat já apareceu.
        }
      }
    });

    // Só avança depois de mostrar tudo: no pior caso, repete uma vez.
    if (typeof data.cursor === "number" && data.cursor > cursor) {
      localStorage.setItem(cursorKey, String(data.cursor));
    }
  } catch (error) {
    // Servidor ou sessão fora do ar: tenta de novo no próximo ciclo.
  }
}

function startReminderPolling() {
  if (reminderPollTimer) {
    return;
  }

  pollDueReminders();
  reminderPollTimer = setInterval(pollDueReminders, REMINDER_POLL_MS);
}

/*
  Token do FCM: o app manda o token pelo evento nativeFcmToken (ou expõe em
  window.NexaNative) e o servidor usa para enviar os lembretes por push.
*/
function syncPushToken() {
  if (!pushToken || !currentUser || !messageKey) {
    return;
  }

  api("POST", "/api/push-token", { token: pushToken }).catch(function () {
    // Sem rede: o token é enviado de novo no próximo login.
  });
}

window.addEventListener("nativeFcmToken", function (event) {
  const detail = event.detail || {};

  if (typeof detail.token === "string" && detail.token) {
    pushToken = detail.token;
    syncPushToken();
  }
});

if (window.NexaNative && typeof window.NexaNative.getFcmToken === "function") {
  try {
    pushToken = window.NexaNative.getFcmToken() || "";
  } catch (error) {
    pushToken = "";
  }
}

function openSettings() {
  showSettingsView("home");
  closeDrawer();
  settingsPanel.hidden = false;
  settingsClose.focus();
}

function closeSettings() {
  settingsPanel.hidden = true;
  showSettingsView("home");
  drawerSettings.focus();
}

/*
  ==========================================
  GERAÇÃO DE TÍTULO PELA IA
  ==========================================
*/

async function generateChatTitle(message) {
  try {
    const response = await fetch("/api/chat/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey
      },
      body: JSON.stringify({ message })
    });

    if (response.ok) {
      const data = await response.json();
      return data.title;
    }
  } catch (error) {
    console.error("Erro ao gerar título:", error);
  }
  return null;
}

/*
  ==========================================
  ENVIO DA MENSAGEM
  ==========================================
*/

composer.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    const text =
      input.value.trim();

    if (
      !text ||
      sendButton.disabled
    ) {
      return;
    }

    sendButton.disabled = true;
    micButton.disabled = true;
    newChatButton.disabled = true;
    drawerNewChat.disabled = true;

    /*
      Antes de enviar, puxa o que houver de novo: se outro aparelho
      mexeu na conversa, a tela é atualizada antes do prompt entrar.
    */
    try {
      await syncChatsFromServer();
    } catch (error) {
      // Servidor fora do ar: envia com o histórico local mesmo.
    }

    /*
      Verifica se é a primeira mensagem do chat (histórico vazio antes de adicionar)
    */
    const isFirstMessage = history.length === 0;
    const titleChatId = isFirstMessage
      ? activeChatId
      : null;

    /*
      Mostra a mensagem do usuário.
    */

    addMessage(
      text,
      "user"
    );

    input.value = "";

    /*
      Indicador enquanto o primeiro
      pedaço da resposta ainda não chegou.
    */

    showTyping();

    try {
      await askNexa(text);

      /* 
        Se foi a primeira mensagem, gera título pela IA
      */
      if (isFirstMessage) {
        const aiTitle = await generateChatTitle(text);
        if (aiTitle) {
          const chat = findChat(titleChatId);
          if (chat) {
            chat.title = aiTitle;
            chat.updatedAt = Date.now();
            chat.dirty = true;
            saveChats();
            renderChatList();
            scheduleChatsPush();
          }
        }
      }

    } catch (error) {
      console.error(
        "NEXA error:",
        error
      );

      hideTyping();

      addMessage(
        "Erro ao conectar com a NEXA: " +
        (
          error?.message ||
          "erro desconhecido"
        ),
        "nexa",
        "",
        false
      );

    } finally {
      sendButton.disabled = false;
      micButton.disabled = false;
      newChatButton.disabled = false;
      drawerNewChat.disabled = false;

      input.focus();
    }
  }
);

/*
  ==========================================
  NOVA CONVERSA
  ==========================================
*/

newChatButton.addEventListener(
  "click",
  startNewChat
);

drawerNewChat.addEventListener(
  "click",
  startNewChat
);


/*
  ==========================================
  GAVETA E CONFIGURAÇÕES
  ==========================================
*/

drawerToggle.addEventListener(
  "click",
  function () {
    if (drawerOpen) {
      closeDrawer();
      drawerToggle.focus();
      return;
    }

    openDrawer();
  }
);

drawerClose.addEventListener(
  "click",
  function () {
    closeDrawer();
    drawerToggle.focus();
  }
);

drawerScrim.addEventListener(
  "click",
  function () {
    closeDrawer();
    drawerToggle.focus();
  }
);

drawerSettings.addEventListener(
  "click",
  openSettings
);

settingsClose.addEventListener(
  "click",
  closeSettings
);

document.querySelectorAll("[data-settings-open]").forEach(button => {
  button.addEventListener("click", function () {
    showSettingsView(button.dataset.settingsOpen);
  });
});

document.querySelectorAll("[data-settings-back]").forEach(button => {
  button.addEventListener("click", function () {
    showSettingsView("home");
  });
});

memoryToggle.addEventListener("change", function () {
  memoryEnabled = memoryToggle.checked;
  try {
    localStorage.setItem(
      MEMORY_ENABLED_KEY + currentUser.username,
      String(memoryEnabled)
    );
    memoryStatus.textContent = memoryEnabled
      ? "As memórias serão usadas e novas lembranças poderão ser salvas."
      : "Memórias não serão usadas nem novas lembranças serão salvas.";
  } catch (error) {
    memoryStatus.textContent = "Não foi possível salvar essa preferência.";
  }
});

document.getElementById("memoryRefresh").addEventListener("click", loadMemories);

document.getElementById("saveInstructions").addEventListener("click", function () {
  customInstructions = customInstructionsInput.value.trim().slice(0, 2000);
  customInstructionsInput.value = customInstructions;

  try {
    localStorage.setItem(
      INSTRUCTIONS_KEY + currentUser.username,
      customInstructions
    );
    instructionStatus.textContent = "Instruções salvas.";
  } catch (error) {
    instructionStatus.textContent = "Não foi possível salvar as instruções.";
  }
});

document.getElementById("saveSystemPrompt").addEventListener("click", async function () {
  const button = document.getElementById("saveSystemPrompt");
  button.disabled = true;

  try {
    const data = await api(
      "PUT",
      "/api/system-prompt",
      { prompt: systemPromptInput.value.slice(0, 20000) }
    );
    systemPromptInput.value = data.prompt || systemPromptInput.value;
    systemPromptStatus.textContent = "System prompt salvo.";
  } catch (error) {
    systemPromptStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("resetSystemPrompt").addEventListener("click", async function () {
  if (!confirm("Restaurar o system prompt padrão do sistema?")) {
    return;
  }

  try {
    const data = await api("DELETE", "/api/system-prompt");
    systemPromptInput.value = data.prompt || "";
    systemPromptStatus.textContent = "System prompt restaurado ao padrão.";
  } catch (error) {
    systemPromptStatus.textContent = error.message;
  }
});

reminderNotificationButton.addEventListener("click", async function () {
  if (!("Notification" in window)) {
    reminderStatus.textContent = "Este navegador não oferece notificações.";
    return;
  }

  const permission = await Notification.requestPermission();
  reminderStatus.textContent = permission === "granted"
    ? "Notificações ativadas."
    : "Permissão de notificação não concedida.";
});

document.getElementById("exportChats").addEventListener("click", function () {
  const file = new Blob(
    [JSON.stringify({ exportedAt: new Date().toISOString(), chats }, null, 2)],
    { type: "application/json" }
  );
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nexa-conversas.json";
  link.click();
  URL.revokeObjectURL(url);
});

document.getElementById("clearChats").addEventListener("click", async function () {
  if (!confirm("Apagar todas as conversas deste usuário neste navegador?")) {
    return;
  }

  try {
    await api("DELETE", "/api/chats");
  } catch (error) {
    window.alert("Não deu para apagar no servidor: " + error.message);
    return;
  }

  chats = [];
  history.length = 0;
  activeChatId = "";
  startNewChat();
  settingsPanel.hidden = true;
  input.focus();
});

liveCallButton.addEventListener("click", function () {
  window.location.assign("/live.html");
});

settingsPanel.addEventListener(
  "click",
  function (event) {
    if (event.target === settingsPanel) {
      closeSettings();
    }
  }
);

document.addEventListener(
  "keydown",
  function (event) {
    if (event.key !== "Escape") {
      return;
    }

    if (!settingsPanel.hidden) {
      closeSettings();
      return;
    }

    if (drawerOpen) {
      closeDrawer();
      drawerToggle.focus();
    }
  }
);

/*
  ==========================================
  TECLADO NATIVO (APP ANDROID/APK)
  O app dispara "nativeKeyboardChange" no window quando o teclado
  abre/fecha; ao abrir, mantém o fim da conversa visível. A classe
  .keyboard-open e a variável --keyboard-height usadas no CSS são
  injetadas pelo próprio app no <html>.
  ==========================================
*/

window.addEventListener(
  "nativeKeyboardChange",
  function (event) {
    const detail = event.detail || {};

    if (detail.visible) {
      feed.scrollTop = feed.scrollHeight;
    }
  }
);

/*
  ==========================================
  MICROFONE
  ==========================================
*/

micButton.addEventListener(
  "click",
  function () {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      addMessage(
        "Seu navegador não disponibilizou reconhecimento de voz nesta versão.",
        "nexa",
        "",
        false
      );

      return;
    }

    const recognition =
      new SpeechRecognition();

    recognition.lang =
      "pt-BR";

    recognition.interimResults =
      false;

    recognition.onstart =
      function () {
        micButton.textContent =
          "●";

        micButton.disabled =
          true;
      };

    recognition.onresult =
      function (event) {
        input.value =
          event.results[0][0]
            .transcript;

        input.focus();
      };

    recognition.onerror =
      function () {
        addMessage(
          "Não consegui entender o áudio. Tente falar novamente.",
          "nexa",
          "",
          false
        );
      };

    recognition.onend =
      function () {
        micButton.textContent =
          "◉";

        micButton.disabled =
          false;
      };

    recognition.start();
  }
);

/*
  ==========================================
  RESTAURAÇÃO
  ==========================================
*/

function restoreConversation() {
  if (history.length === 0) {
    return;
  }

  chat.innerHTML = "";

  history.forEach(item => {
    addMessage(
      item.content,
      item.role === "user"
        ? "user"
        : "nexa",
      item.thinking,
      item.memoryUpdated
    );
  });
}

function bootApp() {
  loadChats();
  renderChat();
  renderChatList();
  loadReasoning();
  setupReasoningUI();
  renderReasoning();
}

/*
  ==========================================
  VERSÃO
  ==========================================
*/

async function loadVersion() {
  try {
    const response =
      await fetch("/api/version");

    if (!response.ok) {
      return;
    }

    const data =
      await response.json();

    const versionElement =
      document.getElementById("nexaVersion");

    if (
      versionElement &&
      data &&
      data.version
    ) {
      versionElement.textContent =
        data.version;
    }

  } catch (error) {
    console.error(
      "Erro ao carregar versão:",
      error
    );
  }
}

loadVersion();

/*
  ==========================================
  LOGIN E PAINEL ADMIN
  As conversas ficam no navegador, separadas por conta
  (nexa_chats:<usuário>). O app só inicia depois do login.
  ==========================================
*/

const authPanel = document.getElementById("authPanel");
const authError = document.getElementById("authError");
const loginForm = document.getElementById("loginForm");
const drawerEmail = document.getElementById("drawerEmail");
const drawerLogout = document.getElementById("drawerLogout");
const drawerAdmin = document.getElementById("drawerAdmin");
const adminPanel = document.getElementById("adminPanel");
const adminUsers = document.getElementById("adminUsers");
const adminForm = document.getElementById("adminForm");
const adminError = document.getElementById("adminError");

let currentUser = null;
let appStarted = false;
let messageKey = "";
let memoryEnabled = true;
let customInstructions = "";

function showMessage(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}

function showAuth() {
  adminPanel.hidden = true;
  authPanel.hidden = false;
  showMessage(authError, "");
  document.getElementById("loginUser").focus();
}

async function api(method, path, payload) {
  const headers = { "Content-Type": "application/json" };
  if (messageKey) {
    headers["X-Nexa-Message-Key"] = messageKey;
  }

  const response = await fetch(path, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    // Resposta sem JSON.
  }

  if (!response.ok) {
    const error = new Error(
      data.error || `Erro (HTTP ${response.status}).`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

function enterApp(user, issuedMessageKey) {
  currentUser = user;

  const messageKeyStorageKey =
    MESSAGE_KEY_STORAGE_PREFIX + user.username;

  if (typeof issuedMessageKey === "string" && issuedMessageKey.length === 64) {
    messageKey = issuedMessageKey;
    localStorage.setItem(messageKeyStorageKey, messageKey);
  } else {
    messageKey = localStorage.getItem(messageKeyStorageKey) || "";
  }

  if (!messageKey) {
    showAuth();
    return;
  }

  const suffix = ":" + user.username;
  const legacyChats = localStorage.getItem("nexa_chats");

  CHATS_KEY = "nexa_chats" + suffix;
  ACTIVE_CHAT_KEY = "nexa_active_chat" + suffix;
  loadAccountSettings(user);

  /*
    Conversas de antes do login: a primeira conta que entra
    neste navegador herda elas, e a chave antiga é removida.
  */
  if (
    legacyChats &&
    localStorage.getItem(CHATS_KEY) === null
  ) {
    localStorage.setItem(CHATS_KEY, legacyChats);

    const legacyActive =
      localStorage.getItem("nexa_active_chat");

    if (legacyActive) {
      localStorage.setItem(ACTIVE_CHAT_KEY, legacyActive);
    }

    localStorage.removeItem("nexa_chats");
    localStorage.removeItem("nexa_active_chat");
  }

  authPanel.hidden = true;
  drawerEmail.textContent = user.username;
  drawerEmail.title = user.username;
  drawerAdmin.hidden = !user.isAdmin;

  if (!appStarted) {
    appStarted = true;
    bootApp();
  }

  startReminderPolling();
  syncPushToken();
  syncChatsFromServer().catch(function () {});
}

loginForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  const button = loginForm.querySelector("[type=submit]");

  showMessage(authError, "");
  button.disabled = true;

  try {
    const data = await api("POST", "/api/auth/login", {
      username: document.getElementById("loginUser").value,
      password: document.getElementById("loginPassword").value
    });

    loginForm.reset();
    enterApp(data.user, data.messageKey);

  } catch (error) {
    showMessage(authError, error.message);

  } finally {
    button.disabled = false;
  }
});

drawerLogout.addEventListener("click", async function () {
  try {
    await api("POST", "/api/auth/logout");
  } catch {
    // Sem rede: recarregar já cai no login se o cookie expirar.
  }

  if (currentUser) {
    localStorage.removeItem(
      MESSAGE_KEY_STORAGE_PREFIX + currentUser.username
    );
  }
  messageKey = "";

  location.reload();
});

/* ---------- Painel admin ---------- */

async function loadAdminUsers() {
  showMessage(adminError, "");

  try {
    const data = await api("GET", "/api/admin/users");

    adminUsers.innerHTML = "";

    data.users.forEach(function (user) {
      const row = document.createElement("div");
      row.className = "admin-user";

      const name = document.createElement("span");
      name.className = "admin-user-name";
      name.textContent = user.username;
      row.appendChild(name);

      if (user.isAdmin) {
        const badge = document.createElement("span");
        badge.className = "admin-badge";
        badge.textContent = "admin";
        row.appendChild(badge);
      }

      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "Nova senha";
      reset.addEventListener("click", function () {
        const password = prompt(
          `Nova senha para ${user.username} (mín. 8):`
        );

        if (password) {
          adminAction(
            "POST",
            `/api/admin/users/${user.id}/password`,
            { password }
          );
        }
      });
      row.appendChild(reset);

      if (user.username !== currentUser.username) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "admin-del";
        remove.textContent = "Apagar";
        remove.addEventListener("click", function () {
          if (confirm(`Apagar o usuário ${user.username}?`)) {
            adminAction(
              "DELETE",
              `/api/admin/users/${user.id}`
            );
          }
        });
        row.appendChild(remove);
      }

      adminUsers.appendChild(row);
    });

  } catch (error) {
    showMessage(adminError, error.message);
  }
}

async function adminAction(method, path, payload) {
  try {
    await api(method, path, payload);
    await loadAdminUsers();

  } catch (error) {
    showMessage(adminError, error.message);
  }
}

drawerAdmin.addEventListener("click", function () {
  closeDrawer();
  adminPanel.hidden = false;
  loadAdminUsers();
});

document.getElementById("adminClose").addEventListener(
  "click",
  function () {
    adminPanel.hidden = true;
  }
);

adminForm.addEventListener("submit", async function (event) {
  event.preventDefault();

  try {
    await api("POST", "/api/admin/users", {
      username: document.getElementById("adminNewUser").value,
      password: document.getElementById("adminNewPassword").value,
      isAdmin: document.getElementById("adminNewIsAdmin").checked
    });

    adminForm.reset();
    await loadAdminUsers();

  } catch (error) {
    showMessage(adminError, error.message);
  }
});

/* ---------- Gerenciamento do Servidor (admin) ---------- */

const serverStatusValue = document.getElementById("serverStatusValue");
const serverStatusPid = document.getElementById("serverStatusPid");
const serverStatusUptime = document.getElementById("serverStatusUptime");
const serverActionStatus = document.getElementById("serverActionStatus");
const serverForceCheck = document.getElementById("serverForceCheck");

async function loadServerStatus() {
  try {
    const data = await api("GET", "/api/admin/server/status");
    updateServerStatusUI(data);
  } catch (error) {
    serverStatusValue.textContent = "Erro";
    serverActionStatus.textContent = error.message;
  }
}

function updateServerStatusUI(data) {
  if (data.running) {
    serverStatusValue.textContent = "Rodando";
    serverStatusValue.className = "server-status-value running";
    serverStatusPid.textContent = `PID: ${data.pid}`;
    if (data.uptime_seconds) {
      const h = Math.floor(data.uptime_seconds / 3600);
      const m = Math.floor((data.uptime_seconds % 3600) / 60);
      const s = Math.floor(data.uptime_seconds % 60);
      serverStatusUptime.textContent = `Uptime: ${h}h ${m}m ${s}s`;
    }
  } else {
    serverStatusValue.textContent = "Parado";
    serverStatusValue.className = "server-status-value stopped";
    serverStatusPid.textContent = "";
    serverStatusUptime.textContent = "";
  }
}

async function serverAction(action) {
  const force = serverForceCheck?.checked || false;
  const btnMap = {
    start: document.getElementById("serverStartBtn"),
    stop: document.getElementById("serverStopBtn"),
    restart: document.getElementById("serverRestartBtn"),
  };

  Object.values(btnMap).forEach(b => b && (b.disabled = true));
  serverActionStatus.textContent = "";

  try {
    const data = await api("POST", `/api/admin/server/${action}`, { force });
    if (data.ok) {
      serverActionStatus.textContent = `Servidor ${action === "start" ? "iniciado" : action === "stop" ? "parado" : "reiniciado"}${data.pid ? ` (PID: ${data.pid})` : ""}.`;
      serverActionStatus.style.color = "var(--ok-color, #4ade80)";
    } else {
      serverActionStatus.textContent = data.error || "Erro desconhecido";
      serverActionStatus.style.color = "var(--err-color, #f87171)";
    }
  } catch (error) {
    serverActionStatus.textContent = error.message;
    serverActionStatus.style.color = "var(--err-color, #f87171)";
  }

  Object.values(btnMap).forEach(b => b && (b.disabled = false));
  await loadServerStatus();
}

document.getElementById("serverStartBtn")?.addEventListener("click", () => serverAction("start"));
document.getElementById("serverStopBtn")?.addEventListener("click", () => serverAction("stop"));
document.getElementById("serverRestartBtn")?.addEventListener("click", () => serverAction("restart"));

// Carrega status do servidor ao abrir painel admin
const originalLoadAdminUsers = loadAdminUsers;
loadAdminUsers = async function () {
  await originalLoadAdminUsers();
  await loadServerStatus();
};

async function initAuth() {
  try {
    const response = await fetch("/api/auth/me");

    if (response.ok) {
      const data = await response.json();
      enterApp(data.user);
      return;
    }
  } catch (error) {
    console.error("Erro ao verificar login:", error);
  }

  showAuth();
}

initAuth();
