const composer = document.getElementById("composer");
const input = document.getElementById("messageInput");
const chat = document.getElementById("chat");

/* A conversa rola dentro de .feed; o composer fica fixo no rodapé. */
const feed = document.querySelector(".feed");

const micButton = document.getElementById("micButton");
const liveCallButton = document.getElementById("liveCallButton");
const liveCallPanel = document.getElementById("liveCallPanel");
const liveCallStatus = document.getElementById("liveCallStatus");
const liveCallTranscript = document.getElementById("liveCallTranscript");
const liveCallStartButton = document.getElementById("liveCallStart");
const liveCallEndButton = document.getElementById("liveCallEnd");
const liveCallCloseButton = document.getElementById("liveCallClose");
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
  voice: document.getElementById("settingsVoice"),
  memory: document.getElementById("settingsMemory"),
  instructions: document.getElementById("settingsInstructions"),
  reminders: document.getElementById("settingsReminders"),
  more: document.getElementById("settingsMore")
};
const speechToggle = document.getElementById("speechToggle");
const ttsSpeedSlider = document.getElementById("ttsSpeed");
const ttsSpeedValue = document.getElementById("ttsSpeedValue");
const memoryToggle = document.getElementById("memoryToggle");
const memoryList = document.getElementById("memoryList");
const memoryStatus = document.getElementById("memoryStatus");
const customInstructionsInput = document.getElementById("customInstructions");
const instructionStatus = document.getElementById("instructionStatus");
const reminderForm = document.getElementById("reminderForm");
const reminderTextInput = document.getElementById("reminderText");
const reminderAtInput = document.getElementById("reminderAt");
const reminderList = document.getElementById("reminderList");
const reminderStatus = document.getElementById("reminderStatus");
const reminderNotificationButton = document.getElementById("reminderNotification");

const MEMORY_KEY = "nexa_conversation";
const MESSAGE_KEY_STORAGE_PREFIX = "nexa_message_key:";
let CHATS_KEY = "nexa_chats";
let ACTIVE_CHAT_KEY = "nexa_active_chat";
const REASONING_KEY = "nexa_reasoning";
const SPEECH_KEY = "nexa_speech_enabled";
const TTS_SPEED_KEY = "nexa_tts_speed";
const MEMORY_ENABLED_KEY = "nexa_memory_enabled:";
const INSTRUCTIONS_KEY = "nexa_custom_instructions:";
const REMINDERS_KEY = "nexa_reminders:";

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
let ttsSpeed = 1;
let activeAudio = null;
let activeAudioRequest = null;

function stopSpeaking() {
  if (activeAudioRequest) {
    activeAudioRequest.abort();
    activeAudioRequest = null;
  }

  if (activeAudio) {
    const audioUrl = activeAudio.src;
    activeAudio.pause();
    activeAudio.removeAttribute("src");
    activeAudio.load();
    if (audioUrl.startsWith("blob:")) {
      URL.revokeObjectURL(audioUrl);
    }
    activeAudio = null;
  }
}

async function speakNexa(text) {
  if (!speechEnabled || !text) {
    return;
  }

  stopSpeaking();

  const cleanText = text
    .replace(/[*_`#]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  if (!cleanText) {
    return;
  }

  const controller = new AbortController();
  activeAudioRequest = controller;

  try {
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey
      },
      body: JSON.stringify({
        text: cleanText
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let data = {};
      try {
        data = await response.json();
      } catch {
        // Resposta sem JSON.
      }

      if (response.status === 401) {
        showAuth();
      }

      throw new Error(data.error || `Falha no áudio (HTTP ${response.status}).`);
    }

    const audioUrl = URL.createObjectURL(await response.blob());
    if (!speechEnabled || controller.signal.aborted) {
      URL.revokeObjectURL(audioUrl);
      return;
    }

    const audio = new Audio(audioUrl);
    audio.playbackRate = ttsSpeed;
    activeAudio = audio;

    function releaseAudio() {
      URL.revokeObjectURL(audioUrl);
      if (activeAudio === audio) {
        activeAudio = null;
      }
    }

    audio.addEventListener("ended", releaseAudio, { once: true });
    audio.addEventListener("error", releaseAudio, { once: true });
    await audio.play();
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Erro ao reproduzir voz da NEXA:", error);
    }
  } finally {
    if (activeAudioRequest === controller) {
      activeAudioRequest = null;
    }
  }
}

function loadSpeechSetting() {
  try {
    speechEnabled = localStorage.getItem(SPEECH_KEY) !== "false";
  } catch (error) {
    speechEnabled = true;
  }

  try {
    const savedSpeed = Number(localStorage.getItem(TTS_SPEED_KEY));
    ttsSpeed = Number.isFinite(savedSpeed) && savedSpeed >= 0.8 && savedSpeed <= 1.25
      ? savedSpeed
      : 1;
  } catch (error) {
    ttsSpeed = 1;
  }

  speechToggle.checked = speechEnabled;
  ttsSpeedSlider.value = String(ttsSpeed);
  ttsSpeedSlider.disabled = !speechEnabled;
  ttsSpeedValue.value = `${ttsSpeed.toFixed(1).replace(".", ",")}x`;
}

function saveSpeechSetting() {
  speechEnabled = speechToggle.checked;

  try {
    localStorage.setItem(SPEECH_KEY, String(speechEnabled));
  } catch (error) {
    console.error("Erro ao salvar configuração de voz:", error);
  }

  ttsSpeedSlider.disabled = !speechEnabled;

  if (!speechEnabled) {
    stopSpeaking();
  }
}

function saveTTSSettings() {
  ttsSpeed = Number(ttsSpeedSlider.value);

  try {
    localStorage.setItem(TTS_SPEED_KEY, String(ttsSpeed));
  } catch (error) {
    console.error("Erro ao salvar configuração de voz:", error);
  }

  ttsSpeedValue.value = `${ttsSpeed.toFixed(1).replace(".", ",")}x`;
}

function setLiveCallStatus(message) {
  liveCallStatus.textContent = message;
}

function addLiveTranscript(speaker, text) {
  if (!text || !text.trim()) {
    return;
  }

  const line = document.createElement("div");
  line.className = "live-call-line";

  const label = document.createElement("strong");
  label.textContent = speaker;

  const content = document.createElement("span");
  content.textContent = text.trim();

  line.append(label, content);
  liveCallTranscript.appendChild(line);
  liveCallTranscript.scrollTop = liveCallTranscript.scrollHeight;
}

function pcm16FromFloat(input, sampleRate) {
  const ratio = sampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const pcm = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(Math.floor((index + 1) * ratio), input.length);
    let sum = 0;

    for (let sample = start; sample < end; sample += 1) {
      sum += input[sample];
    }

    const value = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }

  return pcm;
}

function bytesToBase64(bytes) {
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function stopLivePlayback() {
  livePlaybackSources.forEach(source => {
    try {
      source.stop();
    } catch {
      // O áudio pode já ter terminado.
    }
  });

  livePlaybackSources.clear();
  livePlaybackTime = 0;
}

function queueLiveAudio(base64Data, mimeType) {
  if (!liveAudioContext || !base64Data) {
    return;
  }

  const binary = atob(base64Data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const sampleCount = Math.floor(bytes.byteLength / 2);
  if (!sampleCount) {
    return;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rateMatch = /rate=(\d+)/i.exec(mimeType || "");
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const audioBuffer = liveAudioContext.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);

  for (let index = 0; index < sampleCount; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 32768;
  }

  const source = liveAudioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(liveAudioContext.destination);
  source.onended = () => livePlaybackSources.delete(source);

  const startAt = Math.max(liveAudioContext.currentTime + 0.02, livePlaybackTime);
  source.start(startAt);
  livePlaybackTime = startAt + audioBuffer.duration;
  livePlaybackSources.add(source);
}

function startLiveMicrophone(socket) {
  if (!liveAudioContext || !liveCallStream) {
    throw new Error("O microfone não está disponível.");
  }

  liveMicSource = liveAudioContext.createMediaStreamSource(liveCallStream);
  liveMicProcessor = liveAudioContext.createScriptProcessor(4096, 1, 1);
  liveMicMute = liveAudioContext.createGain();
  liveMicMute.gain.value = 0;

  liveMicProcessor.onaudioprocess = event => {
    if (!liveCallReady || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const samples = pcm16FromFloat(
      event.inputBuffer.getChannelData(0),
      liveAudioContext.sampleRate
    );

    if (samples.length) {
      socket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: bytesToBase64(new Uint8Array(samples.buffer)),
            mimeType: "audio/pcm;rate=16000"
          }
        }
      }));
    }
  };

  liveMicSource.connect(liveMicProcessor);
  liveMicProcessor.connect(liveMicMute);
  liveMicMute.connect(liveAudioContext.destination);
}

function releaseLiveCall(status) {
  liveCallGeneration += 1;
  liveCallReady = false;

  if (liveCallSetupTimer) {
    clearTimeout(liveCallSetupTimer);
    liveCallSetupTimer = null;
  }

  if (liveTokenRequest) {
    liveTokenRequest.abort();
    liveTokenRequest = null;
  }

  const socket = liveCallSocket;
  liveCallSocket = null;
  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close(1000, "Call ended");
  }

  if (liveMicProcessor) {
    liveMicProcessor.disconnect();
    liveMicProcessor.onaudioprocess = null;
    liveMicProcessor = null;
  }
  if (liveMicSource) {
    liveMicSource.disconnect();
    liveMicSource = null;
  }
  if (liveMicMute) {
    liveMicMute.disconnect();
    liveMicMute = null;
  }

  if (liveCallStream) {
    liveCallStream.getTracks().forEach(track => track.stop());
    liveCallStream = null;
  }

  stopLivePlayback();
  if (liveAudioContext && liveAudioContext.state !== "closed") {
    liveAudioContext.close();
  }
  liveAudioContext = null;

  liveCallStartButton.hidden = false;
  liveCallStartButton.disabled = false;
  liveCallEndButton.hidden = true;
  liveCallButton.setAttribute("aria-pressed", "false");
  setLiveCallStatus(status || "Chamada encerrada");
}

function handleLiveServerMessage(socket, message) {
  if (message.setupComplete) {
    if (liveCallSetupTimer) {
      clearTimeout(liveCallSetupTimer);
      liveCallSetupTimer = null;
    }
    liveCallReady = true;
    liveCallStartButton.hidden = true;
    liveCallEndButton.hidden = false;
    liveCallButton.setAttribute("aria-pressed", "true");
    setLiveCallStatus("Conectado · pode falar");
    startLiveMicrophone(socket);
    return;
  }

  const content = message.serverContent;
  if (!content) {
    if (message.error) {
      throw new Error(message.error.message || "Erro na sessão Gemini Live.");
    }
    return;
  }

  if (content.inputTranscription?.text) {
    addLiveTranscript("Você", content.inputTranscription.text);
  }

  if (content.outputTranscription?.text) {
    addLiveTranscript("Gemini", content.outputTranscription.text);
  }

  if (content.interrupted) {
    stopLivePlayback();
  }

  const parts = content.modelTurn?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      queueLiveAudio(part.inlineData.data, part.inlineData.mimeType);
    }
    if (part.text) {
      addLiveTranscript("Gemini", part.text);
    }
  }
}

async function startLiveCall() {
  const generation = ++liveCallGeneration;
  stopSpeaking();
  liveCallStartButton.disabled = true;
  liveCallEndButton.hidden = false;
  setLiveCallStatus("Solicitando acesso ao microfone…");

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Este navegador não oferece suporte à reprodução de áudio.");
    }

    liveAudioContext = new AudioContextClass();
    await liveAudioContext.resume();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("O navegador não oferece acesso ao microfone nesta conexão.");
    }

    liveCallStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (generation !== liveCallGeneration) {
      liveCallStream.getTracks().forEach(track => track.stop());
      liveCallStream = null;
      return;
    }

    setLiveCallStatus("Conectando ao Gemini Live…");
    liveTokenRequest = new AbortController();
    const tokenResponse = await fetch("/api/live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey
      },
      body: "{}",
      signal: liveTokenRequest.signal
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      if (tokenResponse.status === 401) {
        showAuth();
      }
      throw new Error(tokenData.error || `Erro ao preparar chamada (HTTP ${tokenResponse.status}).`);
    }

    if (generation !== liveCallGeneration) {
      return;
    }

    const socketUrl = "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService." +
      "BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(tokenData.token);
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    liveCallSocket = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({
        setup: {
          model: tokenData.model || "models/gemini-3.8-live",
          generationConfig: { responseModalities: ["AUDIO"] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: {
            parts: [{ text: tokenData.systemInstruction }]
          }
        }
      }));
    };

    socket.onmessage = async event => {
      try {
        let payload = event.data;
        if (typeof Blob !== "undefined" && payload instanceof Blob) {
          payload = await payload.text();
        } else if (payload instanceof ArrayBuffer) {
          payload = new TextDecoder().decode(payload);
        }

        if (socket !== liveCallSocket) {
          return;
        }

        if (typeof payload !== "string") {
          throw new Error("O Gemini Live enviou um frame em formato desconhecido.");
        }

        handleLiveServerMessage(socket, JSON.parse(payload));
      } catch (error) {
        console.error("Erro ao processar Gemini Live:", error);
        if (liveCallSocket === socket) {
          releaseLiveCall(error.message || "Erro na chamada Gemini Live.");
        }
      }
    };

    socket.onerror = () => {
      setLiveCallStatus("Falha na conexão com o Gemini Live");
    };

    socket.onclose = event => {
      if (liveCallSocket === socket) {
        releaseLiveCall(event.reason || "Conexão encerrada");
      }
    };

    liveCallSetupTimer = setTimeout(() => {
      if (generation === liveCallGeneration && !liveCallReady) {
        releaseLiveCall("Tempo esgotado ao conectar ao Gemini Live");
      }
    }, 20000);

    setLiveCallStatus("Aguardando conexão segura…");
  } catch (error) {
    if (generation === liveCallGeneration) {
      releaseLiveCall(error.name === "AbortError" ? "Chamada cancelada" : error.message);
    }
  } finally {
    liveTokenRequest = null;
  }
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
  // Só atualiza o título se for o padrão "Nova conversa" ou se foi gerado automaticamente da primeira mensagem
  // Não sobrescreve títulos gerados pela IA
  const isDefaultTitle = chat.title === "Nova conversa" || chat.title === chatTitle(chat.messages);
  if (isDefaultTitle) {
    chat.title = chatTitle(chat.messages);
  }
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

  let pendingText = "";
  let renderFrame = null;

  function flushText() {
    if (renderFrame !== null) {
      cancelAnimationFrame(renderFrame);
      renderFrame = null;
    }

    if (!pendingText) {
      return;
    }

    paragraph.appendChild(
      document.createTextNode(pendingText)
    );
    pendingText = "";

    if (feed) {
      feed.scrollTop = feed.scrollHeight;
    }
  }

  function appendText(chunk) {
    pendingText += chunk;

    if (renderFrame === null) {
      renderFrame = requestAnimationFrame(flushText);
    }
  }

  return {
    message,
    appendText,
    flushText,
    thinking
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
  loadReminders();
}

function showSettingsView(viewName) {
  const titles = {
    home: "Configurações",
    voice: "Voz",
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

  if (viewName === "memory") {
    loadMemories();
  } else if (viewName === "instructions") {
    customInstructionsInput.value = customInstructions;
  } else if (viewName === "reminders") {
    const localNow = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    reminderAtInput.min = localNow.toISOString().slice(0, 16);
    renderReminderList();
  }
}

async function loadMemories() {
  memoryList.replaceChildren();
  memoryStatus.textContent = "Carregando…";

  try {
    const data = await api("GET", "/api/memories");
    memoryList.replaceChildren();

    if (!data.memories.length) {
      const empty = document.createElement("p");
      empty.className = "settings-status";
      empty.textContent = "Nenhuma memória salva.";
      memoryList.appendChild(empty);
      memoryStatus.textContent = "";
      return;
    }

    data.memories.forEach(memory => {
      const row = document.createElement("div");
      row.className = "settings-item";

      const copy = document.createElement("div");
      copy.className = "settings-item-copy";
      copy.textContent = memory.memory;

      const date = document.createElement("small");
      date.textContent = memory.created_at || "";
      copy.appendChild(date);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "settings-item-delete";
      remove.textContent = "Apagar";
      remove.setAttribute("aria-label", "Apagar memória");
      remove.addEventListener("click", async function () {
        try {
          await api("DELETE", `/api/memories/${memory.id}`);
          await loadMemories();
        } catch (error) {
          memoryStatus.textContent = error.message;
        }
      });

      row.append(copy, remove);
      memoryList.appendChild(row);
    });

    memoryStatus.textContent = `${data.memories.length} memória(s)`;
  } catch (error) {
    memoryStatus.textContent = error.message;
  }
}

function saveReminderData() {
  try {
    localStorage.setItem(
      accountSettingKey(REMINDERS_KEY),
      JSON.stringify(reminders)
    );
  } catch (error) {
    reminderStatus.textContent = "Não foi possível salvar os lembretes.";
  }
}

function renderReminderList() {
  reminderList.replaceChildren();

  if (!reminders.length) {
    const empty = document.createElement("p");
    empty.className = "settings-status";
    empty.textContent = "Nenhum lembrete programado.";
    reminderList.appendChild(empty);
    return;
  }

  reminders
    .slice()
    .sort((first, second) => first.at - second.at)
    .forEach(reminder => {
      const row = document.createElement("div");
      row.className = "settings-item";

      const copy = document.createElement("div");
      copy.className = "settings-item-copy";
      copy.textContent = reminder.text;

      const date = document.createElement("small");
      date.textContent = new Date(reminder.at).toLocaleString("pt-BR");
      copy.appendChild(date);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "settings-item-delete";
      remove.textContent = "Apagar";
      remove.addEventListener("click", function () {
        const timer = reminderTimers.get(reminder.id);
        if (timer) {
          clearTimeout(timer);
          reminderTimers.delete(reminder.id);
        }
        reminders = reminders.filter(item => item.id !== reminder.id);
        saveReminderData();
        renderReminderList();
      });

      row.append(copy, remove);
      reminderList.appendChild(row);
    });
}

function scheduleReminder(reminder) {
  const delay = Math.max(0, reminder.at - Date.now());
  const timer = setTimeout(function () {
    reminderTimers.delete(reminder.id);

    if (Date.now() < reminder.at) {
      scheduleReminder(reminder);
      return;
    }

    reminders = reminders.filter(item => item.id !== reminder.id);
    saveReminderData();
    renderReminderList();

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Lembrete da NEXA", { body: reminder.text });
    } else {
      addMessage("Lembrete: " + reminder.text, "nexa");
    }
  }, Math.min(delay, 2147483000));

  reminderTimers.set(reminder.id, timer);
}

function loadReminders() {
  reminderTimers.forEach(timer => clearTimeout(timer));
  reminderTimers.clear();

  try {
    const saved = JSON.parse(
      localStorage.getItem(accountSettingKey(REMINDERS_KEY)) || "[]"
    );
    reminders = Array.isArray(saved)
      ? saved.filter(item => item && typeof item.id === "string" &&
        typeof item.text === "string" && Number.isFinite(item.at))
      : [];
  } catch (error) {
    reminders = [];
  }

  reminders.forEach(scheduleReminder);
  renderReminderList();
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

    /*
      Para qualquer fala anterior.
    */

    stopSpeaking();

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
            saveChats();
            renderChatList();
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

speechToggle.addEventListener(
  "change",
  saveSpeechSetting
);

ttsSpeedSlider.addEventListener(
  "input",
  saveTTSSettings
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

document.getElementById("memoryClear").addEventListener("click", async function () {
  if (!confirm("Apagar todas as memórias salvas para esta conta?")) {
    return;
  }

  try {
    await api("DELETE", "/api/memories");
    await loadMemories();
    memoryStatus.textContent = "Todas as memórias foram apagadas.";
  } catch (error) {
    memoryStatus.textContent = error.message;
  }
});

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

reminderForm.addEventListener("submit", function (event) {
  event.preventDefault();
  const text = reminderTextInput.value.trim();
  const at = new Date(reminderAtInput.value).getTime();

  if (!text || !Number.isFinite(at) || at <= Date.now()) {
    reminderStatus.textContent = "Escolha uma data e hora futuras.";
    return;
  }

  const reminder = { id: makeId(), text, at };
  reminders.push(reminder);
  saveReminderData();
  scheduleReminder(reminder);
  renderReminderList();
  reminderForm.reset();
  reminderStatus.textContent = "Lembrete programado.";
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

document.getElementById("clearChats").addEventListener("click", function () {
  if (!confirm("Apagar todas as conversas deste usuário neste navegador?")) {
    return;
  }

  chats = [];
  history.length = 0;
  activeChatId = "";
  startNewChat();
  settingsPanel.hidden = true;
  input.focus();
});

function closeLiveCallDialog() {
  releaseLiveCall("Chamada encerrada");
  liveCallPanel.hidden = true;
  liveCallButton.focus();
}

liveCallButton.addEventListener("click", function () {
  liveCallTranscript.replaceChildren();
  setLiveCallStatus("Pronto para iniciar");
  liveCallPanel.hidden = false;
  liveCallStartButton.focus();
});

liveCallStartButton.addEventListener("click", startLiveCall);
liveCallEndButton.addEventListener("click", function () {
  releaseLiveCall("Chamada encerrada");
});
liveCallCloseButton.addEventListener("click", closeLiveCallDialog);

liveCallPanel.addEventListener("click", function (event) {
  if (event.target === liveCallPanel) {
    closeLiveCallDialog();
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

    if (!liveCallPanel.hidden) {
      closeLiveCallDialog();
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

function bootApp() {
  loadChats();
  renderChat();
  renderChatList();
  loadSpeechSetting();
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
let reminders = [];
const reminderTimers = new Map();
let liveCallSocket = null;
let liveCallStream = null;
let liveAudioContext = null;
let liveMicProcessor = null;
let liveMicSource = null;
let liveMicMute = null;
let liveTokenRequest = null;
let liveCallGeneration = 0;
let liveCallReady = false;
let livePlaybackTime = 0;
let livePlaybackSources = new Set();
let liveCallSetupTimer = null;

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
    throw new Error(
      data.error || `Erro (HTTP ${response.status}).`
    );
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
