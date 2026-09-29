# NEXA + 9Router (servidor Python)

Versão da NEXA rodando localmente em Python, conectada a uma API compatível
com OpenAI (`https://9router.rcscan.online/v1`), pensada para rodar em uma
máquina e ser exposta com o túnel do Cloudflare (`cloudflared`).

Estrutura:
- `server.py` — servidor Flask (serve o site + `/api/chat` com streaming SSE)
- `run.py` — supervisor: roda o servidor e aplica auto-update via git
- `index.html`, `style.css`, `script.js` — frontend (inalterado)
- `requirements.txt` — dependências Python
- `.env.example` — modelo de configuração
- `nexa.db` — banco SQLite de memória (criado automaticamente)

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
