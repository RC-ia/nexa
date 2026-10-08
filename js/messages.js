/**
 * Criação e renderização de mensagens no feed
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { makeMessageId, renderChat, renderWelcomeState } from "./chats.js";
import { NOTICE_ITEMS } from "./constants.js";
import { chat, input, scrollConversationToBottom } from "./dom.js";
import { md } from "./markdown.js";
import { notifyNativeVoice } from "./native.js";
import { saveMemory } from "./settings.js";
import { deepMode, history } from "./state.js";
import { askNexa, setGenerating } from "./stream.js";

export function attachMessageActions(message, contentDiv, messageId) {
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


export function addMessage(text, type, thinkingText, memoryUpdated, messageId, image, file) {
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


export function retryFromMessage(messageId) {
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


export function copyMessageContent(contentDiv) {
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


export function showTyping() {
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


export function hideTyping() {
  const typing =
    document.getElementById(
      "nexaTyping"
    );

  if (typing) {
    typing.remove();
  }
}


export function createNotice(kind) {
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


export function createMemoryNotice() {
  return createNotice("memory");
}


export function createSearchNotice() {
  return createNotice("search");
}


export function createThinkingBlock() {
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


export function createStreamingMessage() {
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



