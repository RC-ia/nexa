
# NEXA + 9Router

NEXA é uma assistente web executada por um servidor Flask em Python. O backend
conversa com um provedor compatível com a API da OpenAI, mantém autenticação e
dados por conta e pode ser exposto externamente por um túnel como o
Cloudflare Tunnel.

O fluxo atual é composto por um chat multimodal, pesquisa web, pesquisa
profunda, memória persistente, lembretes, chamada de voz Gemini Live, geração
de imagens e um Estúdio para trabalho com arquivos.

## Visão geral

### Recursos atuais

- **Chat multimodal** — texto, imagens e arquivos de texto/código/configuração.
- **Autenticação por conta** — login obrigatório, usuários criados pelo admin,
  sessões persistentes e credencial separada para chamadas protegidas.
- **Memória de longo prazo** — uma memória consolidada por conta, editável nas
  configurações e utilizada no contexto do modelo.
- **Pesquisa web** — busca no DuckDuckGo e leitura do conteúdo principal de
  páginas.
- **Pesquisa profunda** — agente separado que interpreta o pedido, pesquisa em
  várias rodadas e entrega um relatório ao fluxo principal.
- **Níveis de pensamento** — Rápido, Mínimo, Baixo, Médio, Alto, Muito alto,
  Máximo e Ultra.
- **Lembretes** — eventos únicos ou recorrentes, com agente próprio para
  executar a tarefa e entregar a mensagem.
- **Notificações** — polling pela página e push opcional via Firebase Cloud
  Messaging.
- **Gemini Live** — chamada de voz em tempo real com token efêmero emitido pelo
  servidor.
- **Modo Imagens** — área separada do chat normal para geração de imagens via
  Novita AI, com galeria e agente que expande/traduz o prompt.
- **Estúdio** — espaço de trabalho isolado por conta para um agente de código
  ler, escrever e organizar arquivos.
- **Sincronização de conversas** — os chats ficam no servidor e o navegador
  funciona como cache local.
- **System prompt por conta** — cada usuário pode substituir o prompt padrão
  por uma versão própria.

## Arquitetura

O projeto é deliberadamente concentrado em um único servidor Flask.

| Arquivo | Função |
| --- | --- |
| `server.py` | Backend principal, rotas HTTP, streaming SSE, agentes, memória, pesquisa, lembretes, imagens, Live e Estúdio. |
| `auth.py` | Usuários, hash de senhas, sessões, credencial de mensagens e painel administrativo. |
| `run.py` | Supervisor do servidor e atualização automática via Git. |
| `launcher.py` | Inicia/encerra o supervisor em modo desanexado/daemon. |
| `server_manager.py` | Wrapper usado pelo painel admin para controlar o supervisor. |
| `index.html` / `style.css` / `script.js` | Interface principal do chat. |
| `live.html` / `live.css` / `live.js` | Interface da chamada Gemini Live. |
| `studio.html` / `studio.css` / `studio.js` | Interface do Estúdio. |
| `requirements.txt` | Dependências Python. |
| `schema.sql` | Schema legado/independente do fluxo atual de memória; não é usado pelo startup atual. |
| `image_generator.py` | Wrapper legado para um gerador local externo; não participa do caminho atual de geração do servidor. |

Arquivos e diretórios criados durante a execução normalmente ficam fora da
árvore de código:

- `.env` — configuração e chaves.
- `auth.db` — banco de autenticação.
- `.nexa_version` — versão operacional do servidor.
- `.nexa_server.log` / `.nexa_server.pid` — arquivos usados pelo launcher.
- `memoria/` — memória, system prompt, chats, lembretes, tokens push e
  configurações por conta.
- `estudio/` — arquivos do Estúdio.
- `generated/` — imagens geradas.
- `firebase-key.json` ou `chave-firebase.json` — chave de serviço opcional do
  Firebase.

## Requisitos

É necessário ter Python, Git e, quando for usar acesso público externo,
Cloudflared.

As dependências da aplicação são:

~~~text
Flask>=3.0.0
requests>=2.31.0
python-dotenv>=1.0.0
google-auth>=2.30.0
beautifulsoup4>=4.12.0
~~~

### Instalação

Windows:

~~~bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
~~~

Linux/macOS:

~~~bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
~~~

## Configuração

O servidor carrega `.env` automaticamente.

Não dependa de `.env.example` neste snapshot do repositório: ele não está
presente no branch atual. Crie o arquivo `.env` manualmente a partir das
variáveis abaixo.

### Configuração mínima

~~~env
API_KEY=sua-chave-do-provedor
ADMIN_USER=admin
ADMIN_PASSWORD=uma-senha-forte
~~~

O chat usa `API_BASE`, `MODEL` e as demais opções descritas a seguir.

### Variáveis principais

| Variável | Padrão atual | Função |
| --- | --- | --- |
| `API_KEY` | vazio | Chave do provedor compatível com OpenAI usado pelo chat e pelos agentes. |
| `API_BASE` | `https://9router.rcscan.online/v1` | Base URL da API compatível com OpenAI. |
| `MODEL` | `nada` | Modelo textual principal. |
| `MODEL_FLASK` | vazio | Modelo opcional exclusivo para o modo Rápido; vazio usa `MODEL`. |
| `VISION_MODEL` | `nvidia/google/diffusiongemma-26b-a4b-it` | Modelo usado pelo agente visual. |
| `PORT` | `8000` | Porta local do Flask. |
| `MAX_OUTPUT_TOKENS` | `1024` | Limite de saída usado por chamadas principais. |
| `MAX_TOOL_ROUNDS` | `4` | Máximo de ciclos adicionais de ferramentas no fluxo normal. |
| `STREAM_TIMEOUT` | `45` | Tempo máximo de espera pelo primeiro trecho do stream antes do fallback bloqueante. |
| `MEMORY_DIR` | `memoria` | Diretório de dados persistentes por conta. |
| `NEXA_UTC_OFFSET` | `-3` | Deslocamento fixo em relação ao UTC usado pelo sistema de data/hora. |
| `VERSION_FILE` | `.nexa_version` | Arquivo que guarda a versão operacional. |

### Pensamento

Os níveis diferentes de Rápido utilizam um agente adicional de resolução/revisão.

| Nível | Rodadas padrão |
| --- | ---: |
| Mínimo | 1 |
| Baixo | 3 |
| Médio | 6 |
| Alto | 8 |
| Muito alto | 12 |
| Máximo | 16 |
| Ultra | 24 |

Variáveis correspondentes:

~~~env
THINKING_MINIMUM_ROUNDS=1
THINKING_LOW_ROUNDS=3
THINKING_MEDIUM_ROUNDS=6
THINKING_HIGH_ROUNDS=8
THINKING_VERY_HIGH_ROUNDS=12
THINKING_MAXIMUM_ROUNDS=16
THINKING_ULTRA_ROUNDS=24
THINKING_AGENT_MAX_TOKENS=1200
FLASK_THINK=true
~~~

O sistema não depende de um parâmetro externo como `reasoning_effort`. O
reforço é implementado pela quantidade de ciclos do agente.

### Pesquisa

~~~env
SEARCH_PATIENCE=120
SEARCH_RETRY_DELAY=4
SEARCH_MAX_ATTEMPTS=12
SEARCH_HEARTBEAT=15
DEEP_RESEARCH_AGENT=Pesquisador
DEEP_RESEARCH_MAX_ROUNDS=10
DEEP_RESEARCH_TIMEOUT=120
LIVE_SEARCH_PATIENCE=20
~~~

A pesquisa comum consulta o DuckDuckGo por HTML, devolve até cinco resultados
por consulta e pode abrir as páginas usando os prefixos `P1`, `P2` etc.

A pesquisa profunda pode ser ajustada por usuário de 1 a 30 rodadas. O valor
inicial é definido por `DEEP_RESEARCH_MAX_ROUNDS`.

Quando uma busca demora, o servidor usa o heartbeat de streaming para evitar
uma conexão completamente ociosa. Se a pesquisa falhar depois do orçamento
configurado, o fluxo retorna ao modelo sem fabricar resultados ou fontes.

### Estúdio

~~~env
STUDIO_DIR=estudio
STUDIO_AGENT=Dev
STUDIO_MAX_OUTPUT_TOKENS=8000
STUDIO_TOOL_ROUNDS=8
STUDIO_READ_LIMIT=60000
STUDIO_WRITE_LIMIT=200000
STUDIO_LIST_LIMIT=300
~~~

O Estúdio mantém seu espaço isolado por conta. Os limites padrões são 60.000
caracteres por leitura, 200.000 por escrita, 300 entradas na listagem, oito
rodadas de ferramentas e 8.000 tokens de saída.

### Imagens

A geração é opcional e usa a integração de imagens configurada no servidor.

~~~env
API_IMAGE=sua-chave-da-api-de-imagem
MODEL_IMAGE=nome-do-modelo
IMAGE_API_URL=https://api.novita.ai/openai/v1/images/generations
IMAGE_GENERATION_TIMEOUT=300
IMAGE_OUTPUT_FORMAT=png
IMAGE_RESPONSE_FORMAT=b64_json
IMAGE_SIZE=1024x1024
IMAGE_WATERMARK=false
MAX_PROMPT_LENGTH=4000
IMAGE_PROMPT_AGENT=true
IMAGE_PROMPT_AGENT_TIMEOUT=60
IMAGE_PROMPT_AGENT_MAX_TOKENS=600
IMAGE_OUTPUT_DIR=generated
~~~

`API_IMAGE` e `MODEL_IMAGE` são obrigatórios para ativar a geração.

O agente de prompt recebe a descrição do usuário e a transforma em um prompt
em inglês mais detalhado antes de enviar o pedido ao modelo de imagem. Esse
agente pode ser desligado com `IMAGE_PROMPT_AGENT=false`.

O botão 😈 do Modo Imagens utiliza um prompt alternativo, administrado no
servidor, para a variação sensual do gerador.

As imagens retornadas são armazenadas em `generated/` e são servidas apenas
para usuários autenticados.

### Gemini Live

A chamada de voz usa um modelo fixo no backend:

`models/gemini-3.8-live`.

A integração usa uma credencial efêmera emitida pelo servidor; a chave
permanente de Gemini não é enviada para o navegador.

~~~env
API_GEMA=sua-chave-da-gemini-api
~~~

A voz é escolhida em **Configurações > Chamada**. A chamada usa microfone e
áudio em tempo real. A busca web também pode ser usada durante a chamada, com
um orçamento próprio definido por `LIVE_SEARCH_PATIENCE`.

### Lembretes e push

~~~env
REMINDER_ACTION_ROUNDS=5
FCM_KEY=firebase-key.json
SITE_URL=https://nexa2.rcscan.online/
~~~

O sistema aceita lembretes únicos e recorrentes. O agente de ações pode
pesquisar na web e ler páginas durante a execução.

Cada conta pode ter até 50 lembretes ativos. Disparos pendentes ficam
disponíveis por sete dias.

O push é opcional. Para ativá-lo, coloque uma chave de serviço do Firebase na
raiz ou informe seu caminho em `FCM_KEY`. Sem uma chave válida, os lembretes
continuam funcionando pela fila da página.

## Autenticação e segurança

O login é obrigatório. Não existe cadastro público: usuários são criados no
**Painel admin**.

No primeiro start, quando ainda não existe nenhum administrador, o servidor
cria a conta definida por `ADMIN_USER` usando obrigatoriamente
`ADMIN_PASSWORD`. Se `ADMIN_PASSWORD` não estiver configurada, o servidor
interrompe a inicialização com erro. Não existe geração automática de senha no
código atual.

Regras atuais:

- Usuário: 3 a 64 caracteres, normalizado para minúsculas, usando letras,
  números e `_ . @ + -`.
- Senha: entre 8 e 128 caracteres.
- Senhas: armazenadas somente como hash usando o mecanismo de segurança do
  Werkzeug.
- Sessão: cookie `HttpOnly`, `SameSite=Lax` e `Secure` quando o acesso HTTPS é
  detectado.
- Duração da sessão: `SESSION_DAYS`, 30 dias por padrão.
- Credencial de mensagens: token aleatório de 64 caracteres, armazenado apenas
  como hash no banco e válido por 24 horas.
- Trocar a senha ou apagar a conta encerra as sessões daquela conta.
- Tentativas de login são limitadas por IP e usuário.

O backend também aplica headers de segurança, incluindo:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- política de referrer restritiva.
- CSP para limitar origens de scripts, estilos, mídia e conexões.
- HSTS quando a requisição chega por HTTPS.

## Executar

### Servidor direto

~~~bash
python server.py
~~~

O servidor abre por padrão em:

~~~text
http://localhost:8000
~~~

Esse modo não verifica atualizações do Git automaticamente.

### Supervisor com atualização automática

~~~bash
python run.py
~~~

O supervisor inicia `server.py`, reinicia o processo se ele morrer e, quando
`AUTO_UPDATE` estiver ativo, consulta o remoto Git a cada `UPDATE_INTERVAL`
segundos.

Configuração:

~~~env
AUTO_UPDATE=1
UPDATE_INTERVAL=180
GIT_REMOTE=origin
GIT_BRANCH=
VERSION_STEP=1
~~~

`UPDATE_INTERVAL` nunca fica abaixo de 30 segundos.

O update usa:

~~~text
git fetch
git pull --ff-only
~~~

O `--ff-only` impede que o supervisor faça merge automático de alterações
locais. Em caso de conflito ou estado incompatível, o update falha e fica
registrado no log.

A versão operacional começa em `0.01` e aumenta por `VERSION_STEP` sempre que
uma atualização é aplicada. O valor é mantido em `.nexa_version`, fora do
repositório.

### Processo desanexado

~~~bash
python launcher.py start
python launcher.py status
python launcher.py stop
python launcher.py stop --force
python launcher.py restart
~~~

O launcher inicia o supervisor, não apenas o Flask diretamente. Dessa forma,
o auto-update continua disponível mesmo no processo desanexado.

Em Windows o launcher usa processo separado e redireciona a saída para
`.nexa_server.log`. Em Linux ele utiliza double-fork/daemonização e grava o
PID do processo de supervisão em `.nexa_server.pid`.

O painel administrativo utiliza o `server_manager.py` para oferecer as mesmas
operações de iniciar, parar, reiniciar e consultar status.

## Cloudflare Tunnel

Para expor uma instância local:

~~~bash
cloudflared tunnel --url http://localhost:8000
~~~

O endereço público precisa ser HTTPS para recursos de navegador que dependem
de contexto seguro, como acesso ao microfone fora de `localhost`.

## Chat multimodal

O chat aceita:

- texto;
- imagens;
- arquivos de texto, código e configuração.

A primeira mensagem também pode gerar automaticamente o título da conversa por meio de `POST /api/chat/title`; se essa geração falhar, o backend usa um fallback baseado na própria mensagem.

Arquivos de texto/código são limitados a 2 MiB e a extensões conhecidas, como
`.txt`, `.md`, `.json`, `.html`, `.css`, `.js`, `.ts`, `.py`, `.java`,
`.cpp`, `.c`, `.go`, `.rs`, `.php`, `.sql`, `.yaml` e `.toml`.

A análise visual é feita primeiro pelo agente definido em `VISION_MODEL` e o
relatório textual é entregue ao modelo principal. Isso permite que o modelo
de resposta trabalhe com uma descrição estruturada mesmo quando não recebe
diretamente a imagem.

O chat normal não faz TTS. A única experiência de voz é o Gemini Live.

## Memória

Cada conta tem uma memória consolidada em:

~~~text
memoria/<conta>.md
~~~

O documento entra no system prompt quando a memória está habilitada.

O próprio modelo pode chamar a ferramenta `salvar_memoria` durante a conversa.
A memória é reescrita como um documento consolidado em vez de ficar espalhada
em pequenas entradas.

Limite atual: 10.000 caracteres.

A memória também pode ser editada manualmente em **Configurações >
Memória**.

Além do arquivo de memória, cada conta pode ter:

~~~text
memoria/<conta>.prompt.txt
memoria/<conta>.deep.json
memoria/<conta>.tz.json
memoria/<conta>.reminders.json
memoria/<conta>.push.json
memoria/<conta>.chats.json
~~~

O `prompt.txt` é o system prompt personalizado da conta. O tamanho máximo é
20.000 caracteres.

## Pesquisa profunda

A pesquisa profunda não usa diretamente o histórico bruto como contexto do
pesquisador.

O fluxo é:

1. o agente de intenção transforma a solicitação atual em um tema
   autocontido;
2. o pesquisador executa buscas em várias rodadas;
3. resultados importantes podem ser abertos com `visitar_pagina`;
4. o relatório é entregue ao fluxo de pensamento ou ao modelo final conforme o
   nível selecionado.

Quando há uma imagem, o agente visual analisa a imagem antes da etapa de
intenção. O relatório visual também é enviado como contexto factual para a
pesquisa.

No modo Rápido, a pesquisa profunda segue diretamente para o modelo final sem
o agente adicional de pensamento.

## Lembretes

A ferramenta `criar_lembrete` pode criar:

- **único** — dispara uma vez;
- **recorrente** — horário, diário, semanal ou mensal.

Para lembretes mensais, dias que não existem naquele mês usam o último dia
disponível.

O lembrete pode ser apenas uma mensagem ou uma ação. Quando há uma instrução
de ação, o agente de lembretes pode usar pesquisa web, leitura de páginas e
data/hora antes de gerar a mensagem final.

O servidor mantém um scheduler em uma thread daemon.

A página consulta os novos disparos pela rota:

~~~text
GET /api/reminders/due?since=<cursor>
~~~

Cada aparelho mantém seu próprio cursor, permitindo que mais de um dispositivo
receba o mesmo lembrete.

## Sincronização das conversas

As conversas ficam no servidor:

~~~text
memoria/<conta>.chats.json
~~~

O navegador mantém uma cópia em `localStorage` para acesso rápido.

Cada conversa possui uma revisão (`rev`). Quando dois aparelhos tentam
alterar a mesma conversa, o servidor detecta uma revisão antiga e responde
`409` com a versão atual. O cliente então pode mesclar a conversa sem repetir
mensagens que já tenham sido gravadas.

Limites:

| Recurso | Limite |
| --- | ---: |
| Conversas por conta | 500 |
| Mensagens por conversa | 5.000 |
| Armazenamento total das conversas | 5 MiB |
| Tamanho de uma mensagem | 200.000 caracteres |
| Histórico enviado por chamada | 12 mensagens |

Apagar uma conversa no servidor vale para os demais aparelhos da mesma conta.

## Modo Imagens

O Modo Imagens é separado do chat normal.

A gaveta lateral abre **Imagens**, que possui:

- conversa própria de geração;
- campo de prompt;
- modo 😈 opcional;
- galeria local das imagens da sessão;
- armazenamento dos arquivos produzidos em `generated/` no servidor e galeria mantida no navegador.

A rota de geração é:

~~~text
POST /api/images/generate
~~~

Existe também:

~~~text
GET /api/images/status
GET /generated/<filename>
~~~

Todas as rotas de imagem exigem autenticação.

## Gemini Live

A página de chamada fica em:

~~~text
/live.html
~~~

O fluxo é:

1. o navegador verifica a sessão;
2. o servidor emite um token efêmero usando `API_GEMA`;
3. o navegador abre a conexão Live com esse token;
4. tool calls solicitadas pelo Gemini passam pelo endpoint autenticado do
   servidor.

Ferramentas disponíveis na chamada:

- `pesquisar`;
- `visitar_pagina`;
- `data_hora`;
- `criar_lembrete`.

A chave permanente da Gemini permanece no servidor.

## Estúdio

O Estúdio fica em:

~~~text
/studio.html
~~~

Ele fornece um agente de código com acesso ao diretório de trabalho da conta.

Principais operações do backend:

~~~text
GET  /api/studio/files
GET  /api/studio/file
GET  /api/studio/raw
POST /api/studio/chat
~~~

A interface também possui:

- árvore de arquivos;
- busca;
- abas de arquivos abertos;
- visualização com destaque de sintaxe;
- copiar conteúdo;
- download;
- chat separado para o agente.

O acesso ao diretório é validado no backend para manter o trabalho dentro do
espaço do Estúdio.

## System prompt por usuário

Cada usuário pode editar seu próprio system prompt em:

**Configurações > Instruções**

Rotas:

~~~text
GET    /api/system-prompt
PUT    /api/system-prompt
DELETE /api/system-prompt
~~~

Quando existe uma versão personalizada, ela substitui o prompt padrão apenas
para aquela conta.

Também existem configurações individuais para:

- pesquisa profunda;
- fuso horário;
- memória.

As configurações técnicas dos agentes são exibidas como somente leitura na
interface.

## Rotas HTTP principais

| Área | Rotas |
| --- | --- |
| Autenticação | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Admin | `GET/POST /api/admin/users`, `POST /api/admin/users/<id>/password`, `DELETE /api/admin/users/<id>` |
| Servidor | `GET /api/admin/server/status`, `POST /api/admin/server/start`, `POST /api/admin/server/stop`, `POST /api/admin/server/restart` |
| Chat | `POST /api/chat`, `POST /api/chat/title`, `POST /api/greeting`, `GET /api/version` |
| Memória | `GET/PUT /api/memories`, `DELETE /api/memories` |
| Prompt | `GET/PUT /api/system-prompt`, `DELETE /api/system-prompt` |
| Agentes | `GET/PUT /api/deep-settings`, `GET /api/agent-settings` |
| Data/hora | `GET/PUT /api/time-settings` |
| Lembretes | `GET /api/reminders`, `DELETE /api/reminders/<id>`, `GET /api/reminders/due` |
| Chats | `GET /api/chats`, `PUT /api/chats/<id>`, `DELETE /api/chats/<id>`, `DELETE /api/chats` |
| Push | `POST /api/push-token`, `GET /api/push-status` |
| Live | `GET /api/live/voices`, `POST /api/live/token`, `POST /api/live/tool` |
| Imagens | `GET /api/images/status`, `POST /api/images/generate` |
| Estúdio | `GET /api/studio/files`, `GET /api/studio/file`, `GET /api/studio/raw`, `POST /api/studio/chat` |

## Timeouts e falhas

O chat tenta streaming primeiro. Quando o stream não entrega dados no tempo
definido por `STREAM_TIMEOUT`, o backend tenta a chamada bloqueante.

Para pesquisas, os parâmetros `SEARCH_PATIENCE`, `SEARCH_RETRY_DELAY` e
`SEARCH_MAX_ATTEMPTS` determinam quanto tempo e quantas tentativas são
aceitas.

O objetivo é que uma falha de pesquisa, de imagem ou de um agente não deixe a
conversa presa indefinidamente: o erro é transformado em contexto para que o
fluxo possa continuar ou retornar uma resposta informando que a operação não
foi verificada.

## Estado do repositório e manutenção

O branch atual do repositório contém alguns artefatos que não fazem parte do
caminho principal documentado, incluindo:

~~~text
cookies.txt
dataset.lnk
nexa.db
nexa-login.patch
download
cola.html
~~~

Eles devem ser revisados antes de uma distribuição pública/produção.

Em particular:

- `download` contém regras que parecem ser o conteúdo pretendido de um
  `.gitignore`;
- `nexa.db` não é usado pelo runtime atual;
- `schema.sql` também não é referenciado pelo fluxo atual do servidor;
- `image_generator.py` aponta para um gerador local externo e não é importado
  pelo startup atual;
- `cola.html`, `dataset.lnk` e `nexa-login.patch` não fazem parte do caminho
  normal de inicialização.

O repositório atual também não contém um `.gitignore` efetivo nem um
`.env.example`. Antes de colocar a aplicação em uma máquina de produção,
recomenda-se criar esses arquivos e garantir que chaves, bancos, logs, dados
de conta, memórias e arquivos gerados nunca sejam versionados.

## Desenvolvimento

O código atual não inclui uma suíte de testes automatizados nem um workflow de
CI na árvore principal. A validação funcional completa ainda depende de subir
o serviço, configurar os provedores e exercitar cada fluxo no ambiente de
execução.

Para acompanhar o servidor diretamente:

~~~bash
python run.py
~~~

Para uma execução desanexada:

~~~bash
python launcher.py start
~~~

Logs do supervisor desanexado ficam em `.nexa_server.log`.

