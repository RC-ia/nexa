/**
 * Preferências: reforço de raciocínio, pesquisa profunda e modo safadinho
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { DEEP_MODE_KEY, REASONING_ALIASES, REASONING_KEY, REASONING_LABELS, REASONING_LEVELS, SPICY_MODE_KEY } from "./constants.js";
import { imageSpicyButton } from "./dom.js";
import { assignDeepMode, assignReasoningLevel, assignSpicyMode, currentUser, deepMode, reasoningLevel, spicyMode, viewMode } from "./state.js";

export function loadReasoning() {
  assignReasoningLevel("none");

  try {
    const saved =
      localStorage.getItem(REASONING_KEY);

    const normalized = REASONING_ALIASES[saved] || saved;
    if (
      normalized &&
      REASONING_LABELS.hasOwnProperty(normalized)
    ) {
      assignReasoningLevel(normalized);
    }
  } catch (error) {
    console.error(
      "Erro ao carregar reforço de raciocínio:",
      error
    );
  }
}


export function saveReasoning() {
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


export function renderReasoning() {
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
      "Rápido";
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


export function setupReasoningUI() {
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

      assignReasoningLevel(item.dataset.reasoning || "none");

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


export function renderDeepMode() {
  const button =
    document.getElementById("attachButton");
  const option =
    document.getElementById("attachDeep");
  const input =
    document.getElementById("messageInput");

  if (button) {
    button.classList.toggle("active", deepMode);

    button.setAttribute(
      "aria-pressed",
      deepMode ? "true" : "false"
    );
  }

  if (option) {
    option.classList.toggle("active", deepMode);

    option.setAttribute(
      "aria-checked",
      deepMode ? "true" : "false"
    );
  }

  if (input) {
    input.placeholder = deepMode
      ? "Descreva o tema da pesquisa profunda..."
      : "Digite uma mensagem...";
  }
}


export function deepModeStorageKey() {
  return DEEP_MODE_KEY + (currentUser ? currentUser.id : "anonymous");
}


export function loadDeepMode() {
  try {
    assignDeepMode(localStorage.getItem(deepModeStorageKey()) === "true");
  } catch (error) {
    assignDeepMode(false);
  }
}


export function saveDeepMode() {
  try {
    localStorage.setItem(deepModeStorageKey(), deepMode ? "true" : "false");
  } catch (error) {
    console.error("Erro ao salvar o modo de pesquisa profunda:", error);
  }
}


export function setDeepMode(isOn) {
  assignDeepMode(isOn === true);
  saveDeepMode();
  renderDeepMode();
}


export function spicyModeStorageKey() {
  return SPICY_MODE_KEY + (currentUser ? currentUser.id : "anonymous");
}


export function loadSpicyMode() {
  try {
    assignSpicyMode(localStorage.getItem(spicyModeStorageKey()) === "true");
  } catch (error) {
    assignSpicyMode(false);
  }
}


export function saveSpicyMode() {
  try {
    localStorage.setItem(spicyModeStorageKey(), spicyMode ? "true" : "false");
  } catch (error) {
    console.error("Erro ao salvar o modo safadinho:", error);
  }
}


export function renderSpicyMode() {
  /*
    O safadinho pertence só ao modo imagem (agente de prompt de imagem):
    o tema vermelho-sangue entra apenas quando a aba de imagens está
    ativa — no chat normal o site segue no tom normal.
  */
  document.body.classList.toggle(
    "spicy",
    spicyMode === true && viewMode === "image"
  );

  const button = document.getElementById("imageSpicyButton");

  if (button) {
    button.classList.toggle("active", spicyMode === true);
    button.setAttribute("aria-pressed", spicyMode ? "true" : "false");
  }
}


export function setSpicyMode(isOn) {
  assignSpicyMode(isOn === true);
  saveSpicyMode();
  renderSpicyMode();
}


if (imageSpicyButton) {
  imageSpicyButton.addEventListener("click", () => setSpicyMode(!spicyMode));
}



