/**
 * Ponte nativa Android: voz, escuta em segundo plano e teclado
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { composer, input, micButton, scrollConversationToBottom, sendButton } from "./dom.js";
import { addMessage } from "./messages.js";
import { assignNativeVoicePending, nativeVoicePending } from "./state.js";

export function nativeListen() {
  return window.NexaNative || null;
}


export function notifyNativeVoice(text, failed) {
  if (!nativeVoicePending) {
    return;
  }

  assignNativeVoicePending(false);

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


window.NexaVoice = {
  ask(text) {
    const clean = typeof text === "string" ? text.trim() : "";

    if (!clean || nativeVoicePending || sendButton.disabled) {
      return false;
    }

    assignNativeVoicePending(true);
    input.value = clean;
    composer.dispatchEvent(new Event("submit", { cancelable: true }));

    return true;
  },
};


export function renderListenStatus(active) {
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


export function loadListenSettings() {
  const bridge = nativeListen();
  let active = false;

  try {
    active = Boolean(bridge && bridge.isListeningServiceActive());
  } catch (error) {
    active = false;
  }

  renderListenStatus(active);
}


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


window.addEventListener(
  "nativeKeyboardChange",
  function (event) {
    const detail = event.detail || {};

    if (detail.visible) {
      scrollConversationToBottom();
    }
  }
);


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



