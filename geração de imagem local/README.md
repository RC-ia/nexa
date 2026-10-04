# Sistema local de geração de imagens com Automatic1111

## Objetivo

Executar um gerador local de imagens no computador usando o [Automatic1111 / Stable Diffusion WebUI](https://github.com/AUTOMATIC1111/stable-diffusion-webui) como backend real. A interface web em estilo chat envia prompts para `/sdapi/v1/txt2img` e exibe a imagem resultante no próprio chat.

## Backend local

A geração é feita pelo Automatic1111 em execução localmente em:

```text
http://127.0.0.1:7860
```

O app Flask deste diretório consulta `OPTIONS` e `TXT2IMG` na API do SD WebUI. A URL pode ser ajustada com `AUTOMATIC1111_URL` no `.env` local.

## Requisito crítico de ambiente

O Automatic1111 v1.10.1 usado neste fluxo foi validado com Python 3.10.x. O ambiente atual com Python 3.11.x falha ao tentar instalar o pacote `clip` do pipeline legado do SD1.x.

Para evitar a falha, use Python 3.10.6 e mantenha o ambiente virtual em `automatic1111/venv` criado pela própria bootstrap do projeto.

## Interface implementada

A pasta contém um site Flask independente com uma interface simples em estilo chat:

- entrada de texto do prompt;
- envio com **Enter** e nova linha com **Shift+Enter**;
- saída da imagem diretamente na conversa;
- link para abrir e baixar a imagem;
- status de conexão com o Automatic1111;
- poucos parâmetros fixos no servidor, sem painel complexo.

Arquivos principais:

- `app.py`: servidor Flask, integração com o Automatic1111 e armazenamento das imagens;
- `templates/index.html`: tela do chat;
- `static/app.css`: visual da interface;
- `static/app.js`: envio do prompt, estado de carregamento e exibição do resultado;
- `generated/`: imagens geradas localmente;
- `start-local.bat`: inicialização local com verificação de Python 3.10.

### Executar

O modo recomendado é abrir o script local:

```powershell
.\start-local.bat
```

Também é possível rodar isoladamente o app Flask:

```powershell
.\..\.venv\Scripts\python.exe "geração de imagem local\app.py"
```

Nesse modo independente, o servidor local escuta em `0.0.0.0:5001` por padrão, permitindo acesso pelos dispositivos da rede pelo IP do computador, por exemplo `http://192.168.0.10:5001`. A porta pode ser alterada com `IMAGE_APP_PORT`.

## Variáveis esperadas

Configure uma cópia de `.env.example` como `.env` e use as variáveis do backend local:

```dotenv
AUTOMATIC1111_URL=http://127.0.0.1:7860
AUTOMATIC1111_API_KEY=
AUTOMATIC1111_CHECKPOINT=
AUTOMATIC1111_STEPS=28
AUTOMATIC1111_WIDTH=768
AUTOMATIC1111_HEIGHT=768
AUTOMATIC1111_CFG_SCALE=7
AUTOMATIC1111_SAMPLER=DPM++ 2M Karras
IMAGE_APP_PORT=5001
```

## Status atual

A app Flask já está pronta para a integração com Automatic1111, mas o backend local ainda depende de um ambiente compatível com Python 3.10 para concluir a instalação do CLIP e subir o SD WebUI. Sem isso, a startup falha antes da API responder em `:7860`.

## Arquitetura proposta

```text
Interface web ou CLI
        |
        v
API da aplicação
        |
        +--> Catálogo Civitai ----> metadados, versões e licenças
        |
        +--> Fila de geração -----> backend de imagens
        |                              |
        |                              +--> checkpoint / LoRA / VAE
        |
        +--> Banco de dados ------> histórico e parâmetros
        |
        +--> Armazenamento ------> imagens e miniaturas
```

### Componentes

1. **Catálogo de modelos**
   - Consultar modelos e versões disponíveis no Civitai.
   - Exibir nome, autor, tipo, versão, base model, arquivos e licença.
   - Permitir download somente após validação da licença e da compatibilidade.
   - Armazenar o identificador do modelo e da versão usados em cada geração.

2. **Gerenciador de modelos**
   - Organizar checkpoints, LoRAs, embeddings e VAEs.
   - Evitar downloads duplicados por meio do hash do arquivo.
   - Validar espaço em disco, formato e integridade do download.
   - Manter os arquivos fora do controle de versão.

3. **Backend gerador**
   - Receber prompt, negative prompt, modelo, seed, sampler, steps, CFG e resolução.
   - Retornar a imagem, seed efetivo, tempo de execução e eventuais avisos.
   - Expor um adaptador para que o sistema não dependa de um único provedor.

4. **API e fila**
   - Criar tarefas assíncronas para evitar bloqueio durante a geração.
   - Informar estados `queued`, `running`, `completed` e `failed`.
   - Permitir cancelamento e retentativas limitadas.

5. **Histórico**
   - Registrar prompt, parâmetros, modelo, versão, seed, data e resultado.
   - Gerar metadados reproduzíveis para cada imagem.
   - Associar cada resultado ao usuário ou projeto responsável.

## Fluxo principal

1. O usuário pesquisa ou seleciona um modelo do Civitai.
2. O sistema obtém os metadados da versão escolhida.
3. A aplicação verifica a licença, o tipo do modelo e a base compatível.
4. O modelo é baixado ou reutilizado do cache local.
5. O usuário informa prompt, negative prompt e parâmetros.
6. A API cria uma tarefa na fila.
7. O adaptador envia a tarefa ao backend gerador configurado.
8. A imagem e os metadados são armazenados.
9. A interface exibe o resultado e permite repetir a geração com a mesma seed.

## Configuração prevista

As credenciais devem ser fornecidas por variáveis de ambiente ou por um gerenciador de segredos. Nunca salvar tokens no repositório.

```dotenv
CIVITAI_API_KEY=coloque_a_chave_em_arquivo_local
GENERATOR_BASE_URL=http://127.0.0.1:8188
GENERATOR_API_KEY=
CLOUDFLARE_DNS=1.1.1.1
MODEL_CACHE_DIR=./models
OUTPUT_DIR=./outputs
```

`GENERATOR_BASE_URL` é apenas um exemplo e deve apontar para o backend gerador efetivamente escolhido. `CLOUDFLARE_DNS` não transforma o endereço em um gerador; ele representa somente uma configuração opcional de DNS.

## Contrato mínimo do backend

O adaptador deverá normalizar chamadas para um contrato semelhante ao seguinte:

```json
{
  "model": "identificador-da-versao",
  "prompt": "descrição da imagem",
  "negative_prompt": "elementos a evitar",
  "width": 1024,
  "height": 1024,
  "steps": 30,
  "cfg_scale": 7,
  "sampler": "DPM++ 2M Karras",
  "seed": -1
}
```

A resposta deverá conter, no mínimo:

```json
{
  "status": "completed",
  "image_url": "resultado.png",
  "seed": 123456789,
  "model": "identificador-da-versao",
  "duration_ms": 0
}
```

Os nomes dos campos serão adaptados conforme a API do backend escolhido. O sistema não deve presumir que Civitai executa o modelo: Civitai é a fonte do modelo e dos metadados, enquanto a inferência ocorre no backend gerador.

## Requisitos não funcionais

- Usar timeout, retentativa com limite e tratamento de respostas incompletas.
- Validar tamanho e tipo dos arquivos recebidos.
- Aplicar limites de resolução, steps e tarefas simultâneas.
- Isolar credenciais, modelos baixados e imagens geradas.
- Registrar logs sem incluir tokens ou dados sensíveis.
- Verificar a licença de cada modelo antes do uso e redistribuição.
- Respeitar os termos de uso do Civitai e do backend escolhido.
- Aplicar filtros e políticas de conteúdo definidos para o produto.

## Fases de implementação

1. **Integração A1111:** concluída a primeira integração com `txt2img` e bind Flask em `0.0.0.0`.
2. **Interface:** concluído o chat com prompt e saída de imagem.
3. **Catálogo:** implementar seleção visual e armazenamento de metadados do Civitai.
4. **Modelos:** implementar cache, download validado e controle de compatibilidade.
5. **Fila e histórico:** persistir tarefas, resultados e parâmetros reprodutíveis.
6. **Validação:** testar erro de rede, modelo incompatível, cancelamento e repetição por seed.
7. **Operação:** adicionar métricas, backups, limpeza de cache e controle de acesso.

## Critérios de aceite iniciais

- É possível listar modelos e versões do Civitai sem expor a chave de API.
- O sistema identifica e registra a licença do modelo selecionado.
- Uma tarefa de geração pode ser enviada ao backend configurado.
- O resultado é salvo junto com prompt, parâmetros, seed e versão do modelo.
- Falhas de rede ou do backend não deixam tarefas indefinidamente em execução.
- O sistema não trata `1.1.1.1` como endpoint de geração até que seu significado seja confirmado.

## Próximos passos

- Adicionar uma busca discreta de modelos do Civitai à tela, sem transformar o chat em um painel complexo.
- Adicionar seleção e download manual de modelos do Civitai, com confirmação de licença e espaço em disco.
- Persistir histórico de prompts e imagens.
- Adicionar autenticação antes de expor o site fora de uma rede confiável.
- Configurar HTTPS ou um proxy reverso quando o serviço for usado além da rede local.
