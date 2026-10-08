/**
 * Modo Criar imagem: chats de imagem, galeria e geração
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { clearAttachment } from "./attachments.js";
import { showAuth } from "./auth.js";
import { deleteGeneratedImages, findChat, formatWhen, makeMessageId, renderChatList, renderWelcomeState, saveChats, scheduleChatsPush } from "./chats.js";
import { ACTIVE_IMAGE_CHAT_KEY, IMAGE_CHATS_KEY, VIEW_MODE_KEY } from "./constants.js";
import { app, chatFeed, composer, drawerChat, drawerChats, drawerImages, drawerSection, imageChat } from "./dom.js";
import { imageComposer, imageFeed, imageGallery, imageGalleryEmpty, imageGalleryGrid, imagePromptInput, imageSendButton, input } from "./dom.js";
import { scrollConversationToBottom } from "./dom.js";
import { closeDrawer } from "./drawer.js";
import { md } from "./markdown.js";
import { addMessage, hideTyping, showTyping } from "./messages.js";
import { renderSpicyMode } from "./preferences.js";
import { saveMemory } from "./settings.js";
import { abortController, activeChatId, activeImageChatId, assignActiveImageChatId, assignImageChats, assignImageGenerating, assignViewMode, history } from "./state.js";
import { imageChats, imageGenerating, messageKey, spicyMode, viewMode } from "./state.js";
import { generateChatTitle, setGenerating } from "./stream.js";

export function loadViewMode() {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "image"
      ? "image"
      : "chat";
  } catch {
    return "chat";
  }
}


export function saveViewMode() {
  try {
    localStorage.setItem(VIEW_MODE_KEY, viewMode);
  } catch {
    // Armazenamento indisponível: segue sem restaurar depois.
  }
}


export function makeImageChat() {
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


export function imageChatTitle(items) {
  const first = (items || []).find(
    item => item && typeof item.prompt === "string" && item.prompt.trim()
  );

  if (!first) {
    return "Nova criação";
  }

  const single = first.prompt.replace(/\s+/g, " ").trim();

  return single.length > 42 ? single.slice(0, 42) + "…" : single;
}


export function cleanImageItems(list) {
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


export function normalizeImageChat(raw) {
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


export function findImageChat(id) {
  if (!id) {
    return null;
  }

  return imageChats.find(item => item.id === id) || null;
}


export function currentImageChat() {
  return findImageChat(activeImageChatId);
}


export function saveImageChats() {
  try {
    localStorage.setItem(IMAGE_CHATS_KEY, JSON.stringify(imageChats));
    localStorage.setItem(ACTIVE_IMAGE_CHAT_KEY, activeImageChatId || "");
  } catch {
    // Armazenamento indisponível: segue só em memória.
  }
}


export function loadImageChats() {
  assignImageChats([]);
  assignActiveImageChatId(null);

  try {
    const raw = localStorage.getItem(IMAGE_CHATS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      assignImageChats(parsed.map(normalizeImageChat).filter(Boolean));
    }
  } catch (error) {
    console.error("Erro ao carregar chats de imagem:", error);
    assignImageChats([]);
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

  assignActiveImageChatId(findImageChat(saved) ? saved : imageChats[0].id);

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


export function ensureActiveImageChat() {
  let chat = currentImageChat();

  if (chat) {
    return chat;
  }

  if (imageChats.length === 0) {
    const fresh = makeImageChat();
    imageChats.unshift(fresh);
    assignActiveImageChatId(fresh.id);
    saveImageChats();
    return fresh;
  }

  assignActiveImageChatId(imageChats[0].id);
  saveImageChats();
  return imageChats[0];
}


export function setViewMode(mode) {
  assignViewMode(mode === "image" ? "image" : "chat");

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


export function startNewImageChat() {
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
  assignActiveImageChatId(fresh.id);

  saveImageChats();
  renderImageChat();
  renderChatList();
  renderWelcomeState();
  renderImageGallery();
  closeDrawer();

  imagePromptInput.value = "";
  imagePromptInput.focus();
}


export function chatFeedHidden(isHidden) {
  chatFeed.hidden = isHidden;
  composer.hidden = isHidden;
  document.getElementById("suggestions").hidden = isHidden;
}


export function renderImageChat() {
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


export function renderImageGallery() {
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


export function scrollToImageItem(id) {
  const target = imageChat.querySelector(`[data-image-id="${id}"]`);

  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}


export function renderImageList() {
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


export function openImageChat(id) {
  if (id === activeImageChatId) {
    closeDrawer();
    imagePromptInput.focus();
    return;
  }

  const target = findImageChat(id);

  if (!target) {
    return;
  }

  assignActiveImageChatId(target.id);

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


export function deleteImageChat(id) {
  const index = imageChats.findIndex(item => item.id === id);

  if (index === -1) {
    return;
  }

  const removed = imageChats[index];
  const wasActive = removed.id === activeImageChatId;

  imageChats.splice(index, 1);

  if (wasActive) {
    if (imageChats.length === 0) {
      const fresh = makeImageChat();
      imageChats.push(fresh);
    }

    const next = imageChats[Math.min(index, imageChats.length - 1)];

    assignActiveImageChatId(next.id);
  }

  deleteGeneratedImages(
    (removed.items || []).map(item => item && item.imageUrl)
  );

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
  assignImageGenerating(true);
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
    assignImageGenerating(false);
    imageSendButton.disabled = false;
    imageComposer.classList.remove("image-generating");
    imagePromptInput.focus();
  }
});


export async function submitImagePrompt(prompt) {
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


if (drawerImages) {
  drawerImages.addEventListener("click", function () {
    setViewMode("image");
    closeDrawer();
    imagePromptInput.focus();
    imagePromptInput.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}


if (drawerChat) {
  drawerChat.addEventListener("click", function () {
    setViewMode("chat");
    closeDrawer();
    input.focus();
    scrollConversationToBottom();
  });
}


export function restoreViewMode() {
  setViewMode(loadViewMode());
}



