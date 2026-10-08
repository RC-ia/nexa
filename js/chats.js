/**
 * Conversas: modelo de dados, sync multi-dispositivo e navegação
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { api } from "./auth.js";
import { restoreConversation } from "./boot.js";
import { CHATS_PUSH_DELAY_MS, MEMORY_KEY } from "./constants.js";
import { app, chat, drawerChats, input, scrollConversationToBottom, sendButton, settingsPanel } from "./dom.js";
import { closeDrawer } from "./drawer.js";
import { currentImageChat, renderImageList } from "./images.js";
import { hideTyping } from "./messages.js";
import { ACTIVE_CHAT_KEY, CHATS_KEY, activeChatId, assignActiveChatId, assignChats, assignChatsPushTimer, chats, chatsPushTimer } from "./state.js";
import { currentUser, history, messageKey, viewMode } from "./state.js";

export function makeId() {
  return (
    "chat_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 7)
  );
}


export function makeMessageId() {
  return (
    "msg_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 7)
  );
}


export function cleanMessages(list) {
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


export function chatTitle(messages) {
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


export function formatWhen(timestamp) {
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


export function makeChat() {
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


export function normalizeChat(raw) {
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


export function findChat(id) {
  if (!id) {
    return null;
  }

  return (
    chats.find(item => item.id === id) ||
    null
  );
}


export function currentChat() {
  return findChat(activeChatId);
}


export function saveChats() {
  localStorage.setItem(
    CHATS_KEY,
    JSON.stringify(chats)
  );

  localStorage.setItem(
    ACTIVE_CHAT_KEY,
    activeChatId || ""
  );
}


export function mergeChatMessages(localMessages, serverMessages) {
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


export function applyChatContent(local, source) {
  local.title = source.title;
  local.updatedAt = source.updatedAt;
  local.messages = source.messages;
  local.rev = source.rev || 0;
}


export async function pushChat(chat, attempt) {
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


export async function pushDirtyChats() {
  const pending = chats.filter(chat => chat.dirty);

  for (const chat of pending) {
    await pushChat(chat, 1);
  }
}


export function scheduleChatsPush() {
  if (chatsPushTimer) {
    return;
  }

  assignChatsPushTimer(setTimeout(function () {
    assignChatsPushTimer(null);
    pushDirtyChats().catch(function () {});
  }, CHATS_PUSH_DELAY_MS));
}


export async function syncChatsFromServer() {
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
  assignChats(chats.filter(function (chat) {
    if (chat.dirty || onServer.has(chat.id) || !(chat.rev > 0)) {
      return true;
    }

    if (chat.id === activeBefore) {
      activeTouched = true;
    }

    return false;
  }));

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

    assignActiveChatId(chats[0].id);
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


export function loadChats() {
  try {
    const saved = localStorage.getItem(CHATS_KEY);

    if (saved) {
      const parsed = JSON.parse(saved);

      if (Array.isArray(parsed)) {
        assignChats(parsed
          .map(normalizeChat)
          .filter(Boolean));
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

  assignChats(chats.filter(function (chat) {
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
  }));

  if (chats.length === 0) {
    chats.push(makeChat());
  }

  const saved = localStorage.getItem(
    ACTIVE_CHAT_KEY
  );

  assignActiveChatId(findChat(saved)
    ? saved
    : chats[0].id);

  const chat = currentChat();

  history.length = 0;
  history.push(...chat.messages);

  saveChats();
}


export function stashCurrent() {
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


export function renderChat() {
  if (history.length === 0) {
    chat.innerHTML = "";
  } else {
    restoreConversation();
  }

  renderWelcomeState();
  scrollConversationToBottom();
}


export function renderWelcomeState() {
  if (viewMode === "image") {
    const chat = currentImageChat();
    app.classList.toggle("welcome", !chat || chat.items.length === 0);
    return;
  }

  app.classList.toggle("welcome", history.length === 0);
}


export function simpleGreeting(username) {
  const hora = new Date().getHours();

  const periodo =
    hora >= 5 && hora < 12
      ? "Bom dia"
      : hora >= 12 && hora < 18
        ? "Boa tarde"
        : "Boa noite";

  const nome = (username || "").trim();

  return nome ? periodo + ", " + nome + "!" : periodo + "!";
}


export function showPersonalizedGreeting() {
  const heading = document.querySelector(".hero h2");

  /*
    O título pertence só à tela de boas-vindas: com a conversa
    já aberta ele não pode vazar para dentro do chat como se
    fosse uma mensagem da NEXA.
  */
  if (heading && history.length === 0 && !sendButton.disabled) {
    heading.textContent = simpleGreeting(currentUser?.username || "");
  }
}


export function startNewChat() {
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
  assignActiveChatId(fresh.id);
  history.length = 0;

  hideTyping();
  saveChats();
  renderChat();
  renderChatList();
  closeDrawer();

  input.value = "";
  input.focus();
}


export function openChat(id) {
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

  assignActiveChatId(target.id);
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


export function collectGeneratedImages(texts) {
  const names = new Set();
  const pattern = /\/generated\/([^)\s"'#?]+)/g;

  (texts || []).forEach(text => {
    const value = String(text == null ? "" : text);
    let match;

    while ((match = pattern.exec(value))) {
      let name = match[1];
      try {
        name = decodeURIComponent(name);
      } catch (error) {
        // Sequência de escape inválida: usa o nome como está.
      }
      names.add(name);
    }
  });

  return Array.from(names);
}


export function deleteGeneratedImages(texts) {
  collectGeneratedImages(texts).forEach(name => {
    api(
      "DELETE",
      "/generated/" + encodeURIComponent(name)
    ).catch(function () {});
  });
}


export function deleteChat(id) {
  const index = chats.findIndex(
    item => item.id === id
  );

  if (index === -1) {
    return;
  }

  const removed = chats[index];
  const wasActive = removed.id === activeChatId;

  chats.splice(index, 1);

  if (wasActive) {
    if (chats.length === 0) {
      const fresh = makeChat();

      chats.push(fresh);
      assignActiveChatId(fresh.id);
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

      assignActiveChatId(next.id);
      history.length = 0;
      history.push(...next.messages);
    }

    renderChat();
  }

  api(
    "DELETE",
    "/api/chats/" + encodeURIComponent(id)
  ).catch(function () {});

  deleteGeneratedImages(
    (removed.messages || []).map(message => message && message.content)
  );

  saveChats();
  renderChatList();
}


export function renderChatList() {
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

  const texts = [];
  chats.forEach(chat => {
    (chat.messages || []).forEach(message => {
      if (message) {
        texts.push(message.content);
      }
    });
  });
  deleteGeneratedImages(texts);

  assignChats([]);
  history.length = 0;
  assignActiveChatId("");
  startNewChat();
  settingsPanel.hidden = true;
  input.focus();
});



