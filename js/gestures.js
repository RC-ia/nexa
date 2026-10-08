/**
 * Gestos: swipe, redimensionamento de painéis e bolinha de puxar
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { startNewChat } from "./chats.js";
import { authPanel, feed, sendButton } from "./dom.js";
import { closeDrawer, openDrawer } from "./drawer.js";
import { drawerOpen } from "./state.js";

(function () {
  const SIDE_MIN = 70;
  const PULL_MIN = 90;
  const PULL_ZONE = 0.6;

  const pullBall = document.getElementById("pullBall");

  let startX = 0;
  let startY = 0;
  let tracking = false;
  let pullTracking = false;

  function setPullProgress(progress) {
    if (!pullBall) {
      return;
    }

    pullBall.hidden = false;
    pullBall.style.opacity = String(0.35 + 0.65 * progress);
    pullBall.style.transform =
      "scale(" + (0.55 + 0.45 * progress) + ")";
    pullBall.classList.toggle("ready", progress >= 1);
  }

  function resetPull() {
    pullTracking = false;

    if (pullBall) {
      pullBall.classList.remove("ready");
      pullBall.hidden = true;
    }
  }

  function atConversationEnd() {
    return (
      feed.scrollTop + feed.clientHeight >=
      feed.scrollHeight - 4
    );
  }

  document.addEventListener(
    "touchstart",
    function (event) {
      const target = event.target;

      if (
        event.touches.length !== 1 ||
        (target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.tagName === "SELECT"))
      ) {
        tracking = false;
        pullTracking = false;
        return;
      }

      tracking = true;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;

      pullTracking =
        authPanel.hidden &&
        !drawerOpen &&
        !sendButton.disabled &&
        startY >= window.innerHeight * PULL_ZONE &&
        atConversationEnd();
    },
    { passive: true }
  );

  document.addEventListener(
    "touchmove",
    function (event) {
      if (!pullTracking || event.touches.length !== 1) {
        return;
      }

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (-dy <= 0 || -dy < 2 * Math.abs(dx)) {
        return;
      }

      setPullProgress(
        Math.min(1, -dy / PULL_MIN)
      );
    },
    { passive: true }
  );

  document.addEventListener(
    "touchend",
    function (event) {
      if (!tracking) {
        resetPull();
        return;
      }

      tracking = false;

      const touch =
        event.changedTouches &&
        event.changedTouches[0];

      if (!touch || !authPanel.hidden) {
        resetPull();
        return;
      }

      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      if (
        Math.abs(dx) >= SIDE_MIN &&
        Math.abs(dx) >= 2 * Math.abs(dy)
      ) {
        resetPull();

        if (dx > 0) {
          if (!drawerOpen) {
            openDrawer();
          }
        } else if (drawerOpen) {
          closeDrawer();
        } else {
          window.location.href = "/live.html";
        }

        return;
      }

      /* Para cima só vale no fim da conversa, puxando pela parte de baixo. */
      const pulled =
        pullTracking &&
        -dy >= PULL_MIN &&
        -dy >= 2 * Math.abs(dx) &&
        atConversationEnd();

      resetPull();

      if (pulled) {
        startNewChat();
      }
    },
    { passive: true }
  );
})();



