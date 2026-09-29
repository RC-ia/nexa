# NEXA + 9Router (servidor Python)

Versão da NEXA rodando localmente em Python, conectada a uma API compatível
com OpenAI (`https://9router.rcscan.online/v1`), pensada para rodar em uma
máquina e ser exposta com o túnel do Cloudflare (`cloudflared`).

Estrutura:
- `server.py` — servidor Flask (serve o site + `/api/chat` com streaming SSE)
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

Opcionais (já têm padrão): `API_BASE`, `MODEL`, `PORT`, `MEMORY_DB`.
Nunca versione o `.env` (ele já está no `.gitignore`).

## 3. Rodar

```bash
python server.py
```

A aplicação sobe em `http://localhost:8000`.

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

## Observação

A pasta `functions/` (Cloudflare Pages Function) não é mais usada por este
modo de execução e pode ser removida.
