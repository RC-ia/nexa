const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const chat = document.getElementById("chat");

/* A conversa rola dentro de .feed; o composer fica fixo no rodapé. */
const feed = document.querySelector(".feed");

const micButton = document.getElementById("micButton");
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

const MEMORY_KEY = "nexa_conversation";
const CHATS_KEY = "nexa_chats";
const ACTIVE_CHAT_KEY = "nexa_active_chat";
const USER_ID_KEY = "nexa_user_id";
const REASONING_KEY = "nexa_reasoning";

const REASONING_LABELS = {
  none: "Nenhum",
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
  VOZ DA NEXA
  ==========================================
*/

let speechEnabled = true;
let selectedVoice = null;

function loadNexaVoice() {
  if (!("speechSynthesis" in window)) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();

  if (!voices.length) {
    return;
  }

  selectedVoice =
    voices.find(
      voice =>
        voice.lang &&
        voice.lang.toLowerCase() === "pt-br"
    ) ||
    voices.find(
      voice =>
        voice.lang &&
        voice.lang.toLowerCase().startsWith("pt")
    ) ||
    null;
}

function speakNexa(text) {
  if (
    !speechEnabled ||
    !("speechSynthesis" in window) ||
    !text
  ) {
    return;
  }

  window.speechSynthesis.cancel();

  const cleanText = text
    .replace(/[*_`#]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  if (!cleanText) {
    return;
  }

  const utterance =
    new SpeechSynthesisUtterance(cleanText);

  utterance.lang = "pt-BR";

  if (selectedVoice) {
    utterance.voice = selectedVoice;
  }

  utterance.rate = 1.02;
  utterance.pitch = 1;
  utterance.volume = 1;

  window.speechSynthesis.speak(utterance);
}

if ("speechSynthesis" in window) {
  loadNexaVoice();

  window.speechSynthesis.onvoiceschanged =
    loadNexaVoice;
}


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
      "Nenhum";
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
  ID PERMANENTE
  ==========================================
*/

function getUserId() {
  let userId =
    localStorage.getItem(USER_ID_KEY);

  if (!userId) {
    userId =
      "user_" +
      crypto.randomUUID();

    localStorage.setItem(
      USER_ID_KEY,
      userId
    );
  }

  return userId;
}

const userId = getUserId();

/*
  ==========================================
  MEMÓRIA LOCAL DAS CONVERSAS
  `history` continua sendo a conversa aberta; `chats` guarda
  todas. A primeira versão guardava uma conversa só em
  nexa_conversation, e a migração abaixo traz ela para cá.
  ==========================================
*/

const WELCOME_HTML = `
  <div class="message nexa">
    <span class="label">NEXA</span>
    <p>E aí. Sou a NEXA. Já tô online — manda a boa.</p>
  </div>
`;

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
      thinking: item.thinking
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
    messages: []
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

/* Esvazia `history` dentro do chat aberto e grava. */
function saveMemory() {
  const chat = currentChat();

  if (!chat) {
    return;
  }

  chat.messages = history.slice();
  chat.title = chatTitle(chat.messages);
  chat.updatedAt = Date.now();

  saveChats();
  renderChatList();
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

function addMessage(text, type, thinkingText) {
  const message =
    document.createElement("div");

  message.className =
    "message " + type;

  const label =
    document.createElement("span");

  label.className = "label";

  label.textContent =
    type === "user"
      ? "VOCÊ"
      : "NEXA";

  const paragraph =
    document.createElement("p");

  paragraph.textContent = text;

  message.appendChild(label);

  /*
    Mensagens da NEXA ganham um
    botão de pensamento próprio.
  */

  if (type !== "user") {
    const thinking =
      createThinkingBlock();

    thinking.setContent(
      thinkingText || ""
    );

    message.appendChild(thinking.button);
    message.appendChild(thinking.panel);
  }

  message.appendChild(paragraph);

  chat.appendChild(message);

  message.scrollIntoView({
    behavior: "smooth",
    block: "end"
  });
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
  const message =
    document.createElement("div");

  message.className =
    "message nexa";

  const label =
    document.createElement("span");

  label.className = "label";
  label.textContent = "NEXA";

  const paragraph =
    document.createElement("p");

  paragraph.textContent = "";

  const thinking =
    createThinkingBlock();

  message.appendChild(label);
  message.appendChild(thinking.button);
  message.appendChild(thinking.panel);
  message.appendChild(paragraph);

  chat.appendChild(message);

  message.scrollIntoView({
    behavior: "smooth",
    block: "end"
  });

  return {
    message,
    paragraph,
    thinking
  };
}

function updateStreamingMessage(
  paragraph,
  text
) {
  paragraph.textContent = text;

  /*
    Mantém a resposta visível
    enquanto ela é recebida.
  */

  if (feed) {
    feed.scrollTop = feed.scrollHeight;
  }
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
          "application/json"
      },

      body: JSON.stringify({
        message: text,

        history:
          history.slice(-12),

        userId,

        reasoning: reasoningLevel
      })
    });

  /*
    Se o servidor responder com
    JSON de erro antes do streaming.
  */

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
    paragraph,
    thinking
  } = createStreamingMessage();

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let fullReply = "";
  let fullThinking = "";
  let finished = false;

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

        updateStreamingMessage(
          paragraph,
          fullReply
        );
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
    thinking.done();
  }

  if (!fullReply.trim()) {
    throw new Error(
      "A NEXA não retornou nenhum texto."
    );
  }

  /*
    Salva a conversa somente depois
    que a resposta terminou.
  */

  history.push({
    role: "user",
    content: text
  });

  history.push({
    role: "model",
    content: fullReply,
    thinking: fullThinking
  });

  saveMemory();

  /*
    A voz só começa depois que
    todo o streaming terminou.
  */

  speakNexa(fullReply);

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
  chat.title = chatTitle(chat.messages);
  chat.updatedAt = Date.now();
}

function stopSpeaking() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function renderChat() {
  if (history.length === 0) {
    chat.innerHTML = WELCOME_HTML;
  } else {
    restoreConversation();
  }

  if (feed) {
    feed.scrollTop = feed.scrollHeight;
  }
}

function startNewChat() {
  stashCurrent();
  stopSpeaking();

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
  stopSpeaking();

  activeChatId = target.id;
  history.length = 0;
  history.push(...target.messages);

  hideTyping();
  saveChats();
  renderChat();
  renderChatList();
  closeDrawer();

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

    stopSpeaking();
    renderChat();
  }

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

function openSettings() {
  closeDrawer();
  settingsPanel.hidden = false;
  settingsClose.focus();
}

function closeSettings() {
  settingsPanel.hidden = true;
  drawerSettings.focus();
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

    /*
      Para qualquer fala anterior.
    */

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    /*
      Mostra a mensagem do usuário.
    */

    addMessage(
      text,
      "user"
    );

    input.value = "";

    sendButton.disabled = true;
    micButton.disabled = true;
    newChatButton.disabled = true;
    drawerNewChat.disabled = true;

    /*
      Indicador enquanto o primeiro
      pedaço da resposta ainda não chegou.
    */

    showTyping();

    try {
      await askNexa(text);

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
        "nexa"
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
        "nexa"
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
          "nexa"
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
      item.thinking
    );
  });
}

loadChats();
renderChat();
renderChatList();
loadReasoning();
setupReasoningUI();
renderReasoning();

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
