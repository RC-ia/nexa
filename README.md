# NEXA + 9Router (servidor Python)

Versão da NEXA rodando localmente em Python, conectada a uma API compatível
com OpenAI (`https://9router.rcscan.online/v1`), pensada para rodar em uma
máquina e ser exposta com o túnel do Cloudflare (`cloudflared`).

Estrutura:
- `server.py` — servidor Flask (serve o site + `/api/chat` com streaming SSE)
- `auth.py` — login, cadastro com código por email e sessões
- `run.py` — supervisor: roda o servidor e aplica auto-update via git
- `index.html`, `style.css`, `script.js` — frontend (inalterado)
- `requirements.txt` — dependências Python
- `.env.example` — modelo de configuração
- `nexa.db` — banco SQLite de memória (criado automaticamente)
- `auth.db` — contas, cadastros pendentes e sessões (criado automaticamente, **não versionar**)

## 1. Instalar as dependências

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows (PowerShell/cmd)
pip install -r requirements.txt
```

## 2. Configurar a chave

Copie `.env.example` para `.env` e preencha a chave:

```
API_KEY=sua-chave-aqui
```

Opcionais (já têm padrão): `API_BASE`, `MODEL`, `PORT`, `MAX_OUTPUT_TOKENS`, `MEMORY_DB`.
Nunca versione o `.env` (ele já está no `.gitignore`).

## Login e cadastro

A NEXA exige login para conversar. Na primeira tela dá para **Entrar** com
email e senha ou **Criar conta**: no cadastro o servidor envia um código de
6 dígitos para o email, e a conta só é criada depois que o código é digitado.

Como funciona:

- Senha com no mínimo 8 caracteres, guardada apenas como hash (scrypt).
- O código vale `CODE_TTL_MINUTES` (padrão 10), tem até `CODE_MAX_ATTEMPTS`
  tentativas (padrão 5) e o reenvio espera `RESEND_COOLDOWN` segundos (padrão 60).
  O código também é guardado só como hash.
- A sessão é um cookie `HttpOnly` (`SameSite=Lax`, `Secure` quando o acesso é
  por HTTPS, como no túnel do Cloudflare) e dura `SESSION_DAYS` (padrão 30).
  `POST /api/auth/logout` e o botão **Sair** da gaveta encerram a sessão.
- A memória de longo prazo agora é ligada à conta (o servidor ignora o
  `userId` vindo do navegador). As conversas do `localStorage` ficam
  separadas por conta; as conversas de antes do login vão para a primeira
  conta que entrar naquele navegador.
- Tentativas de login e de cadastro têm limite por IP/email.

### Envio do email (SMTP)

Configure no `.env`:

```
SMTP_HOST=smtp.exemplo.com
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASSWORD=senha-ou-app-password
SMTP_FROM=NEXA <no-reply@exemplo.com>
SMTP_SECURITY=starttls   # ou ssl (porta 465) / none
```

Sem `SMTP_HOST`, o servidor está em **modo desenvolvimento**: nenhum email é
enviado e o código aparece no console (`[NEXA-auth] ... código para ...`).
Use isso só para testar localmente.

Rotas: `POST /api/auth/register`, `/verify`, `/resend`, `/login`, `/logout` e
`GET /api/auth/me`.

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

## Memória

A memória de longo prazo usa SQLite local (`nexa.db`), criado automaticamente
na primeira execução. Se você apagar o arquivo, a memória persistente some
(as conversas no navegador continuam no `localStorage`).

## Barra lateral

O botão **☰** no canto esquerdo abre a gaveta de menu, que desliza por cima
da conversa — ela não empurra o conteúdo, então a largura da conversa
continua a mesma com a gaveta aberta ou fechada.

Dentro dela:

- **Nova conversa** — começa um chat em branco e guarda o anterior na lista.
- **Chats anteriores** — a conversa aberta fica destacada, e a lista vem da
  mais recente para a mais antiga. Passando o mouse aparece o **✕** para
  apagar. O título de cada chat é a primeira mensagem que você mandou.
- **Configurações** — por enquanto é só um aviso; não há nada configurável
  ali ainda.

A gaveta fecha pelo **✕**, clicando fora dela ou com `Esc`.

O botão **Nova conversa** do topo continua funcionando igual: os dois botões
fazem a mesma coisa.

Tudo isso fica no `localStorage`, em `nexa_chats` (a lista de conversas) e
`nexa_active_chat` (qual está aberta). A memória de longo prazo do
`nexa.db` é outra coisa e não é afetada.

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
