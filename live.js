const startButton = document.getElementById("liveStart");
const endButton = document.getElementById("liveEnd");
const statusLabel = document.getElementById("liveStatus");
const visual = document.getElementById("liveVisual");

const LIVE_VOICE_KEY = "nexa_live_voice";
const FALLBACK_VOICE = "Kore";

/*
  A voz é escolhida em Configurações > Chamada; aqui só lemos a
  preferência salva. Se o servidor recusar, caímos na voz padrão.
*/
function selectedVoice() {
  let saved = "";
  try {
    saved = localStorage.getItem(LIVE_VOICE_KEY) || "";
  } catch {
    saved = "";
  }
  return saved.trim() || FALLBACK_VOICE;
}

let accountMessageKey = "";
let socket = null;
let mediaStream = null;
let audioContext = null;
let micSource = null;
let micProcessor = null;
let silentGain = null;
let tokenRequest = null;
let setupTimeout = null;
let callGeneration = 0;
let sessionReady = false;
let playbackTime = 0;
const playbackSources = new Set();

function setStatus(message, state) {
  statusLabel.textContent = message;
  visual.dataset.state = state || "idle";
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

function stopPlayback() {
  playbackSources.forEach(source => {
    try {
      source.stop();
    } catch {
      // O bloco pode já ter terminado.
    }
  });
  playbackSources.clear();
  playbackTime = 0;
}

function queueAudio(base64Data, mimeType) {
  if (!audioContext || !base64Data) {
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

  const rateMatch = /rate=(\d+)/i.exec(mimeType || "");
  const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const buffer = audioContext.createBuffer(1, sampleCount, sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < sampleCount; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 32768;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => playbackSources.delete(source);

  const startAt = Math.max(audioContext.currentTime + 0.02, playbackTime);
  source.start(startAt);
  playbackTime = startAt + buffer.duration;
  playbackSources.add(source);
}

function startMicrophone(activeSocket) {
  if (!audioContext || !mediaStream) {
    throw new Error("O microfone não está disponível.");
  }

  micSource = audioContext.createMediaStreamSource(mediaStream);
  micProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  micProcessor.onaudioprocess = event => {
    if (!sessionReady || activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const pcm = pcm16FromFloat(
      event.inputBuffer.getChannelData(0),
      audioContext.sampleRate
    );
    if (pcm.length) {
      activeSocket.send(JSON.stringify({
        realtimeInput: {
          audio: {
            data: bytesToBase64(new Uint8Array(pcm.buffer)),
            mimeType: "audio/pcm;rate=16000"
          }
        }
      }));
    }
  };

  micSource.connect(micProcessor);
  micProcessor.connect(silentGain);
  silentGain.connect(audioContext.destination);
}

function endCall(message) {
  callGeneration += 1;
  sessionReady = false;

  if (setupTimeout) {
    clearTimeout(setupTimeout);
    setupTimeout = null;
  }
  if (tokenRequest) {
    tokenRequest.abort();
    tokenRequest = null;
  }

  const activeSocket = socket;
  socket = null;
  if (activeSocket && activeSocket.readyState < WebSocket.CLOSING) {
    activeSocket.close(1000, "Call ended");
  }

  if (micProcessor) {
    micProcessor.disconnect();
    micProcessor.onaudioprocess = null;
    micProcessor = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (silentGain) {
    silentGain.disconnect();
    silentGain = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  stopPlayback();
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
  }
  audioContext = null;

  startButton.hidden = false;
  startButton.disabled = false;
  endButton.hidden = true;
  setStatus(message || "Chamada encerrada", "idle");
}

function handleServerMessage(activeSocket, message) {
  if (message.setupComplete) {
    if (setupTimeout) {
      clearTimeout(setupTimeout);
      setupTimeout = null;
    }
    sessionReady = true;
    startButton.hidden = true;
    endButton.hidden = false;
    setStatus("Conectado · pode falar", "listening");
    startMicrophone(activeSocket);
    return;
  }

  if (message.error) {
    throw new Error(message.error.message || "Erro na sessão Gemini Live.");
  }

  const content = message.serverContent;
  if (!content) {
    return;
  }

  if (content.interrupted) {
    stopPlayback();
    setStatus("Conectado · pode falar", "listening");
  }

  for (const part of content.modelTurn?.parts || []) {
    if (part.inlineData?.data) {
      queueAudio(part.inlineData.data, part.inlineData.mimeType);
      setStatus("Gemini está falando…", "speaking");
    }
  }
  if (content.turnComplete) {
    setStatus("Conectado · pode falar", "listening");
  }
}

async function startCall() {
  const generation = ++callGeneration;
  startButton.disabled = true;
  endButton.hidden = false;
  setStatus("Solicitando acesso ao microfone…", "connecting");

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("Este navegador não oferece suporte a áudio em tempo real.");
    }
    audioContext = new AudioContextClass();
    await audioContext.resume();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("O navegador não oferece acesso ao microfone nesta conexão.");
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (generation !== callGeneration) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
      return;
    }

    setStatus("Conectando ao Gemini Live…", "connecting");
    tokenRequest = new AbortController();
    const tokenResponse = await fetch("/api/live/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": accountMessageKey
      },
      body: JSON.stringify({
        voice: selectedVoice()
      }),
      signal: tokenRequest.signal
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok) {
      if (tokenResponse.status === 401) {
        localStorage.removeItem("nexa_message_key:" + accountUsername);
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        location.replace("/");
      }
      throw new Error(tokenData.error || `Falha ao preparar chamada (HTTP ${tokenResponse.status}).`);
    }
    if (generation !== callGeneration) {
      return;
    }

    const socketUrl = "wss://generativelanguage.googleapis.com/ws/" +
      "google.ai.generativelanguage.v1beta.GenerativeService." +
      "BidiGenerateContentConstrained?access_token=" +
      encodeURIComponent(tokenData.token);
    const activeSocket = new WebSocket(socketUrl);
    activeSocket.binaryType = "arraybuffer";
    socket = activeSocket;

    activeSocket.onopen = () => {
      activeSocket.send(JSON.stringify({
        setup: {
          model: tokenData.model || "models/gemini-3.8-live",
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: tokenData.voice || "Kore" }
              }
            }
          },
          systemInstruction: { parts: [{ text: tokenData.systemInstruction }] }
        }
      }));
    };

    activeSocket.onmessage = async event => {
      try {
        let payload = event.data;
        if (typeof Blob !== "undefined" && payload instanceof Blob) {
          payload = await payload.text();
        } else if (payload instanceof ArrayBuffer) {
          payload = new TextDecoder().decode(payload);
        }
        if (activeSocket !== socket) {
          return;
        }
        if (typeof payload !== "string") {
          throw new Error("O Gemini Live enviou um frame em formato desconhecido.");
        }
        handleServerMessage(activeSocket, JSON.parse(payload));
      } catch (error) {
        console.error("Erro ao processar Gemini Live:", error);
        if (activeSocket === socket) {
          endCall(error.message || "Erro na chamada Gemini Live.");
        }
      }
    };

    activeSocket.onerror = () => {
      setStatus("Falha na conexão com o Gemini Live", "error");
    };
    activeSocket.onclose = event => {
      if (activeSocket === socket) {
        endCall(event.reason || "Conexão encerrada");
      }
    };
    setupTimeout = setTimeout(() => {
      if (generation === callGeneration && !sessionReady) {
        endCall("Tempo esgotado ao conectar ao Gemini Live");
      }
    }, 20000);
    setStatus("Aguardando conexão segura…", "connecting");
  } catch (error) {
    if (generation === callGeneration) {
      endCall(error.name === "AbortError" ? "Chamada cancelada" : error.message);
    }
  } finally {
    tokenRequest = null;
  }
}

async function initializeLivePage() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      location.replace("/");
      return;
    }

    const data = await response.json();
    accountUsername = data.user.username;
    accountMessageKey = localStorage.getItem("nexa_message_key:" + accountUsername) || "";
    if (!accountMessageKey) {
      location.replace("/");
      return;
    }

    startButton.disabled = false;
    setStatus("Pronto para iniciar", "idle");
  } catch (error) {
    setStatus("Não foi possível verificar sua sessão", "error");
  }
}

let accountUsername = "";
startButton.addEventListener("click", startCall);
endButton.addEventListener("click", () => endCall("Chamada encerrada"));
window.addEventListener("pagehide", () => endCall("Chamada encerrada"));
initializeLivePage();

/*
  ==========================================
  GESTOS NA TELA
  ==========================================
  Puxar para a esquerda volta para a conversa.
*/

(function () {
  const SIDE_MIN = 70;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  document.addEventListener(
    "touchstart",
    function (event) {
      if (event.touches.length !== 1) {
        tracking = false;
        return;
      }

      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    function (event) {
      if (!tracking) {
        return;
      }

      tracking = false;

      const touch =
        event.changedTouches &&
        event.changedTouches[0];

      if (!touch) {
        return;
      }

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (-dx >= SIDE_MIN && -dx >= 2 * Math.abs(dy)) {
        window.location.href = "/";
      }
    },
    { passive: true }
  );
})();
