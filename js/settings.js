/**
 * Painel de configurações: chamada, memória, instruções, agentes e fuso
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { api } from "./auth.js";
import { chatTitle, currentChat, renderChatList, saveChats, scheduleChatsPush } from "./chats.js";
import { INSTRUCTIONS_KEY, LIVE_VOICE_KEY, MEMORY_ENABLED_KEY } from "./constants.js";
import { customInstructionsInput, drawerSettings, drawerToggle, instructionStatus, liveCallOpenButton, liveVoiceSelect, liveVoiceStatus, memoryList } from "./dom.js";
import { memoryStatus, memoryToggle, settingsClose, settingsHome, settingsPanel, settingsTitle, settingsViews, systemPromptInput } from "./dom.js";
import { systemPromptStatus } from "./dom.js";
import { closeDrawer } from "./drawer.js";
import { loadListenSettings } from "./native.js";
import { loadServerReminders } from "./reminders.js";
import { assignCustomInstructions, assignLiveVoiceSaved, assignLiveVoices, assignMemoryEnabled, currentUser, customInstructions, drawerOpen, history } from "./state.js";
import { liveVoiceSaved, liveVoices, memoryEnabled } from "./state.js";

export function saveMemory() {
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


export function accountSettingKey(prefix) {
  return prefix + (currentUser ? currentUser.id : "anonymous");
}


export function loadAccountSettings(user) {
  try {
    assignMemoryEnabled(localStorage.getItem(
      MEMORY_ENABLED_KEY + user.id
    ) !== "false");
    assignCustomInstructions(localStorage.getItem(
      INSTRUCTIONS_KEY + user.id
    ) || "");
  } catch (error) {
    assignMemoryEnabled(true);
    assignCustomInstructions("");
  }

  memoryToggle.checked = memoryEnabled;
  customInstructionsInput.value = customInstructions;
}


export function loadLiveVoicePreference() {
  try {
    return localStorage.getItem(LIVE_VOICE_KEY) || "";
  } catch {
    return "";
  }
}


export function saveLiveVoicePreference(voice) {
  try {
    localStorage.setItem(LIVE_VOICE_KEY, voice);
  } catch (error) {
    console.error("Erro ao salvar a voz da chamada:", error);
  }
}


export function applyLiveVoiceSelection() {
  const saved = loadLiveVoicePreference();
  assignLiveVoiceSaved(liveVoices.includes(saved) ? saved : liveVoices[0] || "Kore");

  liveVoiceSelect.replaceChildren();

  liveVoices.forEach(name => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    liveVoiceSelect.appendChild(option);
  });

  liveVoiceSelect.value = liveVoiceSaved;
}


export async function loadLiveSettings() {
  liveVoiceStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/live/voices");
    assignLiveVoices(Array.isArray(data.voices) ? data.voices : []);
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
    assignLiveVoices([]);
    applyLiveVoiceSelection();
    liveVoiceSelect.disabled = true;
    liveVoiceStatus.textContent = "Não foi possível carregar as vozes.";
  }
}


liveVoiceSelect.addEventListener("change", function () {
  assignLiveVoiceSaved(liveVoiceSelect.value);
  saveLiveVoicePreference(liveVoiceSaved);
});


liveCallOpenButton.addEventListener("click", function () {
  window.location.assign("/live.html");
});


export function showSettingsView(viewName) {
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


export async function loadDeepSettings() {
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


export function showAgentTab(agentName) {
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


export async function loadAgentSettings() {
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


export async function loadTimeSettings() {
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


export async function loadSystemPrompt() {
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


export async function loadMemories() {
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


export function openSettings() {
  showSettingsView("home");
  closeDrawer();
  settingsPanel.hidden = false;
  settingsClose.focus();
}


export function closeSettings() {
  settingsPanel.hidden = true;
  showSettingsView("home");
  drawerSettings.focus();
}


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
  assignMemoryEnabled(memoryToggle.checked);
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
  assignCustomInstructions(customInstructionsInput.value.trim().slice(0, 2000));
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



