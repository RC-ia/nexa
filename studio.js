const chat = document.getElementById("chat");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const statusLabel = document.getElementById("studioStatus");
const filesPane = document.getElementById("filesPane");
const fileList = document.getElementById("fileList");
const fileView = document.getElementById("fileView");
const filesToggle = document.getElementById("filesToggle");
const filesRefresh = document.getElementById("filesRefresh");
const filesClose = document.getElementById("filesClose");
const filesResize = document.getElementById("filesResize");

const HISTORY_KEY = "nexa_studio_history";
const HISTORY_LIMIT = 40;
const KEY_PREFIX = "nexa_message_key:";
const WIDTH_KEY = "nexa_studio_files_width";

let accountUsername = "";
let messageKey = "";
let history = [];
let busy = false;

function setStatus(text) {
  statusLabel.textContent = text;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMarkdown(text) {
  const blocks = escapeHtml(text).split("```");
  let out = "";

  for (let index = 0; index < blocks.length; index += 1) {
    if (index % 2 === 1) {
      const body = blocks[index].replace(/^[^\n]*\n/, "").replace(/\n$/, "");
      out += "<pre><code>" + body + "</code></pre>";
    } else {
      out += blocks[index]
        .replace(/`([^`\n]+)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
    }
  }

  return out;
}

function scrollDown() {
  chat.scrollTop = chat.scrollHeight;
}

function addMessage(role, text, note) {
  const article = document.createElement("article");
  article.className = "message message-" + role + (note ? " message-note" : "");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "user") {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = renderMarkdown(text);
  }

  article.appendChild(bubble);
  chat.appendChild(article);
  scrollDown();

  return { article, bubble };
}

function describeTool(event) {
  const labels = {
    listar_arquivos: "Listou arquivos",
    ler_arquivo: "Leu",
    escrever_arquivo: "Salvou",
    salvar_memoria: "Anotou na memória",
  };

  const label = labels[event.name] || "Usou " + event.name;
  return event.detail ? label + " " + event.detail : label;
}

function trimHistory() {
  if (history.length > HISTORY_LIMIT) {
    history = history.slice(-HISTORY_LIMIT);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    /* sem espaço no navegador */
  }
}

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    history = Array.isArray(stored) ? stored.slice(-HISTORY_LIMIT) : [];
  } catch (error) {
    history = [];
  }

  for (const message of history) {
    addMessage(
      message.role === "user" ? "user" : "assistant",
      String(message.content || "")
    );
  }
}

async function sendMessage(text) {
  const clean = text.trim();

  if (!clean || busy) {
    return;
  }

  busy = true;
  input.value = "";
  setStatus("Pensando…");

  addMessage("user", clean);
  history.push({ role: "user", content: clean });
  trimHistory();

  const historyBefore = history.slice(0, -1);
  const { article, bubble } = addMessage("assistant", "");
  let fullText = "";

  const handleEvent = (payload) => {
    if (payload.type === "text") {
      fullText += payload.text;
      bubble.innerHTML = renderMarkdown(fullText);
      scrollDown();
    } else if (payload.type === "tool") {
      addMessage("assistant", "⚙ " + describeTool(payload), true);
    } else if (payload.type === "error") {
      fullText += (fullText ? "\n\n" : "") + (payload.error || "Deu erro.");
      bubble.innerHTML = renderMarkdown(fullText);
    }
  };

  try {
    const response = await fetch("/api/studio/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexa-Message-Key": messageKey,
      },
      body: JSON.stringify({ message: clean, messages: historyBefore }),
    });

    if (response.status === 401) {
      localStorage.removeItem(KEY_PREFIX + accountUsername);
      location.replace("/");
      return;
    }

    if (!response.ok || !response.body) {
      let reason = "O Estúdio não respondeu (HTTP " + response.status + ").";

      try {
        const data = await response.json();
        reason = data.error || reason;
      } catch (error) {
        /* resposta sem JSON */
      }

      throw new Error(reason);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separator = buffer.indexOf("\n\n");

      while (separator !== -1) {
        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        for (const line of chunk.split("\n")) {
          if (!line.startsWith("data:")) {
            continue;
          }

          try {
            handleEvent(JSON.parse(line.slice(5).trim()));
          } catch (error) {
            /* linha parcial ou inválida */
          }
        }

        separator = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    fullText += (fullText ? "\n\n" : "") + "⚠ " + error.message;
    bubble.innerHTML = renderMarkdown(fullText);
  }

  if (!fullText.trim()) {
    article.remove();
  } else {
    history.push({ role: "assistant", content: fullText });
    trimHistory();
    saveHistory();
  }

  busy = false;
  setStatus("Pronto");
  refreshFiles();
}

async function refreshFiles() {
  try {
    const response = await fetch("/api/studio/files", {
      headers: { "X-Nexa-Message-Key": messageKey },
    });

    if (!response.ok) {
      return;
    }

    const data = await response.json();
    fileList.textContent = "";

    if (!data.files || !data.files.length) {
      const item = document.createElement("li");
      item.className = "studio-empty";
      item.textContent = "Nada por aqui ainda. Peça alguma coisa!";
      fileList.appendChild(item);
      return;
    }

    for (const file of data.files) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = file.caminho;
      button.title = file.tamanho + " bytes";
      button.addEventListener("click", () => openFile(file.caminho));
      item.appendChild(button);
      fileList.appendChild(item);
    }
  } catch (error) {
    /* sem conexão */
  }
}

async function openFile(caminho) {
  fileView.hidden = false;
  fileView.textContent = "Abrindo…";

  try {
    const response = await fetch(
      "/api/studio/file?caminho=" + encodeURIComponent(caminho),
      { headers: { "X-Nexa-Message-Key": messageKey } }
    );
    const data = await response.json();

    if (!response.ok) {
      fileView.textContent = data.error || "Não deu para abrir.";
      return;
    }

    fileView.textContent = data.conteudo;
  } catch (error) {
    fileView.textContent = "Não deu para abrir: " + error.message;
  }
}

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

function setPaneOpen(open) {
  filesPane.hidden = !open;
  document.body.classList.toggle("files-open", open);

  if (open) {
    refreshFiles();
  }
}

filesToggle.addEventListener("click", () => {
  setPaneOpen(filesPane.hidden);
});

filesClose.addEventListener("click", () => {
  setPaneOpen(false);
  fileView.hidden = true;
});

filesRefresh.addEventListener("click", refreshFiles);

let resizing = false;

filesResize.addEventListener("pointerdown", (event) => {
  resizing = true;
  filesResize.setPointerCapture(event.pointerId);
  event.preventDefault();
});

filesResize.addEventListener("pointermove", (event) => {
  if (!resizing) {
    return;
  }

  const width = Math.min(Math.max(event.clientX, 200), window.innerWidth * 0.7);
  document.documentElement.style.setProperty("--files-width", width + "px");
});

filesResize.addEventListener("pointerup", () => {
  resizing = false;

  try {
    localStorage.setItem(
      WIDTH_KEY,
      document.documentElement.style.getPropertyValue("--files-width")
    );
  } catch (error) {
    /* sem espaço no navegador */
  }
});

try {
  const savedWidth = localStorage.getItem(WIDTH_KEY);

  if (savedWidth) {
    document.documentElement.style.setProperty("--files-width", savedWidth);
  }
} catch (error) {
  /* sem localStorage */
}

async function initializeStudio() {
  try {
    const response = await fetch("/api/auth/me");

    if (!response.ok) {
      location.replace("/");
      return;
    }

    const data = await response.json();
    accountUsername = data.user.username;
    messageKey = localStorage.getItem(KEY_PREFIX + accountUsername) || "";

    if (!messageKey) {
      location.replace("/");
      return;
    }

    setStatus("Pronto");
    loadHistory();
    refreshFiles();
  } catch (error) {
    setStatus("Sem conexão");
  }
}

initializeStudio();
