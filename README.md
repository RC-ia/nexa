# NEXA + 9Router

Versão da NEXA com chat conectado a uma API compatível com OpenAI
(`https://9router.rcscan.online/v1`) através de uma Cloudflare Pages Function.

Estrutura:
- index.html
- style.css
- script.js
- functions/api/chat.js

Configuração:
No Cloudflare Pages, crie um Secret chamado `API_KEY` e coloque nele sua chave da API.
Nunca coloque a chave no `script.js` ou em outro arquivo público.
Depois faça um novo deploy.
