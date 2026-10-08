/**
 * Autenticação, API base e painel admin
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { bootApp } from "./boot.js";
import { showPersonalizedGreeting, syncChatsFromServer } from "./chats.js";
import { MESSAGE_KEY_STORAGE_PREFIX } from "./constants.js";
import { adminError, adminForm, adminPanel, adminUsers, authError, authPanel, drawerAdmin, drawerAvatar } from "./dom.js";
import { drawerEmail, drawerLogout, loginForm, serverActionStatus, serverForceCheck, serverStatusPid, serverStatusUptime, serverStatusValue } from "./dom.js";
import { closeDrawer } from "./drawer.js";
import { loadDeepMode, loadSpicyMode } from "./preferences.js";
import { startReminderPolling, syncNativePushKey, syncPushToken } from "./reminders.js";
import { loadAccountSettings } from "./settings.js";
import { ACTIVE_CHAT_KEY, CHATS_KEY, appStarted, assignACTIVE_CHAT_KEY, assignAppStarted, assignCHATS_KEY, assignCurrentUser, assignMessageKey } from "./state.js";
import { currentUser, messageKey } from "./state.js";

export function showMessage(element, message) {
  element.textContent = message || "";
  element.hidden = !message;
}


export function showAuth() {
  adminPanel.hidden = true;
  authPanel.hidden = false;
  showMessage(authError, "");
  document.getElementById("loginUser").focus();
}


export async function api(method, path, payload) {
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
      assignMessageKey("");
      assignCurrentUser(null);
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


export function enterApp(user, issuedMessageKey) {
  assignCurrentUser(user);

  const messageKeyStorageKey =
    MESSAGE_KEY_STORAGE_PREFIX + user.username;

  if (typeof issuedMessageKey === "string" && issuedMessageKey.length === 64) {
    assignMessageKey(issuedMessageKey);
    localStorage.setItem(messageKeyStorageKey, messageKey);
  } else {
    assignMessageKey(localStorage.getItem(messageKeyStorageKey) || "");
  }

  if (!messageKey) {
    showAuth();
    return;
  }

  const suffix = ":" + user.id;
  const legacyChats = localStorage.getItem("nexa_chats");

  assignCHATS_KEY("nexa_chats" + suffix);
  assignACTIVE_CHAT_KEY("nexa_active_chat" + suffix);
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
    assignAppStarted(true);
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
  assignMessageKey("");

  location.reload();
});


export async function loadAdminUsers() {
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


export async function adminAction(method, path, payload) {
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


export async function loadServerStatus() {
  try {
    const data = await api("GET", "/api/admin/server/status");
    updateServerStatusUI(data);
  } catch (error) {
    serverStatusValue.textContent = "Erro";
    serverActionStatus.textContent = error.message;
  }
}


export function updateServerStatusUI(data) {
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


export async function serverAction(action) {
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


export const originalLoadAdminUsers = loadAdminUsers;


loadAdminUsers = async function () {
  await originalLoadAdminUsers();
  await loadServerStatus();
};


export async function initAuth() {
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



