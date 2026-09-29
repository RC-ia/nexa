# NEXA + 9Router

Versão da NEXA com chat conectado a uma API compatível com OpenAI
(`https://9router.rcscan.online/v1`) através de uma Cloudflare Pages Function.

Estrutura:
- index.html
- style.css
- script.js
- functions/api/chat.js
- schema.sql

Configuração:
No Cloudflare Pages, crie um Secret chamado `API_KEY` e coloque nele sua chave da API.
Nunca coloque a chave no `script.js` ou em outro arquivo público.
Depois faça um novo deploy.

Provedor:
- Base URL: `https://9router.rcscan.online/v1`
- Modelo: `nada`

Memória persistente (opcional — D1):
Se o binding `DB` (D1) não existir, o app funciona normalmente, mas sem
memória de longo prazo (as falhas aparecem no log da Function).

Para ativar:
1. Crie um banco D1 e vincule-o ao projeto Pages com o nome de binding `DB`.
2. Aplique o schema:
   `wrangler d1 execute <DB_NAME> --remote --file=./schema.sql`
3. Faça um novo deploy.
