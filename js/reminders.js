/**
 * Lembretes: polling, entrega, notificações e push nativo
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { api } from "./auth.js";
import { findChat, makeChat, makeMessageId, renderChatList, saveChats, scheduleChatsPush } from "./chats.js";
import { REMINDERS_CHAT_ID, REMINDERS_CHAT_TITLE, REMINDER_CURSOR_PREFIX, REMINDER_POLL_MS } from "./constants.js";
import { pushStatusLine, reminderList, reminderNotificationButton, reminderStatus } from "./dom.js";
import { addMessage } from "./messages.js";
import { activeChatId, assignPushToken, assignReminderPollTimer, chats, currentUser, history, messageKey, pushToken } from "./state.js";
import { reminderPollTimer } from "./state.js";

export async function loadServerReminders() {
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


export async function updatePushStatus() {
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


export function renderReminderList(items) {
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


export function deliverReminder(text) {
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


export async function pollDueReminders() {
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


export function startReminderPolling() {
  if (reminderPollTimer) {
    return;
  }

  pollDueReminders();
  assignReminderPollTimer(setInterval(pollDueReminders, REMINDER_POLL_MS));
}


export function readNativePushToken() {
  if (pushToken) {
    return;
  }

  if (typeof window.__NEXA_FCM_TOKEN__ === "string" && window.__NEXA_FCM_TOKEN__) {
    assignPushToken(window.__NEXA_FCM_TOKEN__);
    return;
  }

  if (window.NexaNative && typeof window.NexaNative.getFcmToken === "function") {
    try {
      assignPushToken(window.NexaNative.getFcmToken() || "");
    } catch (error) {
      assignPushToken("");
    }
  }
}


export function syncNativePushKey() {
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


export function syncPushToken() {
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
    assignPushToken(detail.token);
    syncPushToken();
  }
});


readNativePushToken();


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



