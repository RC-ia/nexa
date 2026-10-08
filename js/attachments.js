/**
 * Anexos: imagens e arquivos (preview, leitura, drag & drop)
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { ALLOWED_FILE_EXTENSIONS, MAX_FILE_BYTES, MAX_IMAGE_BYTES } from "./constants.js";
import { input } from "./dom.js";
import { setDeepMode } from "./preferences.js";
import { assignImageMode, assignPendingFile, assignPendingImage, deepMode, imageMode, pendingFile, pendingImage } from "./state.js";

export function renderImageMode() {
  const option =
    document.getElementById("attachGen");
  const input =
    document.getElementById("messageInput");

  if (option) {
    option.classList.toggle("active", imageMode);

    option.setAttribute(
      "aria-checked",
      imageMode ? "true" : "false"
    );
  }

  if (input && !pendingImage && !pendingFile) {
    input.placeholder = imageMode
      ? "Descreva a imagem que a NEXA deve criar..."
      : deepMode
        ? "Descreva o tema da pesquisa profunda..."
        : "Digite uma mensagem...";
  }
}


export function setImageMode(isOn) {
  assignImageMode(isOn === true);
  renderImageMode();
}


export function renderImagePreview() {
  const preview = document.getElementById("imagePreview");
  const image = document.getElementById("imagePreviewImage");
  const name = document.getElementById("imagePreviewName");
  if (!preview || !image || !name) return;

  if (!pendingImage) {
    preview.hidden = true;
    image.removeAttribute("src");
    name.textContent = "";
    input.placeholder = deepMode
      ? "Descreva o tema da pesquisa profunda..."
      : "Digite uma mensagem...";
    return;
  }

  image.src = pendingImage.dataUrl;
  name.textContent = pendingImage.name;
  preview.hidden = false;
  input.placeholder = `Imagem anexada: ${pendingImage.name}`;
}


export function clearAttachment() {
  assignPendingImage(null);
  assignPendingFile(null);
  renderImagePreview();
  renderFilePreview();
}


export function renderFilePreview() {
  const preview = document.getElementById("filePreview");
  const name = document.getElementById("filePreviewName");
  if (!preview || !name) return;
  preview.hidden = !pendingFile;
  name.textContent = pendingFile ? pendingFile.name : "";
}


export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const extension = file?.name?.split(".").pop()?.toLowerCase() || "";
    if (!file || !ALLOWED_FILE_EXTENSIONS.has(extension)) {
      reject(new Error("Tipo de arquivo não permitido. Executáveis não são aceitos."));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error("O arquivo deve ter no máximo 2 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type || "text/plain",
      text: String(reader.result || "")
    });
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsText(file);
  });
}


export function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Selecione uma imagem válida."));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error("A imagem deve ter no máximo 8 MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mimeType: file.type,
      dataUrl: String(reader.result || "")
    });
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}


export function setupAttachUI() {
  const button =
    document.getElementById("attachButton");
  const menu =
    document.getElementById("attachMenu");
  const imageInput = document.getElementById("imageInput");
  const fileInput = document.getElementById("fileInput");

  if (!button || !menu) {
    return;
  }

  function setOpen(isOpen) {
    menu.classList.toggle("open", isOpen);

    button.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );
  }

  button.addEventListener(
    "click",
    function () {
      setOpen(
        !menu.classList.contains("open")
      );
    }
  );

  if (imageInput) {
    imageInput.addEventListener("change", async () => {
      try {
        assignPendingImage(await readImage(imageInput.files?.[0]));
        assignPendingFile(null);
        renderImagePreview();
        renderFilePreview();
      } catch (error) {
        assignPendingImage(null);
        renderImagePreview();
        alert(error.message);
      } finally {
        imageInput.value = "";
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      try {
        assignPendingFile(await readTextFile(fileInput.files?.[0]));
        assignPendingImage(null);
        renderFilePreview();
        renderImagePreview();
        input.placeholder = `Arquivo anexado: ${pendingFile.name}`;
      } catch (error) {
        assignPendingFile(null);
        renderFilePreview();
        alert(error.message);
      } finally {
        fileInput.value = "";
      }
    });
  }

  const removeFileButton = document.getElementById("filePreviewRemove");
  if (removeFileButton) {
    removeFileButton.addEventListener("click", () => {
      clearAttachment();
      input.focus();
    });
  }

  async function acceptDroppedFile(file) {
    if (!file) return;
    try {
      if (file.type.startsWith("image/")) {
        assignPendingImage(await readImage(file));
        assignPendingFile(null);
        renderImagePreview();
        renderFilePreview();
      } else {
        assignPendingFile(await readTextFile(file));
        assignPendingImage(null);
        renderFilePreview();
        renderImagePreview();
        input.placeholder = `Arquivo anexado: ${pendingFile.name}`;
      }
    } catch (error) {
      clearAttachment();
      alert(error.message);
    }
  }

  [document].forEach(target => {
    if (!target) return;
    target.addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      document.body.classList.add("file-drag-over");
    });
    target.addEventListener("dragleave", event => {
      if (!event.relatedTarget || !target.contains(event.relatedTarget)) {
        document.body.classList.remove("file-drag-over");
      }
    });
    target.addEventListener("drop", event => {
      event.preventDefault();
      document.body.classList.remove("file-drag-over");
      acceptDroppedFile(event.dataTransfer.files?.[0]);
    });
  });

  document.addEventListener("dragend", () => {
    document.body.classList.remove("file-drag-over");
  });

  const removeImageButton = document.getElementById("imagePreviewRemove");
  if (removeImageButton) {
    removeImageButton.addEventListener("click", () => {
      clearAttachment();
      input.focus();
    });
  }

  menu.addEventListener(
    "click",
    function (event) {
      const item =
        event.target.closest(".reasoning-item");

      if (!item || item.disabled) {
        return;
      }

      if (item.id === "attachDeep") {
        setDeepMode(!deepMode);
      } else if (item.id === "attachGen") {
        setImageMode(!imageMode);
      } else if (item.id === "attachImage" && imageInput) {
        imageInput.click();
      } else if (item.id === "attachFile" && fileInput) {
        fileInput.click();
      }

      setOpen(false);

      const input =
        document.getElementById("messageInput");

      if (input) {
        input.focus();
      }
    }
  );

  /*
    Na fase de captura o clique fecha o menu mesmo quando outro
    botão interrompe a propagação do evento.
  */
  document.addEventListener(
    "click",
    function (event) {
      const target = event.target;

      if (
        target instanceof Element &&
        target.closest("#attachWrap")
      ) {
        return;
      }

      setOpen(false);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
  );
}



