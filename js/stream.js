/**
 * Envio de mensagens e consumo do stream SSE (/api/chat)
 * Gerado por refatoração de script.js — comportamento preservado.
 */
import { clearAttachment, setImageMode } from "./attachments.js";
import { showAuth } from "./auth.js";
import { findChat, makeMessageId, renderChatList, saveChats, scheduleChatsPush, syncChatsFromServer } from "./chats.js";
import { composer, drawerNewChat, input, micButton, sendButton } from "./dom.js";
import { submitImagePrompt } from "./images.js";
import { addMessage, createStreamingMessage, hideTyping, showTyping } from "./messages.js";
import { notifyNativeVoice } from "./native.js";
import { saveMemory } from "./settings.js";
import { abortController, activeChatId, assignAbortController, assignPendingImage, customInstructions, deepMode, history, imageMode } from "./state.js";
import { memoryEnabled, messageKey, pendingFile, pendingImage, reasoningLevel } from "./state.js";

export async function askNexa(text, deep, image, file) {
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
        customInstructions,
        deep: deep === true,
        image: image || null,
        file: file || null
      }),

      signal: abortController?.signal
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
    thinking,
    memoryNotice,
    searchNotice,
    addActions
  } = createStreamingMessage();

  /*
    Na pesquisa profunda o painel de pensamento já abre mostrando a
    cadeia do pesquisador; fecha quando a resposta começa a chegar.
  */

  if (deep) {
    thinking.expand();
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let fullReply = "";
  let fullThinking = "";
  let finished = false;
  let memoryUpdated = false;
  let searched = false;

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
        /*
          Pesquisa profunda: o pesquisador terminou e a resposta
          começou — o painel fecha sozinho.
        */

        if (deep && !fullReply) {
          thinking.collapse();
        }

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
        A memória foi reescrita pela
        ferramenta chamada pelo modelo.
      */

      if (data.type === "memory") {
        memoryUpdated = true;
        memoryNotice.show();
      }

      /*
        O modelo consultou a web
        antes de responder.
      */

      if (data.type === "search") {
        searched = true;
        thinking.append("\n\n🔍 **Pesquisa na web**");
      }

      /*
        A memória foi atualizada.
      */

      if (data.type === "memory") {
        memoryUpdated = true;
        thinking.append("\n\n💾 **Memória atualizada**");
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
    /*
      Acontece quando o modelo só pediu ferramenta e a
      continuação não trouxe texto. Aviso claro, sem
      quebrar a página.
    */

    throw new Error(
      memoryUpdated || searched
        ? "A NEXA usou uma ferramenta, mas não respondeu. Tente de novo."
        : "A NEXA não retornou nenhum texto."
    );
  }

  /*
    A mensagem do usuário já entrou no `history` no envio
    (é o que tira a página do estado de boas-vindas antes
    da resposta chegar). Aqui entra só a resposta.
  */

  const assistantMessageId = makeMessageId();
  addActions(assistantMessageId);

  history.push({
    role: "model",
    content: fullReply,
    id: assistantMessageId,
    thinking: fullThinking,
    memoryUpdated,
    searched
  });

  saveMemory();

  notifyNativeVoice(fullReply, false);

  return {
    reply: fullReply,
    finished
  };
}


export async function generateChatTitle(message) {
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


export function setGenerating(generating) {
  if (generating) {
    sendButton.classList.add("stopping");
    sendButton.querySelector(".send-icon").textContent = "■";
    sendButton.setAttribute("aria-label", "Parar geração");
    sendButton.title = "Parar geração";
    input.disabled = true;
    micButton.disabled = true;
    drawerNewChat.disabled = true;
    assignAbortController(new AbortController());
  } else {
    sendButton.classList.remove("stopping");
    sendButton.querySelector(".send-icon").textContent = "➤";
    sendButton.setAttribute("aria-label", "Enviar");
    sendButton.title = "Enviar mensagem";
    input.disabled = false;
    micButton.disabled = false;
    drawerNewChat.disabled = false;
    assignAbortController(null);
  }
}


sendButton.addEventListener("click", () => {
  if (abortController) {
    abortController.abort();
  }
});


document.querySelectorAll(".suggestion").forEach(function (button) {
  button.addEventListener("click", function () {
    const kind = button.dataset.suggestion;

    if (kind) {
      input.value = kind;
      input.focus();
    }
  });
});


composer.addEventListener(
  "submit",
  async function (event) {
    event.preventDefault();

    const text =
      input.value.trim();

    /*
      Durante a geração, o botão vira ■ e o clique para
      (o listener do botão aborta); o submit só retorna.
    */
    if (abortController) {
      abortController.abort();
      return;
    }

    if (
      (!text && !pendingImage && !pendingFile) ||
      sendButton.disabled
    ) {
      return;
    }

    /*
      No modo Criar imagem o texto é o prompt: a geração
      acontece fora do chat e o resultado vira mensagem.
      Depois de gerar, o modo desliga: a próxima mensagem
      é de texto normal.
    */
    if (imageMode && text && !pendingImage && !pendingFile) {
      setImageMode(false);
      await submitImagePrompt(text);
      return;
    }

    const submittedImage = pendingImage;
    const submittedFile = pendingFile;
    const messageText = text || (submittedImage
      ? "Descreva esta imagem."
      : "Analise o arquivo anexado.");

    /*
      O modo de pesquisa profunda permanece ativo neste chat até o usuário
      desligá-lo manualmente. Assim, cada nova mensagem continua passando
      pelo agente pesquisador antes da resposta final.
    */
    const deep = deepMode;

    setGenerating(true);

    /*
      Antes de enviar, puxa o que houver de novo: se outro aparelho
      mexeu na conversa, a tela é atualizada antes do prompt entrar.
    */
    try {
      await syncChatsFromServer();
    } catch (error) {
      // Servidor fora do ar: envia com o histórico local mesmo.
    }

    /*
      Verifica se é a primeira mensagem do chat (histórico vazio antes de adicionar)
    */
    const isFirstMessage = history.length === 0;
    const titleChatId = isFirstMessage
      ? activeChatId
      : null;

    /*
      Mostra a mensagem do usuário e já registra no `history`:
      é o que tira a página do estado de boas-vindas antes
      da resposta chegar.
    */

    const userMsgId = makeMessageId();

    history.push({
      role: "user",
      content: messageText,
      id: userMsgId,
      image: submittedImage || null,
      file: submittedFile || null
    });

    addMessage(messageText, "user", "", false, userMsgId, submittedImage);

    input.value = "";
    clearAttachment();

    /*
      Indicador enquanto o primeiro
      pedaço da resposta ainda não chegou.
    */

    showTyping();

    try {
      await askNexa(messageText, deep, submittedImage, submittedFile);
      assignPendingImage(null);
      input.placeholder = deepMode
        ? "Descreva o tema da pesquisa profunda..."
        : "Digite uma mensagem...";

      /* 
        Se foi a primeira mensagem, gera título pela IA
      */
      if (isFirstMessage) {
        const aiTitle = await generateChatTitle(messageText);
        if (aiTitle) {
          const chat = findChat(titleChatId);
          if (chat) {
            chat.title = aiTitle;
            chat.updatedAt = Date.now();
            chat.dirty = true;
            saveChats();
            renderChatList();
            scheduleChatsPush();
          }
        }
      }

    } catch (error) {
      if (error.name === "AbortError") {
        hideTyping();
      } else {
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
          "nexa",
          "",
          false
        );

        notifyNativeVoice(error?.message || "erro desconhecido", true);
      }

    } finally {
      setGenerating(false);
      input.focus();
    }
  }
);



