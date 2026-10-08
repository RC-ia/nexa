/**
 * Gaveta lateral e botões do cabeçalho
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { renderChatList, startNewChat } from "./chats.js";
import { DRAWER_KEY } from "./constants.js";
import { app, drawerClose, drawerNewChat, drawerScrim, drawerToggle, liveCallButton, studioButton } from "./dom.js";
import { startNewImageChat } from "./images.js";
import { assignDrawerOpen, drawerOpen, viewMode } from "./state.js";

export function openDrawer() {
  if (drawerOpen) {
    return;
  }

  assignDrawerOpen(true);
  app.classList.add("drawer-open");
  drawerScrim.hidden = false;

  try {
    localStorage.setItem(DRAWER_KEY, "open");
  } catch (error) {
    /* preferência de layout */
  }

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


export function closeDrawer() {
  if (!drawerOpen) {
    return;
  }

  assignDrawerOpen(false);
  app.classList.remove("drawer-open");
  drawerScrim.hidden = true;

  try {
    localStorage.setItem(DRAWER_KEY, "closed");
  } catch (error) {
    /* preferência de layout */
  }

  drawerToggle.setAttribute(
    "aria-expanded",
    "false"
  );

  drawerToggle.setAttribute(
    "aria-label",
    "Abrir menu"
  );
}


drawerNewChat.addEventListener(
  "click",
  function () {
    if (viewMode === "image") {
      startNewImageChat();
      return;
    }

    startNewChat();
  }
);


if (studioButton) {
  studioButton.addEventListener("click", () => {
    window.location.assign("/studio.html");
  });
}


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


liveCallButton.addEventListener("click", function () {
  window.location.assign("/live.html");
});


export function restoreDrawerPreference() {
  let open = false;

  try {
    const saved = localStorage.getItem(DRAWER_KEY);
    open = saved === "open" ||
      (saved === null &&
        window.matchMedia("(min-width: 1025px)").matches);
  } catch (error) {
    open = false;
  }

  if (!open) {
    return;
  }

  assignDrawerOpen(true);
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
}



