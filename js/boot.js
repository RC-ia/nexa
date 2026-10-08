/**
 * Boot da aplicação (entrypoint do módulo)
 * Entry: index.html carrega este módulo; ele importa todos os
 * demais para garantir que listeners de topo sejam registrados.
 */
import "./dom.js";
import "./constants.js";
import "./state.js";
import "./markdown.js";
import "./messages.js";
import "./preferences.js";
import "./attachments.js";
import "./chats.js";
import "./stream.js";
import "./images.js";
import "./drawer.js";
import "./gestures.js";
import "./settings.js";
import "./native.js";
import "./reminders.js";
import "./auth.js";

import { renderImageMode, setupAttachUI } from "./attachments.js";
import { loadChats, renderChat, renderChatList } from "./chats.js";
import { chat } from "./dom.js";
import { restoreDrawerPreference } from "./drawer.js";
import { loadImageChats, restoreViewMode } from "./images.js";
import { addMessage } from "./messages.js";
import { loadReasoning, renderDeepMode, renderReasoning, renderSpicyMode, setupReasoningUI } from "./preferences.js";
import { history } from "./state.js";

export function restoreConversation() {
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


export function bootApp() {
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


export async function loadVersion() {
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



