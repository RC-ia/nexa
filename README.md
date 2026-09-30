# NEXA + 9Router (servidor Python)

Versão da NEXA rodando localmente em Python, conectada a uma API compatível
com OpenAI (`https://9router.rcscan.online/v1`), pensada para rodar em uma
máquina e ser exposta com o túnel do Cloudflare (`cloudflared`).

Estrutura:

- `server.py` — servidor Flask (serve o site + `/api/chat` com streaming SSE)
- `auth.py` — login, sessões e painel admin
- `run.py` — supervisor: roda o servidor e aplica auto-update via git
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

Opcionais (já têm padrão): `API_BASE`, `MODEL`, `PORT`, `MAX_OUTPUT_TOKENS`,
`MEMORY_DIR`.
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

```bash
python run.py
```

O `run.py` inicia o servidor e fica verificando o git em busca de novas
versões (veja a seção seguinte). Se preferir rodar só o servidor, sem
auto-update:

```bash
python server.py
```

A aplicação sobe em `http://localhost:8000`.

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
  alterações não commitadas em arquivos versionados, o pull falha e é
  registrado no log (sem reiniciar).
- Arquivos como `index.html`, `style.css` e `script.js` passam a valer
  imediatamente; mudanças em `server.py` só valem após o reinício (que o
  próprio `run.py` faz).

## 4. Expor com o túnel do Cloudflare

Em outro terminal:

```bash
cloudflared tunnel --url http://localhost:8000
```

O `cloudflared` imprime uma URL pública (`https://<algo>.trycloudflare.com`)
que aponta para o servidor local.

## Modelo

- Base URL: `https://9router.rcscan.online/v1`
- Modelo: `nada`

## Voz da NEXA

O chat normal é **apenas texto**: não há leitura das respostas em voz alta nem
motor de TTS. A única experiência de voz é a chamada Gemini Live em
`/live.html`. A voz é escolhida **apenas** em **Configurações > Chamada** e fica
salva no navegador; a página da chamada usa essa escolha e não tem seletor
próprio.

## Chamadas Gemini Live

O botão de telefone no composer abre a página própria `/live.html`, que inicia
uma chamada com o modelo `gemini-3.8-live`. Configure `API_GEMA` com uma chave da
Gemini API no `.env`. O servidor emite um token efêmero de uso único; a chave
permanente não é enviada ao navegador. O modo de chamada usa microfone e áudio
em tempo real. O navegador precisa permitir acesso ao microfone; fora de
`localhost`, o site deve estar em HTTPS.

## Memória

A memória de longo prazo é um **único arquivo Markdown por conta**, dentro de
`memoria/`. Não há pedaços acumulando: a cada conversa relevante, o modelo
recebe o documento inteiro e devolve o documento **já consolidado**, que
sobrescreve o arquivo anterior. Assim o modelo sempre lê o contexto completo,
não fragmentos soltos.

O prompt pede explicitamente que sistemas com vários arquivos, números ou etapas
sejam guardados como uma ideia única (por exemplo, "o usuário está criando um
sistema X"), removendo o que ficou obsoleto. O arquivo é limitado a 10.000
caracteres e pode ser editado à mão em **Configurações > Memória**.

Apagar a pasta `memoria/` remove a memória persistente (as conversas do
navegador continuam no `localStorage`).

## Barra lateral

O botão **☰** no canto esquerdo abre a gaveta de menu, que desliza por cima
da conversa — ela não empurra o conteúdo, então a largura da conversa
continua a mesma com a gaveta aberta ou fechada.

Dentro dela:

- **Nova conversa** — começa um chat em branco e guarda o anterior na lista.
- **Chats anteriores** — a conversa aberta fica destacada, e a lista vem da
  mais recente para a mais antiga. Passando o mouse aparece o **✕** para
  apagar. O título de cada chat é a primeira mensagem que você mandou.
- **Configurações** — reúne Chamada, Memória, Instruções, Lembretes e Mais.
  Instruções e preferências de memória ficam separadas por usuário neste
  navegador; lembretes são locais e só disparam enquanto a página estiver aberta.

A gaveta fecha pelo **✕**, clicando fora dela ou com `Esc`.

O botão **Nova conversa** do topo continua funcionando igual: os dois botões
fazem a mesma coisa.

Tudo isso fica no `localStorage`, em `nexa_chats` (a lista de conversas) e
`nexa_active_chat` (qual está aberta). A memória de longo prazo fica nos
arquivos `.md` da pasta `memoria/` e não é afetada.

> **Nota sobre versões antigas:** antes da barra lateral a NEXA guardava uma
> conversa só, em `nexa_conversation`. Na primeira abertura depois dessa
> mudança, essa conversa é migrada sozinha para a lista e a chave antiga é
> apagada. Não é preciso fazer nada manualmente.

## Versão

O rodapé mostra `NEXA vX.XX`, começando em `0.01`. O `run.py` guarda essa
versão em `.nexa_version` (fora do git) e a incrementa em `VERSION_STEP`
(padrão `1`) a cada atualização aplicada — assim dá para ver se o auto-update
funcionou.

- `VERSION_STEP=1` → `0.01`, `1.01`, `2.01`, ...
- `VERSION_STEP=0.01` → `0.01`, `0.02`, `0.03`, ...

O servidor expõe a versão em `GET /api/version`, e o `script.js` preenche o
rodapé ao carregar a página.

## Reforço de raciocínio

Alguns modelos pedem um nível de raciocínio (ou "força de pensamento") para
responder. A NEXA tem um seletor ao lado do microfone com os níveis
**Nenhum / Baixo / Médio / Alto / Máximo**. A escolha fica salva no
`localStorage` do navegador, então não precisa selecionar de novo na próxima
sessão.

O parâmetro enviado à API é configurável no `.env`:

- `REASONING_PARAM` — nome do campo no corpo da requisição (padrão
  `reasoning_effort`).
- `REASONING_VALUES` — valores correspondentes a cada nível, na ordem
  exibida no seletor. Use uma vírgula inicial para o nível "Nenhum" não
  enviar nada. Por exemplo:
  `REASONING_VALUES=,low,medium,high,xhigh`.

Se o modelo não suportar esse parâmetro, basta deixar `REASONING_PARAM`
vazio (desliga o recurso).

## Ver o pensamento

Cada resposta da NEXA tem o seu próprio botão **Pensamento**, logo abaixo do
nome `NEXA` da mensagem. Clicar abre um painel com o raciocínio do modelo
naquela resposta. Todos começam fechados, e o ponto ao lado do botão pulsa
enquanto o modelo pensa.

O painel é preenchido em tempo real, conforme o raciocínio chega no stream,
e cada mensagem é independente: abrir ou fechar uma não mexe nas outras. O
raciocínio também é salvo junto da conversa no `localStorage`, então as
mensagens antigas continuam com o botão funcionando depois de recarregar a
página.

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
