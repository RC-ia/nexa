const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const chat = document.getElementById("chat");

/* A conversa rola dentro de .feed; o composer fica fixo no rodapé. */
const feed = document.querySelector(".feed");
let scheduledFeedScroll = false;

function scrollConversationToBottom() {
  if (!feed) {
    return;
  }

  feed.scrollTop = feed.scrollHeight;

  // O conteúdo pode ganhar altura depois da atualização do DOM (markdown,
  // fontes ou quebra de linha). Reaplica a posição no próximo frame.
  if (scheduledFeedScroll) {
    return;
  }

  scheduledFeedScroll = true;
  requestAnimationFrame(() => {
    scheduledFeedScroll = false;
    feed.scrollTop = feed.scrollHeight;
    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  });
}

const micButton = document.getElementById("micButton");
const liveCallButton = document.getElementById("liveCallButton");
const sendButton = document.getElementById("sendButton");

let abortController = null;

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
  agent: document.getElementById("settingsAgent"),
  agentThinking: document.getElementById("settingsAgentThinking"),
  agentDeep: document.getElementById("settingsAgentDeep"),
  agentVision: document.getElementById("settingsAgentVision"),
  agentIntent: document.getElementById("settingsAgentIntent"),
  agentImagePrompt: document.getElementById("settingsAgentImagePrompt"),
  agentSpicy: document.getElementById("settingsAgentSpicy"),
  agentReminders: document.getElementById("settingsAgentReminders"),
  time: document.getElementById("settingsTime"),
  listen: document.getElementById("settingsListen"),
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
const DEEP_MODE_KEY = "nexa_deep_mode:";
const SPICY_MODE_KEY = "nexa_spicy_mode:";
const DRAWER_KEY = "nexa_drawer";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "json", "xml", "html", "htm",
  "css", "js", "ts", "jsx", "tsx", "py", "java", "c", "h", "cpp",
  "hpp", "cs", "go", "rs", "php", "rb", "sql", "yaml", "yml", "toml",
  "ini", "log"
]);
let pendingImage = null;
let pendingFile = null;
const imageCache = new Map();

const REASONING_ALIASES = {
  xhigh: "ultra",
  min: "minimum",
  max: "maximum",
};

const REASONING_LABELS = {
  none: "Rápido",
  minimum: "Mínimo",
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  veryhigh: "Muito alto",
  maximum: "Máximo",
  ultra: "Ultra",
};

/* Quantidade de barras acesas no medidor, por nível. */
const REASONING_LEVELS = {
  none: 0,
  minimum: 1,
  low: 2,
  medium: 3,
  high: 4,
  veryhigh: 5,
  maximum: 6,
  ultra: 7,
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

    const normalized = REASONING_ALIASES[saved] || saved;
    if (
      normalized &&
      REASONING_LABELS.hasOwnProperty(normalized)
    ) {
      reasoningLevel = normalized;
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
  BOTÃO "+" DO COMPOSER
  Menu com as opções de anexo (ainda desativadas) e a pesquisa
  profunda, que manda a pergunta direto para o pesquisador da NEXA.
  ==========================================
*/

let deepMode = false;

function renderDeepMode() {
  const button =
    document.getElementById("attachButton");
  const option =
    document.getElementById("attachDeep");
  const input =
    document.getElementById("messageInput");

  if (button) {
    button.classList.toggle("active", deepMode);

    button.setAttribute(
      "aria-pressed",
      deepMode ? "true" : "false"
    );
  }

  if (option) {
    option.classList.toggle("active", deepMode);

    option.setAttribute(
      "aria-checked",
      deepMode ? "true" : "false"
    );
  }

  if (input) {
    input.placeholder = deepMode
      ? "Descreva o tema da pesquisa profunda..."
      : "Digite uma mensagem...";
  }
}

function deepModeStorageKey() {
  return DEEP_MODE_KEY + (currentUser ? currentUser.id : "anonymous");
}

function loadDeepMode() {
  try {
    deepMode = localStorage.getItem(deepModeStorageKey()) === "true";
  } catch (error) {
    deepMode = false;
  }
}

function saveDeepMode() {
  try {
    localStorage.setItem(deepModeStorageKey(), deepMode ? "true" : "false");
  } catch (error) {
    console.error("Erro ao salvar o modo de pesquisa profunda:", error);
  }
}

function setDeepMode(isOn) {
  deepMode = isOn === true;
  saveDeepMode();
  renderDeepMode();
}

/*
  ==========================================
  MODO SAFADINHO
  Toggle ao lado do enviar: pinta o site de
  vermelho-sangue (classe .spicy no body, com
  transição no CSS) e segue junto na requisição
  do chat como flag `spicy`.
  ==========================================
*/

let spicyMode = false;

function spicyModeStorageKey() {
  return SPICY_MODE_KEY + (currentUser ? currentUser.id : "anonymous");
}

function loadSpicyMode() {
  try {
    spicyMode = localStorage.getItem(spicyModeStorageKey()) === "true";
  } catch (error) {
    spicyMode = false;
  }
}

function saveSpicyMode() {
  try {
    localStorage.setItem(spicyModeStorageKey(), spicyMode ? "true" : "false");
  } catch (error) {
    console.error("Erro ao salvar o modo safadinho:", error);
  }
}

function renderSpicyMode() {
  /*
    O safadinho pertence só ao modo imagem (agente de prompt de imagem):
    o tema vermelho-sangue entra apenas quando a aba de imagens está
    ativa — no chat normal o site segue no tom normal.
  */
  document.body.classList.toggle(
    "spicy",
    spicyMode === true && viewMode === "image"
  );

  const button = document.getElementById("imageSpicyButton");

  if (button) {
    button.classList.toggle("active", spicyMode === true);
    button.setAttribute("aria-pressed", spicyMode ? "true" : "false");
  }
}

function setSpicyMode(isOn) {
  spicyMode = isOn === true;
  saveSpicyMode();
  renderSpicyMode();
}

const imageSpicyButton = document.getElementById("imageSpicyButton");

if (imageSpicyButton) {
  imageSpicyButton.addEventListener("click", () => setSpicyMode(!spicyMode));
}

/*
  Modo Criar imagem: o texto do composer vira o prompt
  da Novita AI e o resultado entra no chat como markdown.
*/

let imageMode = false;

function renderImageMode() {
  const option =
    document.getElementById("attachGen");
  const input =
    document.getElementById("messageInput");

  if (option) {
    option.classList.toggle("active", imageMode);

    option.setAttribute(
      "aria-checked",
      imageMode ? "true" : "false"
    );
  }

  if (input && !pendingImage && !pendingFile) {
    input.placeholder = imageMode
      ? "Descreva a imagem que a NEXA deve criar..."
      : deepMode
        ? "Descreva o tema da pesquisa profunda..."
        : "Digite uma mensagem...";
  }
}

function setImageMode(isOn) {
  imageMode = isOn === true;
  renderImageMode();
}

function renderImagePreview() {
  const preview = document.getElementById("imagePreview");
  const image = document.getElementById("imagePreviewImage");
  const name = document.getElementById("imagePreviewName");
  if (!preview || !image || !name) return;

  if (!pendingImage) {
    preview.hidden = true;
    image.removeAttribute("src");
    name.textContent = "";
    input.placeholder = deepMode
      ? "Descreva o tema da pesquisa profunda..."
      : "Digite uma mensagem...";
    return;
  }

  image.src = pendingImage.dataUrl;
  name.textContent = pendingImage.name;
  preview.hidden = false;
  input.placeholder = `Imagem anexada: ${pendingImage.name}`;
}

function clearAttachment() {
  pendingImage = null;
  pendingFile = null;
  renderImagePreview();
  renderFilePreview();
}

function renderFilePreview() {
  const preview = document.getElementById("filePreview");
  const name = document.getElementById("filePreviewName");
  if (!preview || !name) return;
  preview.hidden = !pendingFile;
  name.textContent = pendingFile ? pendingFile.name : "";
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const extension = file?.name?.split(".").pop()?.toLowerCase() || "";
    if (!file || !ALLOWED_FILE_EXTENSIONS.has(extension)) {
      reject(new Error("Tipo de arquivo não permitido. Executáveis não são aceitos."));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("O arquivo deve ter no máximo 2 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type || "text/plain",
      text: String(reader.result || "")
    });
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file);
  });
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Selecione uma imagem válida."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error("A imagem deve ter no máximo 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type,
      dataUrl: String(reader.result || "")
    });
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function setupAttachUI() {
  const button =
    document.getElementById("attachButton");
  const menu =
    document.getElementById("attachMenu");
  const imageInput = document.getElementById("imageInput");
  const fileInput = document.getElementById("fileInput");

  if (!button || !menu) {
    return;
  }

  function setOpen(isOpen) {
    menu.classList.toggle("open", isOpen);

    button.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );
  }

  button.addEventListener(
    "click",
    function () {
      setOpen(
        !menu.classList.contains("open")
      );
    }
  );

  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      try {
        pendingImage = await readImage(imageInput.files?.[0]);
        pendingFile = null;
        renderImagePreview();
        renderFilePreview();
      } catch (error) {
        pendingImage = null;
        renderImagePreview();
        alert(error.message);
      } finally {
        imageInput.value = "";
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      try {
        pendingFile = await readTextFile(fileInput.files?.[0]);
        pendingImage = null;
        renderFilePreview();
        renderImagePreview();
        input.placeholder = `Arquivo anexado: ${pendingFile.name}`;
      } catch (error) {
        pendingFile = null;
        renderFilePreview();
        alert(error.message);
      } finally {
        fileInput.value = "";
      }
    });
  }

  const removeFileButton = document.getElementById("filePreviewRemove");
  if (removeFileButton) {
    removeFileButton.addEventListener("click", () => {
      clearAttachment();
      input.focus();
    });
  }

  async function acceptDroppedFile(file) {
    if (!file) return;
    try {
      if (file.type.startsWith("image/")) {
        pendingImage = await readImage(file);
        pendingFile = null;
        renderImagePreview();
        renderFilePreview();
      } else {
        pendingFile = await readTextFile(file);
        pendingImage = null;
        renderFilePreview();
        renderImagePreview();
        input.placeholder = `Arquivo anexado: ${pendingFile.name}`;
      }
    } catch (error) {
      clearAttachment();
      alert(error.message);
    }
  }

  [document].forEach(target => {
    if (!target) return;
    target.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      document.body.classList.add("file-drag-over");
    });
    target.addEventListener("dragleave", event => {
      if (!event.relatedTarget || !target.contains(event.relatedTarget)) {
        document.body.classList.remove("file-drag-over");
      }
    });
    target.addEventListener("drop", event => {
      event.preventDefault();
      document.body.classList.remove("file-drag-over");
      acceptDroppedFile(event.dataTransfer.files?.[0]);
    });
  });

  document.addEventListener("dragend", () => {
    document.body.classList.remove("file-drag-over");
  });

  const removeImageButton = document.getElementById("imagePreviewRemove");
  if (removeImageButton) {
    removeImageButton.addEventListener("click", () => {
      clearAttachment();
      input.focus();
    });
  }

  menu.addEventListener(
    "click",
    function (event) {
      const item =
        event.target.closest(".reasoning-item");

      if (!item || item.disabled) {
        return;
      }

      if (item.id === "attachDeep") {
        setDeepMode(!deepMode);
      } else if (item.id === "attachGen") {
        setImageMode(!imageMode);
      } else if (item.id === "attachImage" && imageInput) {
        imageInput.click();
      } else if (item.id === "attachFile" && fileInput) {
        fileInput.click();
      }

      setOpen(false);

      const input =
        document.getElementById("messageInput");

      if (input) {
        input.focus();
      }
    }
  );

  /*
    Na fase de captura o clique fecha o menu mesmo quando outro
    botão interrompe a propagação do evento.
  */
  document.addEventListener(
    "click",
    function (event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("#attachWrap")
      ) {
        return;
      }

      setOpen(false);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape") {
        setOpen(false);
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
      searched: item.searched === true,
      image: item.image && typeof item.image.dataUrl === "string"
        ? {
            name: typeof item.image.name === "string" ? item.image.name : "Imagem",
            mimeType: typeof item.image.mimeType === "string" ? item.image.mimeType : "image/*",
            dataUrl: item.image.dataUrl
          }
        : null,
      file: item.file && typeof item.file.text === "string"
        ? {
            name: typeof item.file.name === "string" ? item.file.name : "Arquivo",
            mimeType: typeof item.file.mimeType === "string" ? item.file.mimeType : "text/plain",
            text: item.file.text
          }
        : null
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
      html: false,
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

if (md) {
  const renderImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const token = tokens[index];
    const source = token.attrGet("src") || "";
    if (!source.startsWith("/generated/")) {
      const alt = md.utils.escapeHtml(token.content || "conteúdo visual");
      return `<span>Imagem omitida fora do modo Criar imagem: ${alt}</span>`;
    }
    return renderImage(tokens, index, options, env, renderer);
  };
}

/* Carrega highlight.js para syntax highlighting nos blocos de código */
(function loadHighlightJS() {
  if (window.hljs) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/styles/atom-one-dark.min.css";
  document.head.appendChild(link);
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js";
  script.onload = () => window.hljs.highlightAll();
  document.head.appendChild(script);
})();

function attachMessageActions(message, contentDiv, messageId) {
  const actions = document.createElement("div");
  actions.className = "message-actions";

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "message-action retry";
  retryBtn.title = "Tentar novamente";
  retryBtn.setAttribute("aria-label", "Tentar novamente esta resposta");
  retryBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 1 20.49 15"></path></svg>`;
  retryBtn.addEventListener("click", () => retryFromMessage(messageId));

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "message-action copy";
  copyBtn.title = "Copiar mensagem";
  copyBtn.setAttribute("aria-label", "Copiar conteúdo da mensagem");
  copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a9 9 0 0 1 2 2v1"></path></svg>`;
  copyBtn.addEventListener("click", () => copyMessageContent(contentDiv));

  actions.append(retryBtn, copyBtn);
  message.appendChild(actions);
}

function addMessage(text, type, thinkingText, memoryUpdated, messageId, image, file) {
  const message = document.createElement("div");
  message.className = "message " + type;
  if (messageId) message.dataset.messageId = messageId;

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

  if (type === "user" && file?.name) {
    const fileElement = document.createElement("div");
    fileElement.className = "message-file";
    fileElement.textContent = `📄 ${file.name}`;
    message.appendChild(fileElement);
  }

  if (type === "user" && image?.dataUrl) {
    const imageElement = document.createElement("img");
    imageElement.className = "message-image";
    imageElement.src = image.dataUrl;
    imageElement.alt = image.name || "Imagem enviada";
    message.appendChild(imageElement);
  }

  if (type !== "user") {
    attachMessageActions(message, contentDiv, messageId);
  }
  chat.appendChild(message);
  scrollConversationToBottom();
  renderWelcomeState();
}

/*
  ==========================================
  INDICADOR DE DIGITAÇÃO
  ==========================================
*/

function retryFromMessage(messageId) {
  if (!messageId) return;

  const index = history.findIndex(item => item.id === messageId);
  if (index === -1) return;

  const userIndex = index - 1;
  if (userIndex < 0 || history[userIndex].role !== "user") return;

  const userMessage = history[userIndex].content;
  const userImage = history[userIndex].image || null;
  const userFile = history[userIndex].file || null;

  history.splice(userIndex);
  saveMemory();

  renderChat();

  const userMsgId = makeMessageId();

  history.push({
    role: "user",
    content: userMessage,
    id: userMsgId,
    image: userImage,
    file: userFile
  });

  addMessage(userMessage, "user", "", false, userMsgId, userImage, userFile);

  showTyping();
  setGenerating(true);

  askNexa(userMessage, deepMode, userImage, userFile).catch(error => {
    if (error.name === "AbortError") {
      hideTyping();
      return;
    }
    console.error("NEXA error:", error);
    hideTyping();
    addMessage(
      "Erro ao conectar com a NEXA: " +
      (error?.message || "erro desconhecido"),
      "nexa",
      "",
      false
    );
    notifyNativeVoice(error?.message || "erro desconhecido", true);
  }).finally(() => {
    setGenerating(false);
    input.focus();
  });
}

function copyMessageContent(contentDiv) {
  const text = contentDiv.textContent || contentDiv.innerText;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.createElement("div");
      toast.className = "copy-toast";
      toast.textContent = "Copiado";
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 1500);
    });
  }
}

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
  scrollConversationToBottom();
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
    scrollConversationToBottom();
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

    expand() {
      open = true;
      render("thinking");
    },

    collapse() {
      open = false;
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
  scrollConversationToBottom();

  let fullText = "";

  function appendText(chunk) {
    fullText += chunk;
    // Durante o streaming, mostra texto puro para performance
    contentDiv.textContent = fullText;
    scrollConversationToBottom();
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
    addActions: messageId => attachMessageActions(message, contentDiv, messageId),
    thinking,
    memoryNotice
  };
}

/*
  ==========================================
  STREAMING DA NEXA
  ==========================================
*/

async function askNexa(text, deep, image, file) {
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
        customInstructions,
        deep: deep === true,
        image: image || null,
        file: file || null
      }),

      signal: abortController?.signal
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
    searchNotice,
    addActions
  } = createStreamingMessage();

  /*
    Na pesquisa profunda o painel de pensamento já abre mostrando a
    cadeia do pesquisador; fecha quando a resposta começa a chegar.
  */

  if (deep) {
    thinking.expand();
  }

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
        /*
          Pesquisa profunda: o pesquisador terminou e a resposta
          começou — o painel fecha sozinho.
        */

        if (deep && !fullReply) {
          thinking.collapse();
        }

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
    A mensagem do usuário já entrou no `history` no envio
    (é o que tira a página do estado de boas-vindas antes
    da resposta chegar). Aqui entra só a resposta.
  */

  const assistantMessageId = makeMessageId();
  addActions(assistantMessageId);

  history.push({
    role: "model",
    content: fullReply,
    id: assistantMessageId,
    thinking: fullThinking,
    memoryUpdated,
    searched
  });

  saveMemory();

  notifyNativeVoice(fullReply, false);

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

  renderWelcomeState();
  scrollConversationToBottom();
}

/*
  Estado da página inicial: sem mensagens,
  a saudação e as sugestões ocupam o centro.
*/
function renderWelcomeState() {
  if (viewMode === "image") {
    const chat = currentImageChat();
    app.classList.toggle("welcome", !chat || chat.items.length === 0);
    return;
  }

  app.classList.toggle("welcome", history.length === 0);
}

async function showPersonalizedGreeting() {
  const greetingChatId = activeChatId;
  const initialMessageCount = history.length;
  const username = currentUser?.username || "por aqui";
  let memory = "";

  if (memoryEnabled) {
    try {
      const data = await api("GET", "/api/memories");
      memory = (data.memories || [])
        .map(item => typeof item.memory === "string" ? item.memory : "")
        .join("\n")
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").trim())
        .find(line => line && !line.startsWith("#")) || "";
    } catch (error) {
      console.error("Não foi possível carregar a memória para a saudação:", error);
    }
  }

  if (
    activeChatId !== greetingChatId ||
    history.length !== initialMessageCount ||
    sendButton.disabled
  ) {
    return;
  }

  const normalizedMemory = memory.replace(/[.!?…]+$/, "");
  const memorySnippet = normalizedMemory.length > 140
    ? normalizedMemory.slice(0, 137).trimEnd() + "…"
    : normalizedMemory;
  const greeting = memorySnippet
    ? `Oi, ${username}! Lembro das suas anotações: ${memorySnippet}. Quer retomar esse assunto ou começar algo novo?`
    : `Oi, ${username}! Que bom te ver por aqui. Por onde começamos?`;

  if (history.length === 0) {
    const heading = document.querySelector(".hero h2");
    if (heading) {
      heading.textContent = greeting;
    }
    return;
  }

  const message = document.createElement("div");
  message.className = "message nexa personalized-greeting";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "NEXA";
  const content = document.createElement("p");
  content.textContent = greeting;
  message.append(label, content);
  chat.appendChild(message);
  scrollConversationToBottom();
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
  if (viewMode === "image") {
    renderImageList();
    return;
  }

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

  try {
    localStorage.setItem(DRAWER_KEY, "open");
  } catch (error) {
    /* preferência de layout */
  }

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

  try {
    localStorage.setItem(DRAWER_KEY, "closed");
  } catch (error) {
    /* preferência de layout */
  }

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
  return prefix + (currentUser ? currentUser.id : "anonymous");
}

function loadAccountSettings(user) {
  try {
    memoryEnabled = localStorage.getItem(
      MEMORY_ENABLED_KEY + user.id
    ) !== "false";
    customInstructions = localStorage.getItem(
      INSTRUCTIONS_KEY + user.id
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
    agent: "Agente",
    agentThinking: "Pensamento",
    agentDeep: "Pesquisa profunda",
    agentVision: "Agente visual",
    agentIntent: "Agente de tema/intenção",
    agentReminders: "Lembretes",
    time: "Data e hora",
    listen: "Escuta",
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
  } else if (viewName === "agent") {
    loadAgentSettings();
  } else if (viewName === "time") {
    loadTimeSettings();
  } else if (viewName === "listen") {
    loadListenSettings();
  } else if (viewName === "reminders") {
    loadServerReminders();
  }
}

async function loadDeepSettings() {
  const agentInput = document.getElementById("deepAgentInput");
  const roundsInput = document.getElementById("deepRoundsInput");
  const status = document.getElementById("deepSettingsStatus");

  status.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/deep-settings");
    agentInput.value = data.agent || "";
    roundsInput.value = data.rounds || "";
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }
}

function showAgentTab(agentName) {
  const pages = {
    thinking: "agentThinking",
    deep: "agentDeep",
    vision: "agentVision",
    intent: "agentIntent",
    imagePrompt: "agentImagePrompt",
    spicy: "agentSpicy",
    reminders: "agentReminders",
  };
  Object.entries(pages).forEach(([name, viewName]) => {
    settingsViews[viewName].hidden = name !== agentName;
  });
  settingsViews.agent.hidden = true;
  settingsTitle.textContent = {
    thinking: "Pensamento",
    deep: "Pesquisa profunda",
    vision: "Agente visual",
    intent: "Agente de tema/intenção",
    imagePrompt: "Agente de imagem",
    spicy: "Agente safadinho",
    reminders: "Lembretes",
  }[agentName] || "Agente";
  if (agentName === "deep") {
    loadDeepSettings();
  }
}

async function loadAgentSettings() {
  try {
    const data = await api("GET", "/api/agent-settings");
    document.getElementById("thinkingRoundsDisplay").value = data.thinking.rounds;
    document.getElementById("thinkingTokensDisplay").value = data.thinking.max_tokens;
    document.getElementById("deepModelDisplay").value = data.deep.model;
    document.getElementById("visionModelDisplay").value = data.vision.model;
    document.getElementById("visionPromptDisplay").value = data.vision.prompt;
    document.getElementById("intentModelDisplay").value = data.intent.model;
    document.getElementById("intentPromptDisplay").value = data.intent.prompt;

    const imageAgent = data.image_prompt || {};

    document.getElementById("imagePromptAgentStatus").value =
      imageAgent.enabled ? "Ativado" : "Desativado";
    document.getElementById("imagePromptModelDisplay").value =
      imageAgent.model || "";
    document.getElementById("imagePromptTextarea").value =
      imageAgent.prompt || "";

    const spicyAgent = data.spicy || {};

    document.getElementById("spicyModelDisplay").value =
      spicyAgent.model || "";
    document.getElementById("spicyPromptDisplay").value =
      spicyAgent.prompt || "";

    document.getElementById("reminderModelDisplay").value = data.reminders.model;
    document.getElementById("reminderRoundsDisplay").value = data.reminders.rounds;
  } catch (error) {
    console.error("Erro ao carregar configurações dos agentes:", error);
  }
}

async function loadTimeSettings() {
  const input = document.getElementById("timeOffsetInput");
  const status = document.getElementById("timeSettingsStatus");
  const hint = document.getElementById("timeDeviceHint");
  const deviceOffset = Math.round(-new Date().getTimezoneOffset() / 60 * 2) / 2;

  status.textContent = "Carregando…";
  hint.textContent = "Fuso detectado neste navegador: " + deviceOffset + " em relação ao UTC.";

  try {
    const data = await api("GET", "/api/time-settings");
    input.value = data.offset;
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
  }
}

function nativeListen() {
  return window.NexaNative || null;
}

/*
  ==========================================
  VOZ DO APP ANDROID
  ==========================================
*/

let nativeVoicePending = false;

function notifyNativeVoice(text, failed) {
  if (!nativeVoicePending) {
    return;
  }

  nativeVoicePending = false;

  const bridge = nativeListen();

  try {
    if (failed) {
      if (bridge && typeof bridge.onAssistantError === "function") {
        bridge.onAssistantError(text || "");
      }
    } else if (bridge && typeof bridge.onAssistantReply === "function") {
      bridge.onAssistantReply(text || "");
    }
  } catch (error) {
    console.error("Erro ao avisar o app sobre a resposta:", error);
  }
}

/*
  O app manda o texto que ouviu; a resposta volta pela ponte
  (onAssistantReply/onAssistantError) para o TTS falar.
*/

window.NexaVoice = {
  ask(text) {
    const clean = typeof text === "string" ? text.trim() : "";

    if (!clean || nativeVoicePending || sendButton.disabled) {
      return false;
    }

    nativeVoicePending = true;
    input.value = clean;
    composer.dispatchEvent(new Event("submit", { cancelable: true }));

    return true;
  },
};

function renderListenStatus(active) {
  const status = document.getElementById("listenStatus");
  const toggle = document.getElementById("listenToggle");
  const battery = document.getElementById("listenBattery");
  const autostart = document.getElementById("listenAutostart");
  const bridge = nativeListen();

  if (!bridge) {
    status.textContent = "Disponível apenas no app Android.";
    toggle.hidden = true;
    battery.hidden = true;
    autostart.hidden = true;
    return;
  }

  status.textContent = active
    ? "Escuta em segundo plano ativa."
    : "Escuta em segundo plano desativada.";
  toggle.textContent = active ? "Desativar escuta" : "Ativar escuta";
  toggle.hidden = false;
  battery.hidden = false;
  autostart.hidden = false;
}

function loadListenSettings() {
  const bridge = nativeListen();
  let active = false;

  try {
    active = Boolean(bridge && bridge.isListeningServiceActive());
  } catch (error) {
    active = false;
  }

  renderListenStatus(active);
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
    } else if (
      window.NexaNative &&
      typeof window.NexaNative.registerPushToken === "function"
    ) {
      parts.push(
        "Nenhum aparelho registrado ainda — ponte do app detectada; reabra o app logado."
      );
    } else {
      parts.push(
        "Nenhum aparelho registrado — abra o site dentro do app logado para registrar."
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

/*
  Lembretes chegam num chat próprio ("Lembretes") para a mensagem não
  se perder no meio de outra conversa. Se esse chat estiver aberto, a
  mensagem também aparece na hora.
*/
const REMINDERS_CHAT_ID = "lembretes-da-nexa";
const REMINDERS_CHAT_TITLE = "Lembretes";

function deliverReminder(text) {
  let target = findChat(REMINDERS_CHAT_ID);

  if (!target) {
    target = makeChat();
    target.id = REMINDERS_CHAT_ID;
    target.title = REMINDERS_CHAT_TITLE;
    chats.unshift(target);
  }

  const message = {
    role: "model",
    content: text,
    id: makeMessageId()
  };

  target.messages.push(message);
  target.updatedAt = Date.now();
  target.dirty = true;

  if (target.id === activeChatId) {
    history.push(message);
    addMessage(text, "nexa", "", false);
  }

  saveChats();
  renderChatList();
  scheduleChatsPush();
}

async function pollDueReminders() {
  if (!currentUser || !messageKey) {
    return;
  }

  const cursorKey = REMINDER_CURSOR_PREFIX + ":" + currentUser.id;
  const cursor = parseInt(localStorage.getItem(cursorKey), 10) || 0;

  try {
    const data = await api("GET", `/api/reminders/due?since=${cursor}`);

    (data.due || []).forEach(function (item) {
      if (!item || !item.message) {
        return;
      }

      deliverReminder(item.message);

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Lembrete da NEXA", { body: item.message });
        } catch (error) {
          // Navegador móvel pode recusar Notification direto; a mensagem
          // já ficou salva no chat Lembretes.
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
  Token do FCM: o app manda o token pelo evento nativeFcmToken, expõe em
  window.NexaNative.getFcmToken() (ou em window.__NEXA_FCM_TOKEN__) e o
  servidor usa para enviar os lembretes por push.

  Ponte nova do app: registerPushToken recebe a chave da conta e o app
  cuida do registro do token (e das renovações) por conta própria.
*/
function readNativePushToken() {
  if (pushToken) {
    return;
  }

  if (typeof window.__NEXA_FCM_TOKEN__ === "string" && window.__NEXA_FCM_TOKEN__) {
    pushToken = window.__NEXA_FCM_TOKEN__;
    return;
  }

  if (window.NexaNative && typeof window.NexaNative.getFcmToken === "function") {
    try {
      pushToken = window.NexaNative.getFcmToken() || "";
    } catch (error) {
      pushToken = "";
    }
  }
}

function syncNativePushKey() {
  if (
    !messageKey ||
    !window.NexaNative ||
    typeof window.NexaNative.registerPushToken !== "function"
  ) {
    return;
  }

  try {
    window.NexaNative.registerPushToken(messageKey);
  } catch (error) {
    // Ponte antiga ou quebrada: o caminho do token pelo evento segue valendo.
  }
}

function syncPushToken() {
  readNativePushToken();

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

readNativePushToken();

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

function setGenerating(generating) {
  if (generating) {
    sendButton.classList.add("stopping");
    sendButton.querySelector(".send-icon").textContent = "■";
    sendButton.setAttribute("aria-label", "Parar geração");
    sendButton.title = "Parar geração";
    input.disabled = true;
    micButton.disabled = true;
    drawerNewChat.disabled = true;
    abortController = new AbortController();
  } else {
    sendButton.classList.remove("stopping");
    sendButton.querySelector(".send-icon").textContent = "➤";
    sendButton.setAttribute("aria-label", "Enviar");
    sendButton.title = "Enviar mensagem";
    input.disabled = false;
    micButton.disabled = false;
    drawerNewChat.disabled = false;
    abortController = null;
  }
}

sendButton.addEventListener("click", () => {
  if (abortController) {
    abortController.abort();
  }
});

/*
  ==========================================
  MODO IMAGEM (PÁGINA EMBUTIDA NO INDEX)
  Visão parecida com o modo chat: hero, feed de
  mensagens e composer. A barra lateral passa a
  listar as imagens anteriores.
  ==========================================
*/

const imageFeed = document.getElementById("imageFeed");
const imageChat = document.getElementById("imageChat");
const imageComposer = document.getElementById("imageComposer");
const imagePromptInput = document.getElementById("imagePromptInput");
const imageSendButton = document.getElementById("imageSendButton");
const imageGallery = document.getElementById("imageGallery");
const imageGalleryGrid = document.getElementById("imageGalleryGrid");
const imageGalleryEmpty = document.getElementById("imageGalleryEmpty");
const drawerSection = document.getElementById("drawerSection");

let viewMode = "chat";
let imageGenerating = false;

const IMAGE_CHATS_KEY = "nexa_image_chats";
const ACTIVE_IMAGE_CHAT_KEY = "nexa_active_image_chat";
const VIEW_MODE_KEY = "nexa_view_mode";

function loadViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "image"
      ? "image"
      : "chat";
  } catch {
    return "chat";
  }
}

function saveViewMode() {
  try {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  } catch {
    // Armazenamento indisponível: segue sem restaurar depois.
  }
}

let imageChats = [];
let activeImageChatId = null;

function makeImageChat() {
  return {
    id:
      "img_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 7),
    title: "Nova criação",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    items: []
  };
}

function imageChatTitle(items) {
  const first = (items || []).find(
    item => item && typeof item.prompt === "string" && item.prompt.trim()
  );

  if (!first) {
    return "Nova criação";
  }

  const single = first.prompt.replace(/\s+/g, " ").trim();

  return single.length > 42 ? single.slice(0, 42) + "…" : single;
}

function cleanImageItems(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .filter(
      item =>
        item &&
        typeof item.prompt === "string" &&
        item.prompt.trim()
    )
    .map(item => {
      const imageUrl =
        typeof item.imageUrl === "string" ? item.imageUrl : "";
      const status =
        item.status === "pending" || item.status === "error"
          ? item.status
          : imageUrl
            ? "done"
            : "error";

      return {
        id: typeof item.id === "string" && item.id ? item.id : makeMessageId(),
        prompt: item.prompt,
        finalPrompt: typeof item.finalPrompt === "string" ? item.finalPrompt : "",
        imageUrl,
        createdAt: Number(item.createdAt) || Date.now(),
        status,
        error: typeof item.error === "string" ? item.error : ""
      };
    });
}

function normalizeImageChat(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const items = cleanImageItems(raw.items);

  return {
    id:
      typeof raw.id === "string" && raw.id
        ? raw.id
        : makeImageChat().id,
    title:
      typeof raw.title === "string" && raw.title
        ? raw.title
        : imageChatTitle(items),
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    items
  };
}

function findImageChat(id) {
  if (!id) {
    return null;
  }

  return imageChats.find(item => item.id === id) || null;
}

function currentImageChat() {
  return findImageChat(activeImageChatId);
}

function saveImageChats() {
  try {
    localStorage.setItem(IMAGE_CHATS_KEY, JSON.stringify(imageChats));
    localStorage.setItem(ACTIVE_IMAGE_CHAT_KEY, activeImageChatId || "");
  } catch {
    // Armazenamento indisponível: segue só em memória.
  }
}

function loadImageChats() {
  imageChats = [];
  activeImageChatId = null;

  try {
    const raw = localStorage.getItem(IMAGE_CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      imageChats = parsed.map(normalizeImageChat).filter(Boolean);
    }
  } catch (error) {
    console.error("Erro ao carregar chats de imagem:", error);
    imageChats = [];
  }

  /*
    Migração do modelo antigo (lista única de imagens + sessão):
    junta tudo num chat só para não perder o que já foi criado.
  */
  if (imageChats.length === 0) {
    try {
      const legacyRaw = localStorage.getItem("nexa_images");
      const legacy = legacyRaw ? JSON.parse(legacyRaw) : [];

      if (Array.isArray(legacy) && legacy.length > 0) {
        const items = cleanImageItems(legacy);

        if (items.length > 0) {
          const migrated = makeImageChat();
          migrated.items = items
            .slice()
            .sort((a, b) => a.createdAt - b.createdAt);
          migrated.title = imageChatTitle(migrated.items);
          migrated.createdAt = migrated.items[0].createdAt;
          migrated.updatedAt = migrated.items[migrated.items.length - 1].createdAt;
          imageChats.push(migrated);
        }

        localStorage.removeItem("nexa_images");
        localStorage.removeItem("nexa_image_session");
      }
    } catch (error) {
      console.error("Erro ao migrar imagens antigas:", error);
    }
  }

  if (imageChats.length === 0) {
    const fresh = makeImageChat();
    imageChats.push(fresh);
  }

  let saved = null;

  try {
    saved = localStorage.getItem(ACTIVE_IMAGE_CHAT_KEY) || "";
  } catch {
    saved = null;
  }

  activeImageChatId = findImageChat(saved) ? saved : imageChats[0].id;

  /*
    Recarregou no meio de uma geração: o fetch morreu junto,
    então o pendente vira erro em vez de ficar "gerando" para sempre.
  */
  imageChats.forEach(chat => {
    chat.items.forEach(item => {
      if (item.status === "pending" || (!item.imageUrl && !item.error)) {
        item.status = "error";
        item.error = item.error || "Geração interrompida (a página foi recarregada).";
      }
    });
  });

  saveImageChats();
}

function ensureActiveImageChat() {
  let chat = currentImageChat();

  if (chat) {
    return chat;
  }

  if (imageChats.length === 0) {
    const fresh = makeImageChat();
    imageChats.unshift(fresh);
    activeImageChatId = fresh.id;
    saveImageChats();
    return fresh;
  }

  activeImageChatId = imageChats[0].id;
  saveImageChats();
  return imageChats[0];
}

function setViewMode(mode) {
  viewMode = mode === "image" ? "image" : "chat";

  app.classList.toggle("image-mode", viewMode === "image");

  chatFeedHidden(viewMode === "image");
  imageFeed.hidden = viewMode !== "image";
  imageComposer.hidden = viewMode !== "image";
  imageGallery.hidden = viewMode !== "image";

  drawerSection.textContent =
    viewMode === "image" ? "Imagens anteriores" : "Chats anteriores";

  renderChatList();
  renderWelcomeState();
  renderImageGallery();
  renderSpicyMode();
  saveViewMode();

  if (viewMode === "image") {
    renderImageChat();
  }

  scrollConversationToBottom();
}

function startNewImageChat() {
  const current = currentImageChat();

  /* Já está num chat de imagem em branco: não cria outro. */
  if (current && current.items.length === 0) {
    closeDrawer();
    imagePromptInput.value = "";
    imagePromptInput.focus();
    return;
  }

  /*
    Se sobrou um chat em branco, usa ele em vez de empilhar outro.
  */
  const blank = imageChats.find(
    chat => chat.id !== activeImageChatId && chat.items.length === 0
  );

  if (blank) {
    openImageChat(blank.id);
    return;
  }

  const fresh = makeImageChat();

  imageChats.unshift(fresh);
  activeImageChatId = fresh.id;

  saveImageChats();
  renderImageChat();
  renderChatList();
  renderWelcomeState();
  renderImageGallery();
  closeDrawer();

  imagePromptInput.value = "";
  imagePromptInput.focus();
}

function chatFeedHidden(isHidden) {
  chatFeed.hidden = isHidden;
  composer.hidden = isHidden;
  document.getElementById("suggestions").hidden = isHidden;
}

const chatFeed = document.getElementById("chatFeed");

function renderImageChat() {
  imageChat.innerHTML = "";

  /*
    Cada chat de imagem é isolado: só os itens do chat ativo
    aparecem no feed. Abrir outro chat troca o conteúdo,
    nunca soma.
  */
  const chat = currentImageChat();
  const items = chat
    ? chat.items.slice().sort((a, b) => a.createdAt - b.createdAt)
    : [];

  items.forEach(item => {
      const group = document.createElement("div");
      group.dataset.imageId = item.id;

      const userMessage = document.createElement("div");
      userMessage.className = "message user";

      const userLabel = document.createElement("span");
      userLabel.className = "label";
      userLabel.textContent = "VOCÊ";

      const userContent = document.createElement("div");
      userContent.className = "message-content";

      const userP = document.createElement("p");
      userP.textContent = item.prompt;
      userContent.appendChild(userP);

      userMessage.append(userLabel, userContent);

      const botMessage = document.createElement("div");
      botMessage.className = "message nexa";

      const botLabel = document.createElement("span");
      botLabel.className = "label";
      botLabel.textContent = "NEXA";

      const botContent = document.createElement("div");
      botContent.className = "message-content";

      if (item.status === "pending" || (!item.imageUrl && !item.error)) {
        const pendingP = document.createElement("p");
        pendingP.textContent = "Traduzindo e detalhando o prompt, depois gerando a imagem...";
        botContent.appendChild(pendingP);
      } else if (item.status === "error" || !item.imageUrl) {
        const errorP = document.createElement("p");
        errorP.textContent =
          "Não consegui gerar a imagem" +
          (item.error ? ": " + item.error : ". Tente de novo.");
        botContent.appendChild(errorP);
      } else {
        botContent.innerHTML = md.render(
          `![Imagem gerada a partir do prompt](${item.imageUrl})`
        );
      }

      botMessage.append(botLabel, botContent);

      /* Prompt final em inglês, como o agente reescreveu. */
      if (item.imageUrl && item.finalPrompt && item.finalPrompt !== item.prompt) {
        const note = document.createElement("div");
        note.className = "image-prompt-note";

        const noteLabel = document.createElement("span");
        noteLabel.className = "image-prompt-note-label";
        noteLabel.textContent = "Prompt usado";

        const noteText = document.createElement("span");
        noteText.className = "image-prompt-note-text";
        noteText.textContent = item.finalPrompt;

        note.append(noteLabel, noteText);
        botMessage.appendChild(note);
      }

      group.append(userMessage, botMessage);
      imageChat.appendChild(group);
    });

  scrollConversationToBottom();
}

function renderImageGallery() {
  imageGalleryGrid.innerHTML = "";

  /*
    A galeria fica só na página de boas-vindo, que só aparece com o
    chat ativo vazio: por isso ela reúne as imagens de todos os chats.
    Clicar abre o chat dono da imagem — o feed continua isolado.
  */
  const entries = [];

  imageChats.forEach(chat => {
    chat.items.forEach(item => {
      if (item && item.imageUrl) {
        entries.push({ chatId: chat.id, item });
      }
    });
  });

  entries.sort((a, b) => b.item.createdAt - a.item.createdAt);

  entries.forEach(({ chatId, item }) => {
      const thumb = document.createElement("img");

      thumb.className = "image-gallery-thumb";
      thumb.src = item.imageUrl;
      thumb.alt = item.prompt;
      thumb.title = item.prompt;

      thumb.addEventListener("click", () => {
        openImageChat(chatId);
        scrollToImageItem(item.id);
      });

      imageGalleryGrid.appendChild(thumb);
    });

  imageGalleryEmpty.hidden = entries.length > 0;
}

function scrollToImageItem(id) {
  const target = imageChat.querySelector(`[data-image-id="${id}"]`);

  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderImageList() {
  if (!drawerChats) {
    return;
  }

  drawerChats.innerHTML = "";

  const withContent = imageChats.filter(chat => chat.items.length > 0);

  if (withContent.length === 0) {
    const empty = document.createElement("p");

    empty.className = "drawer-empty";
    empty.textContent = "Nenhuma imagem ainda.";

    drawerChats.appendChild(empty);

    return;
  }

  withContent
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach(chat => {
      const row = document.createElement("div");

      row.className =
        "drawer-chat" +
        (chat.id === activeImageChatId ? " is-active" : "");

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
      when.textContent = formatWhen(chat.updatedAt);

      open.append(title, when);

      open.addEventListener("click", () => openImageChat(chat.id));

      const remove = document.createElement("button");

      remove.type = "button";
      remove.className = "drawer-chat-delete";
      remove.setAttribute(
        "aria-label",
        "Apagar conversa de imagem: " + chat.title
      );

      remove.textContent = "✕";

      remove.addEventListener("click", () => deleteImageChat(chat.id));

      row.append(open, remove);
      drawerChats.appendChild(row);
    });
}

function openImageChat(id) {
  if (id === activeImageChatId) {
    closeDrawer();
    imagePromptInput.focus();
    return;
  }

  const target = findImageChat(id);

  if (!target) {
    return;
  }

  activeImageChatId = target.id;

  saveImageChats();
  renderImageChat();
  renderChatList();
  renderWelcomeState();
  renderImageGallery();
  closeDrawer();

  imagePromptInput.value = "";
  imagePromptInput.focus();
  scrollConversationToBottom();
}

function deleteImageChat(id) {
  const index = imageChats.findIndex(item => item.id === id);

  if (index === -1) {
    return;
  }

  const wasActive = imageChats[index].id === activeImageChatId;

  imageChats.splice(index, 1);

  if (wasActive) {
    if (imageChats.length === 0) {
      const fresh = makeImageChat();
      imageChats.push(fresh);
    }

    const next = imageChats[Math.min(index, imageChats.length - 1)];

    activeImageChatId = next.id;
  }

  saveImageChats();
  renderImageList();
  renderImageChat();
  renderWelcomeState();
  renderImageGallery();
}

imageComposer.addEventListener("submit", async function (event) {
  event.preventDefault();

  if (imageGenerating) {
    return;
  }

  const prompt = imagePromptInput.value.trim();

  if (!prompt) {
    return;
  }

  imagePromptInput.value = "";
  imageGenerating = true;
  imageSendButton.disabled = true;
  imageComposer.classList.add("image-generating");

  /*
    O chat e o pedido entram na tela na hora do envio — igual ao
    modo chat — e a imagem preenche o item quando chegar.
  */
  const targetChat = ensureActiveImageChat();
  const targetChatId = targetChat.id;
  const newItemId = makeMessageId();

  targetChat.items.push({
    id: newItemId,
    prompt,
    finalPrompt: "",
    imageUrl: "",
    createdAt: Date.now(),
    status: "pending",
    error: ""
  });

  targetChat.title = imageChatTitle(targetChat.items);
  targetChat.updatedAt = Date.now();

  saveImageChats();
  renderImageChat();
  renderChatList();
  renderWelcomeState();
  renderImageGallery();

  const justCreated = imageChat.querySelector(
    `[data-image-id="${newItemId}"]`
  );

  if (justCreated) {
    justCreated.scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    scrollConversationToBottom();
  }

  function findPendingItem() {
    const owner = findImageChat(targetChatId);

    if (!owner) {
      return null;
    }

    return {
      owner,
      item: owner.items.find(entry => entry && entry.id === newItemId) || null
    };
  }

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey
      },
      body: JSON.stringify({
        prompt,
        spicy: spicyMode === true
      })
    });

    if (response.status === 401) {
      showAuth();
      throw new Error("Sua sessão expirou. Entre de novo.");
    }

    let data = null;

    try {
      data = await response.json();
    } catch {
      // Resposta não era JSON.
    }

    if (!response.ok) {
      throw new Error(
        (data && data.error) || `Erro na API (HTTP ${response.status}).`
      );
    }

    const found = findPendingItem();

    if (!found || !found.item) {
      return;
    }

    found.item.status = "done";
    found.item.error = "";
    found.item.finalPrompt = (data && data.prompt) || "";
    found.item.imageUrl = (data && data.image_url) || "";
    found.owner.updatedAt = Date.now();

    if (!found.item.imageUrl) {
      found.item.status = "error";
      found.item.error = "O servidor não devolveu uma imagem.";
    }

    saveImageChats();
    renderImageChat();
    renderChatList();
    renderWelcomeState();
    renderImageGallery();

    const created = imageChat.querySelector(
      `[data-image-id="${newItemId}"]`
    );

    if (created) {
      created.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } catch (error) {
    const found = findPendingItem();

    if (found && found.item) {
      found.item.status = "error";
      found.item.error = error?.message || "erro desconhecido";

      saveImageChats();
      renderImageChat();
      renderChatList();
      renderWelcomeState();
      renderImageGallery();
    }
  } finally {
    imageGenerating = false;
    imageSendButton.disabled = false;
    imageComposer.classList.remove("image-generating");
    imagePromptInput.focus();
  }
});

/*
  Sugestões da página inicial: preenchem o campo
  ou ativam o modo Criar imagem.
*/
document.querySelectorAll(".suggestion").forEach(function (button) {
  button.addEventListener("click", function () {
    const kind = button.dataset.suggestion;

    if (kind === "image") {
      setViewMode("image");
      imagePromptInput.focus();
      return;
    }

    if (kind) {
      input.value = kind;
      input.focus();
    }
  });
});

/*
  ==========================================
  GERAR IMAGEM NO CHAT
  O prompt vira uma chamada para a Novita AI e o
  resultado entra no histórico como markdown,
  igual a qualquer outra resposta da NEXA.
  ==========================================
*/

async function submitImagePrompt(prompt) {
  const isFirstMessage = history.length === 0;
  const titleChatId = isFirstMessage ? activeChatId : null;

  const userMsgId = makeMessageId();

  history.push({
    role: "user",
    content: prompt,
    id: userMsgId,
    image: null,
    file: null
  });

  addMessage(prompt, "user", "", false, userMsgId);

  input.value = "";
  clearAttachment();

  setGenerating(true);
  showTyping();

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey
      },
      body: JSON.stringify({
        prompt,
        spicy: spicyMode === true
      }),
      signal: abortController ? abortController.signal : undefined
    });

    hideTyping();

    if (response.status === 401) {
      showAuth();
      throw new Error("Sua sessão expirou. Entre de novo.");
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      // Resposta não era JSON.
    }

    if (!response.ok) {
      throw new Error(
        (data && data.error) || `Erro na API (HTTP ${response.status}).`
      );
    }

    const modelText =
      `![Imagem gerada a partir do prompt](${data.image_url})`;
    const assistantMsgId = makeMessageId();
    addMessage(modelText, "nexa", "", false, assistantMsgId);

    history.push({
      role: "model",
      content: modelText,
      id: assistantMsgId,
      thinking: "",
      memoryUpdated: false,
      searched: false
    });

    saveMemory();

    if (isFirstMessage) {
      const aiTitle = await generateChatTitle(prompt);
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
    if (error.name === "AbortError") {
      hideTyping();
    } else {
      console.error("NEXA image error:", error);
      hideTyping();
      addMessage(
        "Erro ao gerar a imagem: " +
          (error && error.message ? error.message : "erro desconhecido"),
        "nexa",
        "",
        false
      );
    }
  } finally {
    setGenerating(false);
    input.focus();
  }
}

composer.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    const text =
      input.value.trim();

    /*
      Durante a geração, o botão vira ■ e o clique para
      (o listener do botão aborta); o submit só retorna.
    */
    if (abortController) {
      abortController.abort();
      return;
    }

    if (
      (!text && !pendingImage && !pendingFile) ||
      sendButton.disabled
    ) {
      return;
    }

    /*
      No modo Criar imagem o texto é o prompt: a geração
      acontece fora do chat e o resultado vira mensagem.
      Depois de gerar, o modo desliga: a próxima mensagem
      é de texto normal.
    */
    if (imageMode && text && !pendingImage && !pendingFile) {
      setImageMode(false);
      await submitImagePrompt(text);
      return;
    }

    const submittedImage = pendingImage;
    const submittedFile = pendingFile;
    const messageText = text || (submittedImage
      ? "Descreva esta imagem."
      : "Analise o arquivo anexado.");

    /*
      O modo de pesquisa profunda permanece ativo neste chat até o usuário
      desligá-lo manualmente. Assim, cada nova mensagem continua passando
      pelo agente pesquisador antes da resposta final.
    */
    const deep = deepMode;

    setGenerating(true);

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
      Mostra a mensagem do usuário e já registra no `history`:
      é o que tira a página do estado de boas-vindas antes
      da resposta chegar.
    */

    const userMsgId = makeMessageId();

    history.push({
      role: "user",
      content: messageText,
      id: userMsgId,
      image: submittedImage || null,
      file: submittedFile || null
    });

    addMessage(messageText, "user", "", false, userMsgId, submittedImage);

    input.value = "";
    clearAttachment();

    /*
      Indicador enquanto o primeiro
      pedaço da resposta ainda não chegou.
    */

    showTyping();

    try {
      await askNexa(messageText, deep, submittedImage, submittedFile);
      pendingImage = null;
      input.placeholder = deepMode
        ? "Descreva o tema da pesquisa profunda..."
        : "Digite uma mensagem...";

      /* 
        Se foi a primeira mensagem, gera título pela IA
      */
      if (isFirstMessage) {
        const aiTitle = await generateChatTitle(messageText);
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
      if (error.name === "AbortError") {
        hideTyping();
      } else {
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

        notifyNativeVoice(error?.message || "erro desconhecido", true);
      }

    } finally {
      setGenerating(false);
      input.focus();
    }
  }
);

/*
  ==========================================
  NOVA CONVERSA
  ==========================================
*/

drawerNewChat.addEventListener(
  "click",
  function () {
    if (viewMode === "image") {
      startNewImageChat();
      return;
    }

    startNewChat();
  }
);

const drawerImages = document.getElementById("drawerImages");

if (drawerImages) {
  drawerImages.addEventListener("click", function () {
    setViewMode("image");
    closeDrawer();
    imagePromptInput.focus();
    imagePromptInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

/*
  Botao "Chat": volta para o modo conversa normal.
*/
const drawerChat = document.getElementById("drawerChat");

if (drawerChat) {
  drawerChat.addEventListener("click", function () {
    setViewMode("chat");
    closeDrawer();
    input.focus();
    scrollConversationToBottom();
  });
}

const studioButton = document.getElementById("studioButton");

if (studioButton) {
  studioButton.addEventListener("click", () => {
    window.location.assign("/studio.html");
  });
}


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

document.querySelectorAll("[data-agent-tab]").forEach(button => {
  button.addEventListener("click", function () {
    showAgentTab(button.dataset.agentTab);
  });
});

document.querySelectorAll("[data-agent-back]").forEach(button => {
  button.addEventListener("click", function () {
    showSettingsView("agent");
  });
});

memoryToggle.addEventListener("change", function () {
  memoryEnabled = memoryToggle.checked;
  try {
    localStorage.setItem(
      MEMORY_ENABLED_KEY + currentUser.id,
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
      INSTRUCTIONS_KEY + currentUser.id,
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

document.getElementById("saveDeepSettings").addEventListener("click", async function () {
  const button = document.getElementById("saveDeepSettings");
  const status = document.getElementById("deepSettingsStatus");
  const agentInput = document.getElementById("deepAgentInput");
  const roundsInput = document.getElementById("deepRoundsInput");

  button.disabled = true;

  try {
    const data = await api("PUT", "/api/deep-settings", {
      agent: agentInput.value.trim(),
      rounds: roundsInput.value === ""
        ? null
        : Number(roundsInput.value)
    });
    agentInput.value = data.agent || "";
    roundsInput.value = data.rounds || "";
    status.textContent = "Configuração salva. Vale na próxima pesquisa profunda.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("saveTimeSettings").addEventListener("click", async function () {
  const button = document.getElementById("saveTimeSettings");
  const status = document.getElementById("timeSettingsStatus");
  const input = document.getElementById("timeOffsetInput");

  if (input.value === "") {
    status.textContent = "Informe o fuso em horas em relação ao UTC (ex.: -3).";
    return;
  }

  button.disabled = true;

  try {
    const data = await api("PUT", "/api/time-settings", {
      offset: Number(input.value)
    });
    input.value = data.offset;
    status.textContent = "Fuso salvo. O modelo e os lembretes passam a usar esse horário.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("listenToggle").addEventListener("click", function () {
  const bridge = nativeListen();
  if (!bridge) {
    return;
  }

  const active = Boolean(bridge.isListeningServiceActive());

  if (active) {
    bridge.stopListeningService();
  } else {
    bridge.startListeningService();
  }

  renderListenStatus(!active);
});

document.getElementById("listenBattery").addEventListener("click", function () {
  const bridge = nativeListen();
  if (bridge) {
    bridge.requestBatteryOptimizationExemption();
  }
});

document.getElementById("listenAutostart").addEventListener("click", function () {
  const bridge = nativeListen();
  if (bridge) {
    bridge.openAutostartSettings();
  }
});

window.addEventListener("nativeListeningChange", function (event) {
  renderListenStatus(Boolean((event.detail || {}).active));
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
      scrollConversationToBottom();
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
      item.memoryUpdated,
      item.id,
      item.image,
      item.file
    );
  });
}

/*
  Sidebar no estilo ChatGPT: aberta por padrão no
  desktop e recolhível; no celular vira sobreposição.
*/
function restoreDrawerPreference() {
  let open = false;

  try {
    const saved = localStorage.getItem(DRAWER_KEY);
    open = saved === "open" ||
      (saved === null &&
        window.matchMedia("(min-width: 1025px)").matches);
  } catch (error) {
    open = false;
  }

  if (!open) {
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
}

function bootApp() {
  loadChats();
  loadImageChats();
  renderChat();
  renderChatList();
  loadReasoning();
  setupReasoningUI();
  renderReasoning();
  setupAttachUI();
  renderDeepMode();
  renderImageMode();
  renderSpicyMode();
  restoreViewMode();
  restoreDrawerPreference();
}

/*
  Ao abrir o site volta para a página em que a pessoa
  estava: modo imagem ou modo chat.
*/
function restoreViewMode() {
  setViewMode(loadViewMode());
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
  (nexa_chats:<id da conta>). O app só inicia depois do login.
  ==========================================
*/

const authPanel = document.getElementById("authPanel");
const authError = document.getElementById("authError");
const loginForm = document.getElementById("loginForm");
const drawerEmail = document.getElementById("drawerEmail");
const drawerAvatar = document.getElementById("drawerAvatar");
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
    const parsed = await response.json();
    if (parsed && typeof parsed === "object") {
      data = parsed;
    }
  } catch {
    // Resposta sem JSON.
  }

  if (!response.ok) {
    if (response.status === 401 && data.code === "message_key_expired") {
      const expiredUser = currentUser;
      if (expiredUser) {
        localStorage.removeItem(
          MESSAGE_KEY_STORAGE_PREFIX + expiredUser.username
        );
      }
      messageKey = "";
      currentUser = null;
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      if (expiredUser) {
        showAuth();
      }
    }

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

  const suffix = ":" + user.id;
  const legacyChats = localStorage.getItem("nexa_chats");

  CHATS_KEY = "nexa_chats" + suffix;
  ACTIVE_CHAT_KEY = "nexa_active_chat" + suffix;
  loadAccountSettings(user);
  loadDeepMode();
  loadSpicyMode();

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
  drawerAvatar.textContent = user.username.trim().charAt(0).toUpperCase() || "N";
  drawerAdmin.hidden = !user.isAdmin;

  if (!appStarted) {
    appStarted = true;
    bootApp();
  }

  startReminderPolling();
  syncNativePushKey();
  syncPushToken();
  syncChatsFromServer()
    .catch(function (error) {
      console.error("Não foi possível sincronizar as conversas ao entrar:", error);
    })
    .finally(showPersonalizedGreeting);
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
