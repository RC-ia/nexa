# NEXA — Voz no app Android (wake word "Nexa" → chamada Live)

Documento de integração e estado. Atualizado: **2026-10-01**.
O app Android é mantido fora deste repositório; este doc é o contrato entre as partes
(site/servidor ↔ app). Objetivo: dizer **"Nexa"** e a chamada de voz (modo Live, Gemini)
abrir sozinha — conversa contínua, estilo "Ok Google".

## Estado (checado na produção em 2026-10-01)

| Peça | Estado na produção (`nexa2.rcscan.online`) |
|---|---|
| `script.js` v52 — `NexaVoice.ask` + `onAssistantReply`/`onAssistantError` | **no ar** |
| `live.js` v10 — `NexaLive.start()` + `onLiveState` | **no ar** |
| `server.py` — ferramentas na chamada (`POST /api/live/tool`) | **NÃO subiu** (`GET /api/live/tool` → 404) |
| App: wake word "Nexa" (bipe + gatilho) | **falhando** — testes de 01/10: nenhum bipe, nada acontece |

Confirmação rápida de deploy: abrir `https://nexa2.rcscan.online/api/live/tool` no navegador.
- 404 → `server.py` novo ainda não subiu (chamada Live fica sem ferramentas).
- 401/405/erro "método" → subiu. (Espera ~3 min após o upload; `run.py` puxa sozinho.)

## Fluxo alvo (como deve funcionar)

1. App ouve "Nexa" (engine local, no aparelho) → toca bipe.
2. App navega o WebView (já logado no site) para `/live.html` e chama `window.NexaLive.start()`.
3. A página pede o microfone (`getUserMedia`), pega um token em `POST /api/live/token` e abre
   WebSocket direto com o Gemini Live.
4. Conversa contínua: mic → Gemini; voz do Gemini → alto-falante. Interromper falando funciona.
5. Ao encerrar (botão, erro ou sair da página), o site avisa o app (`onLiveState("ended")`)
   e a escuta nativa pode voltar.

## Contrato do site (o que o app chama)

### 1. Iniciar a chamada — `window.NexaLive.start()` (live.js v10)

```java
webView.evaluateJavascript("window.NexaLive && window.NexaLive.start()", null);
```

- Inicia a chamada sozinho; não precisa clicar no botão.
- Se a página ainda está verificando a sessão, espera e inicia quando liberar.
- Se já existe chamada em andamento, ignora (seguro chamar mais de uma vez).
- Se a página voltar para a tela de login sozinha, a sessão do WebView expirou — relogar.

### 2. Estado da chamada — site → app — `window.NexaNative.onLiveState(state)`

Opcional (sem esse membro no `NexaNative`, nada quebra). Implementar como `@JavascriptInterface`:

- `"connecting"` — pedindo microfone / conectando
- `"live"` — conectado ("pode falar")
- `"ended"` — chamada encerrada

Uso recomendado no app: **pausar a wake word durante a chamada** (o microfone é da chamada)
e religar no `"ended"`. Também serve para atualizar a notificação (Ouvindo/Falando).

### 3. Fluxo antigo (comando único no chat) — CONTINUA ativo

`window.NexaVoice.ask(texto)` → `true`/`false`.
Resposta volta por `window.NexaNative.onAssistantReply(textoCompleto)`; erro por
`onAssistantError(motivo)`. É diferente do Live: comando único, resposta do cérebro do
chat (memória/histórico/ferramentas), voz = TTS do aparelho. Mensagem aparece no chat.
Útil manter como "pergunta rápida" se quiser os dois comportamentos.

### 4. Requisitos do WebView (senão a chamada morre no microfone)

- `WebChromeClient.onPermissionRequest` → conceder `RESOURCE_AUDIO_CAPTURE`.
  **Mic nativo funcionando não basta** — o `getUserMedia` dentro do WebView precisa
  desse grant, senão falha com "O navegador não oferece acesso ao microfone nesta conexão".
- `settings.setMediaPlaybackRequiresUserGesture(false)` — voz tocar sem toque.
- Processo/WebView vivos durante a chamada (app em primeiro plano ou serviço).
- Site é HTTPS (ok para `getUserMedia`).

## O que o app ainda precisa fazer (ordem)

1. **Wake word (elo pendente — hoje não dispara).**
   - Engine local: Porcupine (exige AccessKey + keyword `.ppn` **custom** — "Nexa" não é
     palavra padrão) ou Vosk (exige o modelo baixado + `["nexa"]` na gramática).
   - `SpeechRecognizer` contínuo do Android **não** serve (para sozinho; sintoma: bipe nunca toca).
   - Mic: permissão `RECORD_AUDIO` concedida em runtime; engine/leitura em try/catch com log
     (exceção engolida = loop morre mudo).
   - Depurar com um log em cada elo: serviço iniciou → loop de áudio lê buffers → match
     "Nexa" (log antes do beep) → beep → ... O primeiro que não imprime é o culpado.
2. **No gatilho:** bipe → navegar para `/live.html` → `NexaLive.start()` (pode chamar no
   `onPageFinished` da URL).
3. **`onLiveState`** no `NexaNative` para pausar/retomar a escuta nativa.
4. Manter notificação com estados (Dormindo/Ouvindo/Pensando/Falando) — já implementado.

## Depuração — mapa dos elos (sintoma → onde olhar)

| Sintoma | Elo provável |
|---|---|
| Nenhum bipe ao falar "Nexa" | Wake word/engine no app (antes do site) |
| Bipe toca, nada abre | Navegação/`evaluateJavascript` no app ou página não carregou |
| Chamada abre e falha no microfone | Grant `RESOURCE_AUDIO_CAPTURE` no WebChromeClient |
| Chamada abre e volta pro login | Sessão do WebView expirada |
| "Conectado · pode falar" mas sem voz | Áudio do WebView (autoplay) / volume |
| Voz funciona, ferramentas não | `server.py` não subiu (404 em /api/live/tool) |

## Teste bisect (descarta o app de uma vez)

1. No PC, abrir `https://nexa2.rcscan.online/live.html` → "Iniciar chamada" → conversar.
   Se aqui não funcionar, o problema é servidor/navegador — não é o app.
2. No app, com ele aberto: fazer o mesmo manualmente (se houver como navegar).
3. Se a chamada manual funciona e só o "Nexa" não → só falta a wake word.

## Servidor (referência)

- `POST /api/auth/login` → cookie `nexa_session` + `messageKey`.
- `POST /api/live/token` (cookie + header `X-Nexa-Message-Key`) — token efêmero.
  Ponto-chave: **com `fieldMask` vazio, o setup do cliente é ignorado** — modelo, voz,
  prompt e ferramentas vêm todos **de dentro do token**, definidos no servidor.
- `POST /api/live/tool` — executa as ferramentas da chamada (pesquisar, visitar_pagina,
  data_hora, criar_lembrete). Parte do `server.py` **pendente de upload**.
- `POST /api/chat` (SSE) — mensagens do chat.
- `POST /api/push-token` (só header, sem cookie) — push FCM.

## Histórico (o que foi feito e quando)

- **`script.js` v52 (01/10):** `window.NexaVoice.ask(texto)` (envia como se digitado,
  retorna `true`/`false`) + respostas para o app (`onAssistantReply`/`onAssistantError`).
- **`live.js` v9 (01/10):** chamada Live ganhou as ferramentas do NEXA — `toolCall` do
  Gemini vira `POST /api/live/tool` e a resposta volta como `toolResponse`.
- **`live.js` v10 (01/10):** `window.NexaLive.start()` + avisos `onLiveState`.
- **`server.py` (01/10, pendente de upload):** token com as 4 ferramentas + hora do usuário
  no prompt; endpoint `/api/live/tool`. Testado localmente (26/26) — **não testado contra o
  Gemini real** (sem API key na máquina de dev): se o Google recusar `tools` no token, a
  chamada não inicia — nesse caso olhar a resposta de `/api/live/token`.
- Teste real no app (01/10): falhou — nenhum bipe ao falar "Nexa" (wake word, antes do site).
- 2º teste (01/10, após `live.js` v10 já estar na prod): **continua sem bipe**. Próximo passo
  combinado: (1) botão temporário no app que abre a chamada direto (bisect — valida tudo menos
  a wake word); (2) depurar a detecção com log por elo.

## Pegadinhas conhecidas

- `/api/chat` chamado direto do código nativo **não autentica** (exige cookie do WebView).
- No fluxo antigo, `ask()` retorna `false` também durante "Pensando" (ocupada) — não é erro.
- Timeout de 2 min do app pode estourar em busca web lenta (fluxo antigo).
- Escapar texto com `JSON.stringify`/`JSONObject.quote` no `evaluateJavascript`.
