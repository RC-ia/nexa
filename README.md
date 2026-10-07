# NEXA + 9Router (servidor Python)

Versão da NEXA rodando localmente em Python, conectada a uma API compatível
com OpenAI (`https://9router.rcscan.online/v1`), pensada para rodar em uma
máquina e ser exposta com o túnel do Cloudflare (`cloudflared`).

Estrutura:

- `server.py` — servidor Flask (serve o site + `/api/chat` com streaming SSE + `/api/images/generate` do gerador de imagens)
- `auth.py` — login, sessões e painel admin
- `run.py` — supervisor: roda o servidor e aplica auto-update via git
- `launcher.py` — sobe/derruba o supervisor desanexado (daemon)
- `server_manager.py` — status e controle do servidor para o Painel admin
- `index.html`, `style.css`, `script.js` — frontend do chat
- `live.html`, `live.css`, `live.js` — página da chamada Gemini Live
- `requirements.txt` — dependências Python
- `.env.example` — modelo de configuração
- `memoria/` — um arquivo `.md` por conta com a memória consolidada (criado automaticamente)
- `auth.db` — contas, cadastros pendentes e sessões (criado automaticamente, **não versionar**)

## 1. Instalar as dependências

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows (PowerShell/cmd)
pip install -r requirements.txt
```

## 2. Configurar a chave

Copie `.env.example` para `.env` e preencha a chave:

```env
API_KEY=sua-chave-aqui
API_GEMA=sua-chave-gemini-aqui
```

Opcionais (já têm padrão): `API_BASE`, `MODEL`, `VISION_MODEL`, `PORT`,
`MAX_OUTPUT_TOKENS`, `MEMORY_DIR`, `STUDIO_DIR`, `STREAM_TIMEOUT`,
`THINKING_MINIMUM_ROUNDS`, `THINKING_LOW_ROUNDS`,
`THINKING_MEDIUM_ROUNDS`, `THINKING_HIGH_ROUNDS`,
`THINKING_VERY_HIGH_ROUNDS`, `THINKING_MAXIMUM_ROUNDS`,
`THINKING_ULTRA_ROUNDS`, `THINKING_AGENT_MAX_TOKENS`, `AUTO_UPDATE`,
`UPDATE_INTERVAL`, `GIT_REMOTE`, `GIT_BRANCH`, `ADMIN_USER`,
`ADMIN_PASSWORD` e `SESSION_DAYS`.
`VISION_MODEL` define o modelo usado pelo agente que analisa imagens antes da
resposta textual. O padrão é `nvidia/google/diffusiongemma-26b-a4b-it`.
Nunca versione o `.env` (ele já está no `.gitignore`).

## Login e painel admin

A NEXA exige login para conversar. Não existe cadastro aberto: quem cria os
usuários é o admin, pelo **Painel admin** (botão na gaveta lateral, só
aparece para admins). Lá dá para listar, criar (com opção de ser admin),
trocar a senha e apagar usuários.

**Primeiro acesso:** ao subir o servidor pela primeira vez sem nenhum admin,
ele cria a conta `admin` (ou o `ADMIN_USER` do `.env`). Se `ADMIN_PASSWORD`
estiver no `.env`, essa é a senha; se não, o servidor gera uma senha e
**mostra no console uma única vez**. Depois de entrar, troque-a no painel.

Como funciona:

- Usuário: 3 a 64 caracteres (letras minúsculas, números e `_ . @ + -`).
  Senha: mínimo 8 caracteres, guardada só como hash (scrypt).
- A sessão é um cookie `HttpOnly` (`SameSite=Lax`, `Secure` quando o acesso é
  por HTTPS, como no túnel do Cloudflare) e dura `SESSION_DAYS` (padrão 30).
  Trocar a senha ou apagar um usuário derruba as sessões dele.
- No login, o servidor emite uma credencial aleatória de 64 caracteres,
  válida por 24 horas. O navegador a envia automaticamente nas mensagens;
  ao expirar, é necessário entrar novamente com a senha da conta. O servidor
  confere o horário apenas quando recebe uma requisição protegida.
- A memória de longo prazo é ligada à conta. As conversas do `localStorage`
  ficam separadas por usuário; as de antes do login vão para a primeira conta
  que entrar naquele navegador.
- O login tem limite de tentativas por IP/usuário.
- Contas ficam em `auth.db` (fora do git). Para começar do zero, apague o arquivo.

Rotas: `POST /api/auth/login`, `/api/auth/logout`, `GET /api/auth/me` e, só
para admin, `GET/POST /api/admin/users`, `POST /api/admin/users/<id>/password`
e `DELETE /api/admin/users/<id>`.

## 3. Rodar

### Opção A — Supervisor com auto-update (recomendado para produção)

```bash
python run.py
```

O `run.py` inicia o servidor e fica verificando o repositório git a cada
`UPDATE_INTERVAL` segundos (padrão 180). Se houver commits novos, faz
`git pull --ff-only` e reinicia o servidor automaticamente.

### Opção B — Servidor direto (sem auto-update)

```bash
python server.py
```

A aplicação sobe em `http://localhost:8000`. O gerador de imagens fica no
**modo Imagens** da gaveta (botão **Imagens**) e usa a API da Novita AI
configurada por `API_IMAGE`, `MODEL_IMAGE` e `IMAGE_API_URL` no `.env`; ele
salva as imagens em `generated/` e não exige um segundo servidor Flask.
Imagens Markdown de URLs externas nas respostas normais são mostradas como
texto, não carregadas automaticamente.

### Opção C — Processo desanexado/daemon (sobrevive ao fechar o terminal)

Para rodar o **supervisor** em background (com auto-update) e poder controlá-lo
depois pelo **Painel admin** (ou linha de comando), use o `launcher.py`:

```bash
# Inicia desanexado (Windows) ou daemon (Linux)
python launcher.py start

# Verifica status
python launcher.py status
# → {"running": true, "pid": 12345, "uptime_seconds": 12.3}

# Para graciosamente
python launcher.py stop

# Para à força (kill -9 / taskkill /F)
python launcher.py stop --force

# Reinicia
python launcher.py restart
```

**Como funciona:**

- **Windows:** usa `CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS | CREATE_NO_WINDOW`
  + `start_new_session=True`; stdio redirecionado para `.nexa_server.log`. O
  processo não tem console e não morre quando o terminal fecha.
- **Linux:** double-fork POSIX (`os.fork()` × 2) + `os.setsid()`; stdio
  redirecionado para `.nexa_server.log`. O PID do **neto** (daemon real) é
  salvo em `.nexa_server.pid`.
- Em ambos os SOs, o `launcher.py` sobe o `run.py` (o supervisor), que por sua
  vez roda o `server.py` — então o **auto-update continua funcionando** com o
  processo desanexado. O `stop` mata a árvore inteira (supervisor + servidor).
- O `server_manager.py` expõe a mesma API (`is_running`, `get_status`,
  `start_server`, `stop_server`, `restart_server`) que o **Painel admin**
  consome (rotas `GET/POST /api/admin/server/*`).

> **Dica:** rode `python run.py` no terminal só quando quiser acompanhar os
> logs ao vivo; para produção desanexada, `python launcher.py start` faz o
> mesmo com auto-update e sobrevive ao fechar o terminal.

## Atualização automática (git)

O `run.py` verifica o repositório a cada `UPDATE_INTERVAL` segundos (padrão
180). Se houver commits novos no remoto, ele roda `git pull --ff-only` e
reinicia o servidor automaticamente.

Configurações no `.env`:

- `AUTO_UPDATE=1` — liga/desliga (`0` desliga).
- `UPDATE_INTERVAL=180` — intervalo das checagens, em segundos (mínimo 30).
- `GIT_REMOTE=origin` — remoto usado.
- `GIT_BRANCH=` — branch; vazio usa o upstream da branch atual.

Observações:

- Usa `--ff-only`, então **não** sobrescreve mudanças locais: se houver
  alterações não commitadas em arquivos versionados (ou arquivos novos que o
  remoto também adiciona), o pull falha e é registrado no log (sem reiniciar).
  Commit ou stash das mudanças locais destrava o update.
- Arquivos como `index.html`, `style.css` e `script.js` passam a valer
  imediatamente; mudanças em `server.py` só valem após o reinício (que o
  próprio `run.py` faz).
- Rodando desanexado pelo `launcher.py`, o log do supervisor fica em
  `.nexa_server.log`.

## 4. Expor com o túnel do Cloudflare

Em outro terminal:

```bash
cloudflared tunnel --url http://localhost:8000
```

O `cloudflared` imprime uma URL pública (`https://<algo>.trycloudflare.com`)
que aponta para o servidor local.

## Modelos e multimodalidade

- Base URL padrão: `https://9router.rcscan.online/v1`
- Modelo textual padrão: `MODEL=nada`
- Agente visual padrão: `VISION_MODEL=nvidia/google/diffusiongemma-26b-a4b-it`
- Arquivos aceitos: textos, documentos simples, código e configurações até 2 MB.
- Imagens: até 8 MB, analisadas pelo agente visual antes da resposta textual.
- Executáveis e extensões desconhecidas são rejeitados.
- É possível arrastar uma imagem ou arquivo do Windows para a página; o item
  aparece no preview antes do envio.

Quando há uma imagem, o agente visual produz um relatório detalhado para o
modelo textual. Na pesquisa profunda, a imagem é analisada antes do agente de
intenção, que recebe o relatório visual junto com o contexto recente antes de
montar o tema para o pesquisador.

## Voz da NEXA

O chat normal não faz leitura das respostas em voz alta nem usa motor de TTS.
Ele aceita mensagens de texto, imagens e arquivos de texto/código. Imagens e
arquivos podem ser escolhidos pelo menu de anexos ou arrastados do Windows para
a página; executáveis e extensões desconhecidas são rejeitados.

A única experiência de voz é a chamada Gemini Live em `/live.html`. A voz é
escolhida **apenas** em **Configurações > Chamada** e fica salva no navegador;
a página da chamada usa essa escolha e não tem seletor próprio.

## Chamadas Gemini Live

O botão de telefone no composer abre a página própria `/live.html`, que inicia
uma chamada com o modelo `gemini-3.8-live`. Configure `API_GEMA` com uma chave da
Gemini API no `.env`. O servidor emite um token efêmero de uso único; a chave
permanente não é enviada ao navegador. O modo de chamada usa microfone e áudio
em tempo real. O navegador precisa permitir acesso ao microfone; fora de
`localhost`, o site deve estar em HTTPS.

## Memória

A memória de longo prazo é um **único arquivo Markdown por conta**, dentro de
`memoria/`. Ela entra no **system prompt** e quem salva é o **próprio modelo,
durante a conversa**, pela ferramenta `salvar_memoria` — não existe mais uma
passada separada de extração depois da resposta.

Quando o modelo chama a ferramenta, o servidor grava o documento, responde à
chamada com o resultado e pede a continuação da resposta, que já sai com a
memória atualizada no system prompt. O arquivo é limitado a 10.000 caracteres
e pode ser editado à mão em **Configurações > Memória**.

Ao entrar, a tela de boas-vindas mostra uma **saudação curta, montada no
próprio navegador** pelo horário ("Bom dia, Ana!", "Boa tarde, Ana!",
"Boa noite, Ana!"). Não existe chamada de modelo nem leitura de memória
para esse título — ele é simples por definição — e não é gravado no
histórico da conversa.

Apagar a pasta `memoria/` remove a memória persistente (as conversas do
navegador continuam no `localStorage`).

## Pesquisa

A NEXA também tem a ferramenta `pesquisar`, que busca no **DuckDuckGo** pelo
endpoint HTML público (sem chave de API). As regras de quando pesquisar estão
no system prompt: ela procura sempre que a resposta depender de fato novo,
atual ou verificável, quando o usuário pedir, quando ela não souber a resposta
e quando o assunto for específico ou técnico. Ela não pesquisa para opinar ou
conversar, e cita a fonte quando usa um resultado.

A busca traz título, trecho e link de até 5 resultados por consulta. O modelo
pode pesquisar de novo na continuação, com limite padrão de 4 rodadas
(`MAX_TOOL_ROUNDS`).

### Pesquisa profunda

Quando ativada no menu de anexos, a pesquisa profunda permanece ativa no chat
até ser desligada manualmente. Se o nível escolhido for diferente de Rápido, o
fluxo é: agente visual (quando houver imagem), agente de intenção, pesquisador
e, depois, agente de pensamento. O relatório da pesquisa é entregue ao agente
de pensamento antes da primeira rodada; durante esse loop, `pesquisar`,
`visitar_pagina` e `pesquisa_profunda` ficam indisponíveis. Memória, lembretes e
data/hora continuam disponíveis. Assim o pensamento revisa e organiza o
material já pesquisado sem repetir buscas.

No modo Rápido, a pesquisa profunda segue diretamente para o modelo final,
sem o agente de pensamento adicional. Depois da revisão, o relatório da
pesquisa e o contexto produzido pelo pensamento são entregues ao modelo final,
que não recebe ferramentas de pesquisa e deve produzir uma resposta
desenvolvida sem comprimir excessivamente o relatório.

### Tentativas de busca

O DuckDuckGo limita requisições por IP e costuma responder `202` quando está
saturado. A NEXA não desiste no primeiro erro: ela **tenta de novo durante até
2 minutos** antes de desistir.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `SEARCH_PATIENCE` | `120` | Orçamento total de espera, em segundos |
| `SEARCH_RETRY_DELAY` | `4` | Pausa entre uma tentativa e outra |
| `SEARCH_MAX_ATTEMPTS` | `12` | Teto de tentativas, para não girar infinito |
| `SEARCH_HEARTBEAT` | `15` | Intervalo do `ping` que mantém a conexão viva |

Assim que o orçamento acaba, a ferramenta devolve ao modelo uma mensagem
genérica dizendo que a pesquisa está fora do ar. O modelo responde com o que
já sabe e explica que **não conseguiu verificar** — ele nunca inventa fatos,
números, datas ou fontes para compensar. A conversa nunca trava: a resposta
sempre é entregue.

Como o proxy **Cloudflare** corta conexões ociosas em torno de 100 segundos,
o servidor não fica parado esperando. As ferramentas rodam em uma thread
separada e, enquanto a busca não termina, a resposta de streaming emite um
evento `{"type":"ping"}` a cada `SEARCH_HEARTBEAT` segundos. O navegador ignora
esses eventos e a conexão continua viva.

Cada tentativa é registrada no log como
`[NEXA-PESQUISA] ... falhou (motivo); nova tentativa em Xs (restam Ys no orçamento).`

Quando uma ferramenta é usada, a resposta ganha uma pílula embaixo do texto:
`⌕ Pesquisei na web para responder.` ou `✦ Memória atualizada com o que você
me contou.` A pílula de pesquisa **só aparece quando a busca realmente
trouxe resultados** — se a ferramenta falhou, não existe aviso de pesquisa.

### Ler o conteúdo completo

A ferramenta `pesquisar` devolve um resumo (título, URL e trecho). Se o
resumo não for suficiente, o modelo pode chamar `visitar_pagina` com os
**prefixos** das páginas que quer ler:

```
visitar_pagina(["P1", "P3"])
```

Os prefixos são os números que acompanham cada resultado da última busca
(`P1`, `P2`…). O modelo pode pedir várias páginas de uma vez. A ferramenta
abre cada URL, extrai o texto principal (remove scripts, styles, nav,
footer) e devolve o conteúdo limpo — limitado a 8 000 caracteres por página.
Se a página não carregar, o erro é devolvido ao modelo sem travar a
resposta.

## Lembretes

A NEXA cria lembretes sozinha pela ferramenta `criar_lembrete`: você pede no
chat ("me lembre de tomar remédio amanhã às 8", "toda sexta às 18h") e o
modelo converte o pedido em data e hora usando a data atual que o servidor
injeta no prompt.

Dois tipos:

- **Recorrente** — de hora em hora, todo dia, toda semana (com dia escolhido)
  ou todo mês (dia 1 a 31; mês sem esse dia usa o último dia disponível).
- **Único (gatilho único)** — dispara uma vez, em data e hora definidas.

No horário marcado o servidor chama um **agente de lembrete**, com system
prompt próprio e resposta curta, que cumpre a tarefa e escreve a mensagem
final entregue ao usuário. Se o agente falhar, a própria descrição da tarefa
é entregue.

A entrega é dupla:

- **Página aberta** — o chat busca os lembretes novos a cada 30 s
  (`GET /api/reminders/due?since=<cursor>`) e mostra a mensagem no lugar de
  sempre; com a permissão ativada (Configurações > Lembretes > Ativar
  notificações), também dispara uma notificação do navegador. Cada aparelho
  guarda o próprio cursor no navegador e recebe cada lembrete uma vez: PC e
  celular com a página aberta veem a mesma mensagem, um não "rouba" a
  entrega do outro. O servidor retém os disparos por 7 dias para quem ficou
  offline — passado isso, o lembrete antigo não é mais entregue.
- **App / push (FCM)** — o app envia o token do Firebase pelo evento
  `nativeFcmToken` (ou `window.NexaNative.getFcmToken()`), a página registra
  em `POST /api/push-token` e o servidor envia o push pelo FCM HTTP v1. Para
  ativar, coloque a chave de serviço (Console do Firebase → Configurações do
  projeto → Contas de serviço → Gerar nova chave privada) na raiz como
  `firebase-key.json` ou `chave-firebase.json`. Sem a chave ou sem a lib
  `google-auth`, o push é ignorado em silêncio — os lembretes continuam
  chegando pela página.

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `FCM_KEY` | `firebase-key.json` (ou `chave-firebase.json`) | Nome do arquivo da chave de serviço |
| `SITE_URL` | `https://nexa2.rcscan.online/` | URL aberta ao tocar na notificação |

A lista de lembretes ativos fica em **Configurações > Lembretes**, com o
próximo disparo e botão de apagar (`GET/DELETE /api/reminders`). Cada conta
tem o seu arquivo `memoria/<conta>.reminders.json` (fora do git), com os
lembretes e a fila de mensagens ainda não lidas.

## Barra lateral

O botão **☰** no canto esquerdo abre a gaveta de menu, que desliza por cima
da conversa — ela não empurra o conteúdo, então a largura da conversa
continua a mesma com a gaveta aberta ou fechada.

Dentro dela:

- **Nova conversa** — começa um chat em branco e guarda o anterior na lista.
- **Chats anteriores** — a conversa aberta fica destacada, e a lista vem da
  mais recente para a mais antiga. Passando o mouse aparece o **✕** para
  apagar. O título de cada chat é a primeira mensagem que você mandou.
- **Configurações** — reúne Chamada, Memória, Instruções, **Agente**, Lembretes e Mais.
  A seção **Agente** tem uma página própria para Pensamento, Pesquisa profunda,
  Agente visual, Agente de tema/intenção e Lembretes. A pesquisa profunda mantém
  nome e rodadas editáveis por usuário; modelos, prompts internos e limites
  técnicos globais aparecem como somente leitura. Instruções e preferências de
  memória ficam separadas por usuário neste navegador; os lembretes vivem no
  servidor (veja a seção **Lembretes**) e disparam mesmo com a página fechada.
  Na seção **Instruções**, o **system prompt** completo que o servidor usa pode
  ser visto e editado: ele fica em `memoria/<conta>.prompt.txt` (fora do git),
  separado por conta, e substitui o padrão embutido, com botão para restaurar
  o padrão.

A gaveta fecha pelo **✕**, clicando fora dela ou com `Esc`.

O botão **Nova conversa** do topo continua funcionando igual: os dois botões
fazem a mesma coisa.

Tudo isso fica no `localStorage`, em `nexa_chats` (a lista de conversas) e
`nexa_active_chat` (qual está aberta) — além da cópia sincronizada no
servidor (veja **Sincronização das conversas**). A memória de longo prazo
fica nos arquivos `.md` da pasta `memoria/` e não é afetada.

> **Nota sobre versões antigas:** antes da barra lateral a NEXA guardava uma
> conversa só, em `nexa_conversation`. Na primeira abertura depois dessa
> mudança, essa conversa é migrada sozinha para a lista e a chave antiga é
> apagada. Não é preciso fazer nada manualmente.

## Sincronização das conversas

As conversas são **do servidor**: cada conta tem todas as conversas em
`memoria/<conta>.chats.json` (fora do git), e o `localStorage` é só o cache
local de cada aparelho. Em qualquer aparelho logado na mesma conta, os chats
e o histórico aparecem iguais.

Como funciona:

- **Envio** — quando a conversa muda (mensagem nova, título), o navegador
  manda a conversa inteira para o servidor (`PUT /api/chats/<id>`), com uma
  pequena espera para juntar mudanças seguidas. Antes de enviar um prompt, a
  página **atualiza com tudo o que há de novo** no servidor: assim a mensagem
  nova nunca parte de um histórico atrasado.
- **Quem chega primeiro vence** — cada conversa tem uma `rev` (número que
  sobe a cada gravação). O cliente diz em que `rev` estava; se outro aparelho
  gravou antes, o servidor recusa (`409`) e devolve a versão atual. A versão
  de quem chegou primeiro fica; o segundo mescla as mensagens dele **depois**
  das do servidor e grava de novo. Nada se perde e nada duplica (cada
  mensagem tem um id).
- **Apagar** — apagar uma conversa no servidor vale para todos os aparelhos;
  quem estava com ela aberta em outro lugar a remove ao sincronizar. Isso
  vale também para **Apagar todas as conversas** (Configurações > Mais).
- **Limites** — até 500 conversas por conta, 5.000 mensagens por conversa,
  5 MB no total e 200.000 caracteres por mensagem. A lista de conversas nunca
  sai do navegador sem login.

Rotas: `GET /api/chats`, `PUT /api/chats/<id>`, `DELETE /api/chats/<id>` e
`DELETE /api/chats`.

## Versão

O rodapé mostra `NEXA vX.XX`, começando em `0.01`. O `run.py` guarda essa
versão em `.nexa_version` (fora do git) e a incrementa em `VERSION_STEP`
(padrão `1`) a cada atualização aplicada — assim dá para ver se o auto-update
funcionou.

- `VERSION_STEP=1` → `0.01`, `1.01`, `2.01`, ...
- `VERSION_STEP=0.01` → `0.01`, `0.02`, `0.03`, ...

O servidor expõe a versão em `GET /api/version`, e o `script.js` preenche o
rodapé ao carregar a página.

## Estúdio

O Estúdio usa um espaço isolado por conta para listar, ler e escrever arquivos
com o agente de código. O diretório padrão é `estudio/` e pode ser alterado por
`STUDIO_DIR`. Os limites padrão são 60.000 caracteres para leitura, 200.000
para escrita, 300 entradas na listagem, 8 rodadas de ferramentas e 8.000
tokens de saída (`STUDIO_READ_LIMIT`, `STUDIO_WRITE_LIMIT`,
`STUDIO_LIST_LIMIT`, `STUDIO_TOOL_ROUNDS` e `STUDIO_MAX_OUTPUT_TOKENS`).

A interface está em `/studio.html` e o servidor oferece `GET /api/studio/files`,
`GET /api/studio/file`, `GET /api/studio/raw` e `POST /api/studio/chat`.

## Reforço de raciocínio

Alguns modelos pedem um nível de raciocínio (ou "força de pensamento") para
responder. A NEXA tem um seletor ao lado do microfone com os níveis
**Rápido / Mínimo / Baixo / Médio / Alto / Muito alto / Máximo / Ultra**.
A escolha fica salva no `localStorage` do navegador, então não precisa
selecionar de novo na próxima sessão.

Nos níveis diferentes de Rápido, o agente de pensamento resolve e revisa a
solicitação em ciclos. A quantidade padrão de ciclos é: **Mínimo: 1, Baixo: 3,
Médio: 6, Alto: 8, Muito alto: 12, Máximo: 16 e Ultra: 24**. Rápido continua
sendo o caminho normal, sem esse agente adicional. O loop termina quando o
agente marca a solução como final, quando uma revisão não traz mudança ou
quando o modelo repete apenas uma apresentação sem resolver a solicitação.

As rodadas do agente são configuráveis no `.env`:

- `THINKING_MINIMUM_ROUNDS`, `THINKING_LOW_ROUNDS`,
 `THINKING_MEDIUM_ROUNDS`, `THINKING_HIGH_ROUNDS`,
 `THINKING_VERY_HIGH_ROUNDS`, `THINKING_MAXIMUM_ROUNDS` e
 `THINKING_ULTRA_ROUNDS` — quantidade de ciclos do agente de pensamento em
 cada nível. Os valores padrão são `1`, `3`, `6`, `8`, `12`, `16` e `24`.
- `THINKING_AGENT_MAX_TOKENS` — limite de tokens por ciclo do agente de
 pensamento. O agente pode usar a pesquisa comum e chamar `pesquisa_profunda`
 quando os resultados forem insuficientes; nessa chamada, o agente de
 intenção/tema recebe somente o contexto produzido pelo pensamento, sem o
 histórico bruto da conversa.

O reforço é implementado pelo número de ciclos do agente de pensamento. A NEXA
não envia mais um campo externo como `reasoning_effort`; isso evita depender de
parâmetros que alguns modelos não aceitam. O provedor pode aplicar o próprio
reforço internamente.

## Ver o pensamento

Cada resposta da NEXA tem o seu próprio botão **Pensamento**, logo abaixo do
nome `NEXA` da mensagem. Clicar abre um painel com o raciocínio do modelo
naquela resposta. Todos começam fechados, e o ponto ao lado do botão pulsa
enquanto o modelo pensa.

O painel é preenchido em tempo real, conforme o raciocínio chega no stream,
e cada mensagem é independente: abrir ou fechar uma não mexe nas outras. Nos
níveis diferentes de Rápido, ele também informa cada rodada do agente de
pensamento, quando o modelo está sendo consultado e quando uma ferramenta é
chamada. Se o agente chamar a pesquisa comum ou profunda, o painel mostra o
início, o progresso e a conclusão dessa pesquisa enquanto a resposta ainda
está sendo preparada. O raciocínio também é salvo junto da conversa no
`localStorage`, então as mensagens antigas continuam com o botão funcionando
depois de recarregar a página.

O raciocínio só aparece se o modelo realmente o enviar: o backend lê
`reasoning_content` (o campo mais comum), `reasoning` ou `thinking` — tanto
no streaming quanto na resposta bloqueante. Modelos que não expõem
raciocínio deixam o painel com a mensagem "O modelo não expôs o raciocínio
desta resposta". Nesses casos, selecionar um nível no seletor de reforço
também pode não ter efeito.

## Timeout e HTTP 524

A NEXA tenta o streaming primeiro; se não der certo, repete a chamada de
forma bloqueante. A API fica atrás de um proxy (Cloudflare) que responde
**524** quando a resposta não chega a tempo — o padrão é ~100s.

Para não esperar o proxy cortar, o servidor desiste do stream antes disso:

- `STREAM_TIMEOUT` — tempo máximo até o primeiro pedaço do stream, em
  segundos (padrão `45`). Mantenha abaixo de ~100.

Se o stream estoura esse prazo, o log mostra algo como
`stream não respondeu em 45s (ReadTimeout)` e a chamada segue pelo caminho
bloqueante. Ainda assim o **524 pode aparecer** quando o modelo é lento demais
(alto `MAX_OUTPUT_TOKENS` combinado com raciocínio alto) — nesse caso a única
saída é reduzir `MAX_OUTPUT_TOKENS` ou o nível de raciocínio.
