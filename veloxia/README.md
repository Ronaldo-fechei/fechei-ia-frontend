# Veloxia — automação de conversas para negócios

Automação de **Instagram** (Direct, comentários e Stories) e **WhatsApp** (Cloud API) **usando somente as APIs oficiais da Meta**.

O usuário cria uma conta, conecta o Instagram profissional e/ou o WhatsApp da empresa pelo login oficial da Meta, cadastra palavras-chave e respostas (ou monta um fluxo visual), publica — e cada mensagem real recebida é respondida automaticamente, com histórico, caixa de entrada única, contatos e métricas. Os planos são pagos pelo Mercado Pago; as mensagens do WhatsApp são cobradas pela Meta direto na conta do cliente.

> Sem scraping, sem automação de navegador, sem senha do Instagram ou do WhatsApp. Quando a API oficial não oferece um recurso (ex.: evento de novo seguidor), o painel informa isso em vez de simular.

---

## Sumário

1. [Recursos](#recursos)
2. [Arquitetura](#arquitetura)
3. [Rodando localmente](#rodando-localmente)
4. [Configurando o app da Meta (passo a passo)](#configurando-o-app-da-meta-passo-a-passo)
   - [WhatsApp](#whatsapp-cloud-api--cadastro-incorporado)
   - [Mercado Pago](#mercado-pago)
5. [Deploy em produção](#deploy-em-produção)
6. [Variáveis de ambiente](#variáveis-de-ambiente)
7. [Planos, limites e pagamentos](#planos-limites-e-pagamentos)
8. [Limitações da API oficial](#limitações-da-api-oficial)
9. [Segurança e privacidade](#segurança-e-privacidade)
10. [Testes](#testes)
11. [Critérios de aceitação](#critérios-de-aceitação)
12. [Personalização e próximos passos](#personalização-e-próximos-passos)

---

## Recursos

| Área | O que faz |
| --- | --- |
| **Canais** | **Instagram:** OAuth da *API do Instagram com login do Instagram*, token de longa duração renovado automaticamente. **WhatsApp:** *cadastro incorporado* (Embedded Signup) da Meta — o cliente escolhe a empresa e o número numa janela oficial; registro do número, inscrição de webhooks, qualidade e limite do número, modo app + API (coexistência). Reconectar/desconectar. Tokens criptografados (AES-256-GCM), nunca exibidos. |
| **Arquitetura multicanal** | Registro de canais (`shared/src/channels.ts`) + um *driver* por canal no servidor (`server/src/channels/`) + pipeline de entrada comum (`engine/inbound.ts`). Um novo aplicativo (ex.: Messenger) entra implementando o driver e o tradutor de webhook — motor, construtor, inbox e CRM não mudam. |
| **Automações** | Criação rápida (palavra-chave → resposta com link/imagem/atraso) ou **construtor visual** com gatilho, palavra-chave, mensagem, imagem, vídeo, link, botões, condição, aguardar, adicionar/remover tag, capturar informação, atendimento humano e finalizar. Arrastar, conectar, zoom, salvamento automático, desfazer/refazer, validação, simulador e publicação versionada. |
| **Gatilhos** | Mensagem direta (Instagram, WhatsApp ou os dois na mesma automação), comentário em publicação/reel (Comentário → Direct com resposta privada e resposta pública opcional), resposta a Story, menção em Story. "Novo seguidor" aparece como **indisponível** (a API não envia esse evento). |
| **Palavras-chave** | Contém a palavra, contém a frase, exata, começa com, termina com. Sem diferenciar maiúsculas, com opção de ignorar acentos. A mais específica vence; prioridade manual e detecção de conflitos. |
| **Proteções** | Idempotência de webhooks, uma execução ativa por contato/automação, intervalo anti-repetição (cooldown), janela de 24 h, limite por plano, opt-out, pausa em atendimento humano. |
| **WhatsApp** | Botões (até 3), listas, botão de link (CTA), imagens e vídeos; **modelos de mensagem** (criar, sincronizar, excluir; status da análise da Meta); bloco **"Modelo do WhatsApp"** para falar fora da janela de 24 h; **sequências** com esperas de até 30 dias; consumo do mês com estimativa de custo por categoria. |
| **Instagram → WhatsApp** | Bloco que envia no Direct um botão rastreado para abrir conversa no WhatsApp da empresa, com mensagem já digitada. |
| **Inbox** | Instagram e WhatsApp juntos, em tempo real (SSE), filtro por canal, "Assumir conversa" e "Retomar automação", envio manual dentro da janela e envio de modelo aprovado depois dela (WhatsApp). |
| **CRM** | Contatos com foto/nome (User Profile API), tags, campos personalizados, captura de e-mail/telefone/texto, histórico e exportação CSV. |
| **Métricas** | Dashboard e analytics com filtros (hoje, 7, 30, 90 dias, período): mensagens, contatos, cliques em links rastreados, palavras mais pedidas, horários de pico, desempenho por automação. |
| **Modelos prontos** | Envio de link, FAQ, produto, promoção, captura de lead, atendimento (Instagram + WhatsApp), Instagram → WhatsApp, sequência no WhatsApp, comentário→DM, story→DM, menção em story — "Usar este modelo". |
| **Planos e cobrança** | Gratuito, Starter, Pro (preço de lançamento) e Business, mensal ou anual, pagos pelo **Mercado Pago** (assinatura no cartão ou pagamento anual por PIX/cartão/boleto). Limites por contatos ativos/mês, canais e automações. |
| **IA (opcional)** | Gera rascunhos de automação e reescreve mensagens no tom da marca. **Nunca publica nem envia sozinha.** |
| **Operação** | Logs de execução com motivo de cada "não respondeu", notificações, painel de administração (jobs, webhooks, erros, planos), callbacks de desautorização e exclusão de dados da Meta. |

---

## Arquitetura

```
veloxia/
├── shared/   Regras puras em TypeScript usadas pelo servidor e pelo painel:
│             palavras-chave, variáveis, schema/validação de fluxos, modelos, constantes.
├── server/   API (Fastify) + worker da fila + motor de automação + integração com a Meta.
│   ├── src/config        Variáveis de ambiente validadas
│   ├── src/db            Schema (Drizzle/PostgreSQL), migrações e seed de planos
│   ├── src/channels      Drivers por canal (Instagram, WhatsApp), registro e tradutores de webhook
│   ├── src/integrations  Clientes HTTP: Graph API do Instagram, WhatsApp Cloud API, Mercado Pago
│   ├── src/engine        Pipeline de entrada comum, matching, runner de fluxos, executor e simulador
│   ├── src/queue         Fila durável no Postgres (SKIP LOCKED + LISTEN/NOTIFY), worker e agendador
│   ├── src/modules       Rotas por domínio (auth, instagram, automations, inbox, crm, analytics…)
│   └── test              Testes de integração contra um PostgreSQL real
└── web/      Painel (React 19 + Vite + Tailwind v4 + React Query + React Flow)
```

### Caminho de uma mensagem

```
Instagram ──POST──▶ /api/webhooks/instagram   (WhatsApp: /api/webhooks/whatsapp — mesmo caminho)
                     1. valida X-Hub-Signature-256 (HMAC do corpo bruto)
                     2. grava em webhook_events (dedupe pelo hash do corpo) + cria job — mesma transação
                     3. responde 200 em milissegundos (500 se o banco falhar → a Meta reenvia)
                              │
                    fila no PostgreSQL (retry com backoff, dead-letter, jobs agendados)
                              ▼
worker ─▶ processWebhookEvent
           • contato e conversa (upsert com lock) • mensagem (único por mid) • eco/edição/leitura
           • matching: palavra-chave > gatilho genérico > prioridade manual > especificidade
           • regras: conta conectada, opt-out, atendimento humano, permissões, cooldown, limite do plano
           • cria execução ─▶ runFlow (interpretador puro) ─▶ driver do canal ─▶ /me/messages ou /{phone-id}/messages
           • esperas (aguardar, botões, captura) viram jobs agendados; logs, métricas e eventos em tempo real
```

O motor não conhece nenhum canal diretamente: ele fala com a interface `ChannelAdapter`, e cada canal registra um `ChannelDriver` (envio, perfil do contato, inscrição de webhooks, renovação de token). O simulador usa o **mesmo interpretador** com um runtime em memória — por isso o "Testar" mostra exatamente o que seria enviado, sem enviar nada.

**Escala:** a API é stateless (sessão em cookie opaco + tabela `sessions`), vários workers podem rodar em paralelo (`FOR UPDATE SKIP LOCKED`) e o tempo real usa `LISTEN/NOTIFY`, então dá para rodar múltiplas instâncias sem Redis.

---

## Rodando localmente

Requisitos: **Node.js 22** (mínimo 20.12) e **PostgreSQL 14+**.

```bash
cd veloxia
docker compose up -d          # PostgreSQL 16 com os bancos "veloxia" e "veloxia_test" (ou use um Postgres seu)
cp .env.example server/.env   # ajuste DATABASE_URL se necessário
npm install
npm run db:migrate            # cria as tabelas e os planos padrão
npm run dev                   # API em http://localhost:3333 e painel em http://localhost:5173
```

Abra http://localhost:5173, crie uma conta e explore. Sem as credenciais da Meta o painel funciona normalmente — automações, construtor, simulador (com Instagram e WhatsApp), contatos — e mostra em **Ajuda → Configuração técnica** exatamente o que falta para conectar cada canal e o Mercado Pago.

> **Atualizando de uma versão anterior (antes do WhatsApp):** o schema foi reescrito antes do lançamento. Recrie o banco (`dropdb veloxia && createdb veloxia && npm run db:migrate`) — não há migração incremental da versão só-Instagram.

Para receber webhooks reais em desenvolvimento, exponha a porta 3333 com HTTPS (ex.: `cloudflared tunnel --url http://localhost:3333` ou `ngrok http 3333`) e use essa URL como `APP_URL` e nas configurações do app da Meta. Nesse caso sirva o painel pela própria API (`npm run build --workspace web`) para ficar tudo no mesmo domínio.

Scripts úteis (na pasta `veloxia/`):

| Comando | O que faz |
| --- | --- |
| `npm run dev` | API (com worker embutido) + painel com recarga automática |
| `npm run build` / `npm start` | Build de produção e execução (a API serve o painel) |
| `npm run db:generate` | Gera uma nova migração após alterar `server/src/db/schema.ts` |
| `npm run db:migrate` | Aplica migrações e garante os planos padrão |
| `npm run typecheck` / `npm test` | Checagem de tipos e testes |
| `npm run plan:set --workspace server -- email@cliente.com pro` | Troca o plano de um cliente |

---

## Configurando o app da Meta (passo a passo)

O Veloxia usa a **API do Instagram com login do Instagram** (Instagram API with Instagram Login), que não exige Página do Facebook. A versão da Graph API fica em `META_GRAPH_API_VERSION` (padrão `v25.0`).

> Os nomes dos menus do painel da Meta mudam com frequência. Se algo estiver diferente, procure pelos termos entre aspas. Todas as URLs abaixo também aparecem, prontas para copiar, em **Ajuda → Configuração técnica** dentro do app.

1. **Crie o app** em [developers.facebook.com/apps](https://developers.facebook.com/apps) → tipo **Empresa** (Business).
2. **Adicione o produto Instagram** e abra **"Configuração da API com login do Instagram"** (*API setup with Instagram login*).
3. Copie o **ID do app do Instagram** e a **chave secreta do app do Instagram** (são diferentes do ID/chave do app do Facebook) para `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`.
4. Em **"Configurar o login comercial do Instagram"** (*Business login settings*):
   - **URL de redirecionamento do OAuth:** `https://SEU_DOMINIO/api/instagram/callback`
   - **URL de retorno de chamada de cancelamento de autorização:** `https://SEU_DOMINIO/api/meta/deauthorize`
   - **URL de solicitação de exclusão de dados:** `https://SEU_DOMINIO/api/meta/data-deletion`
5. Em **"Configurar webhooks"** (o servidor precisa estar no ar com HTTPS neste momento):
   - **URL de callback:** `https://SEU_DOMINIO/api/webhooks/instagram`
   - **Token de verificação:** o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` (invente uma sequência longa)
   - Assine os campos: `messages`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `comments`
   - Ao conectar cada conta, o próprio Veloxia chama `POST /me/subscribed_apps` para ativar os webhooks dela (se falhar, a página Instagram mostra o erro com o botão "Tentar novamente").
6. Em **Configurações do app → Básico**, informe:
   - **Política de privacidade:** `https://SEU_DOMINIO/privacidade`
   - **Termos de serviço:** `https://SEU_DOMINIO/termos`
   - **Exclusão de dados:** `https://SEU_DOMINIO/api/meta/data-deletion` (o usuário acompanha o status em `/exclusao-de-dados`)
   - ícone, categoria e e-mail de contato.
7. **Modo de desenvolvimento:** apenas contas com função no app conseguem conectar. Adicione as contas em **Funções do app → Testadores do Instagram** e aceite o convite no Instagram (Configurações → *Apps e sites* → convites de testador).
8. **Na conta do Instagram:** ela precisa ser **profissional** (Comercial ou Criador de conteúdo) e permitir o acesso às mensagens por ferramentas conectadas — no app do Instagram, em configurações de **Mensagens e respostas → Ferramentas conectadas → "Permitir acesso às mensagens"**. Sem isso a Meta não entrega/aceita mensagens pela API.
9. **Análise do app (para clientes reais):** solicite **acesso avançado** às permissões
   `instagram_business_basic`, `instagram_business_manage_messages` e `instagram_business_manage_comments`,
   com vídeo mostrando o fluxo (conectar → criar automação → mensagem respondida) e conclua a **verificação da empresa**. Depois coloque o app em modo **Ao vivo**.
10. *(Opcional)* **Human Agent:** se o recurso "Agente humano" for aprovado para o seu app, defina `META_HUMAN_AGENT_ENABLED=true` para permitir respostas manuais pela Inbox até 7 dias após a última mensagem do contato.

### WhatsApp (Cloud API + cadastro incorporado)

O WhatsApp usa o **mesmo app "Empresa"** da Meta. O Veloxia atua como **Provedor de Tecnologia** (Tech Provider): cada cliente conecta o próprio número pelo cadastro incorporado, e **a Meta cobra as mensagens direto do cliente** (cartão cadastrado na conta do WhatsApp Business dele). Nada de cobrança de mensagens passa pelo Veloxia.

1. No app, adicione os produtos **WhatsApp** e **Login do Facebook para Empresas** (*Facebook Login for Business*).
2. Em **Configurações → Básico**, copie o **ID do app** e a **chave secreta do app** para `META_APP_ID` e `META_APP_SECRET` (a chave também valida a assinatura dos webhooks do WhatsApp).
3. Em **Login do Facebook para Empresas → Configurações**, crie uma **configuração** do tipo *WhatsApp Embedded Signup* com as permissões `whatsapp_business_management` e `whatsapp_business_messaging`. Copie o **ID da configuração** para `WHATSAPP_CONFIG_ID`.
4. Ainda no Login do Facebook para Empresas, cadastre o domínio do Veloxia em **Domínios permitidos** e **URIs de redirecionamento do OAuth válidos** (HTTPS). O SDK JavaScript da Meta é carregado de `connect.facebook.net` (já liberado na CSP).
5. Em **WhatsApp → Configuração → Webhook**:
   - **URL de callback:** `https://SEU_DOMINIO/api/webhooks/whatsapp`
   - **Token de verificação:** o mesmo `META_WEBHOOK_VERIFY_TOKEN`
   - Assine os campos: `messages`, `message_template_status_update` e, se usar o modo app + API, `smb_message_echoes`.
   - Ao conectar cada número, o Veloxia registra o número (`/{phone-id}/register`) e inscreve o app na conta do WhatsApp Business do cliente (`/{waba-id}/subscribed_apps`).
6. **Para clientes reais:** conclua a **verificação da empresa**, solicite **acesso avançado** às duas permissões acima na Análise do App e faça o cadastro como **Provedor de Tecnologia**. Em desenvolvimento, só pessoas com função no app conseguem concluir o cadastro.
7. **Cada cliente** precisa: acesso de administrador ao Gerenciador de Negócios, um número que receba SMS/ligação e um **cartão cadastrado** na conta do WhatsApp Business (Gerenciador do WhatsApp → Cobrança).

Regras que o Veloxia aplica: respostas livres só até **24 h** após a última mensagem do cliente; depois disso, apenas **modelos aprovados** (bloco "Modelo do WhatsApp", envio de modelo na inbox). Erros de janela (131047), pagamento (131042), limite (130429/131048/131056), modelo (132xxx) e autorização (190) são classificados, mostrados com mensagem amigável e registrados nos logs. A estimativa de custo usa `WHATSAPP_RATES_BRL` (preço por mensagem em R$) e o campo `pricing` que a Meta envia nos status — o valor oficial é sempre o da fatura da Meta.

### Mercado Pago

1. Em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers) → **Suas integrações**, crie uma aplicação (pagamentos online; produtos *Assinaturas* e *Checkout Pro*).
2. Copie o **Access Token de produção** para `MP_ACCESS_TOKEN` (para testar, use as credenciais e usuários de teste).
3. Em **Webhooks**, cadastre `https://SEU_DOMINIO/api/webhooks/mercadopago`, marque os eventos `payment`, `subscription_preapproval` e `subscription_authorized_payment`, e copie a **assinatura secreta** para `MP_WEBHOOK_SECRET`.

Como funciona: o plano **mensal** vira uma assinatura (`/preapproval`) que o cliente autoriza no checkout do Mercado Pago; o **anual** é um pagamento único pelo Checkout Pro (PIX, cartão ou boleto). Toda notificação tem a assinatura `x-signature` validada e, em vez de confiar no corpo, o servidor **consulta o Mercado Pago** para obter o estado real antes de ativar, renovar ou cancelar o plano. O preço de lançamento do Pro vale nos primeiros meses e, ao terminar, o valor da assinatura é atualizado automaticamente.

### Como conferir que está tudo certo

- **Ajuda → Configuração técnica** mostra os itens configurados (Instagram, WhatsApp, Mercado Pago, webhooks, HTTPS, e-mail, IA) e as URLs prontas para copiar.
- Conecte a conta, publique uma automação, mande a palavra-chave de **outra** conta do Instagram e acompanhe em **Automações → Logs** — cada execução mostra as etapas e, se não respondeu, o motivo.
- **Admin** (e-mails em `ADMIN_EMAILS`) lista webhooks recebidos, jobs e erros, com opção de reprocessar.

---

## Deploy em produção

A imagem Docker é única: serve a API, o painel (mesmo domínio, sem CORS) e, por padrão, roda o worker da fila no mesmo processo. As migrações rodam na inicialização (`MIGRATE_ON_START=false` para desativar e rodar `node dist/migrate.js` à parte).

```bash
cd veloxia
docker build -t veloxia .
docker run -p 3333:3333 \
  -e APP_URL=https://app.seudominio.com.br \
  -e DATABASE_URL=postgres://... \
  -e APP_SECRET="$(openssl rand -base64 48)" \
  -e ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  -e INSTAGRAM_APP_ID=... -e INSTAGRAM_APP_SECRET=... -e META_WEBHOOK_VERIFY_TOKEN=... \
  veloxia
```

- **Render:** o arquivo [`render.yaml`](render.yaml) cria o serviço web e o PostgreSQL. Em *New → Blueprint*, escolha o repositório e informe o caminho `veloxia/render.yaml`. O Render gera `APP_SECRET` e `ENCRYPTION_KEY`, e o endereço público vem de `RENDER_EXTERNAL_URL` (defina `APP_URL` só ao usar domínio próprio). `ENCRYPTION_KEY` aceita 32 bytes em base64 ou qualquer segredo aleatório com 32+ caracteres. Use um plano pago: instâncias gratuitas hibernam, atrasando webhooks e pausando os blocos "Aguardar". Para só testar sem cartão, use [`render-free.yaml`](render-free.yaml) (serviço grátis do Render + PostgreSQL grátis do [Neon](https://neon.com), com "Connection pooling" desativado).
- **Railway, Fly.io, VPS, Kubernetes:** qualquer host de containers + PostgreSQL gerenciado. Requisitos: HTTPS público (a Meta exige), `TRUST_PROXY=true` atrás de proxy, `DATABASE_SSL=true` se o banco exigir SSL.
- **Worker separado:** para escalar, rode a API com `RUN_WORKER=false` e um ou mais workers com `node dist/worker.js` (mesma imagem e mesmas variáveis).
- **Health check:** `GET /health`.
- **Backups:** faça backup do PostgreSQL e guarde a `ENCRYPTION_KEY` em local seguro — sem ela os tokens salvos não podem ser lidos (basta reconectar as contas).
- **Domínio:** depois de trocar o domínio, atualize `APP_URL`, todas as URLs no painel da Meta (incluindo os domínios do Login do Facebook para Empresas) e a URL de webhook do Mercado Pago.

---

## Variáveis de ambiente

Todas estão documentadas em [`.env.example`](.env.example). As essenciais:

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `APP_URL` | sim | URL pública com `https://` em produção |
| `DATABASE_URL` | sim | PostgreSQL 14+ |
| `APP_SECRET` | produção | ≥ 32 caracteres (assinaturas internas) |
| `ENCRYPTION_KEY` | produção | 32 bytes em base64 (`openssl rand -base64 32`) |
| `INSTAGRAM_APP_ID` / `INSTAGRAM_APP_SECRET` | para conectar o Instagram | Do produto Instagram no app da Meta |
| `META_WEBHOOK_VERIFY_TOKEN` | para webhooks | Token inventado por você (Instagram e WhatsApp) |
| `META_APP_ID` / `META_APP_SECRET` / `WHATSAPP_CONFIG_ID` | para conectar o WhatsApp | App da Meta e configuração do cadastro incorporado |
| `WHATSAPP_RATES_BRL` | opcional | Preços por mensagem (R$) usados só na estimativa de consumo |
| `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET` | para cobrar planos | Mercado Pago |
| `SMTP_*` | recomendado | Recuperação de senha por e-mail |
| `ANTHROPIC_API_KEY` | opcional | Habilita os recursos de IA (`AI_MODEL`, padrão `claude-opus-5-5`) |
| `ADMIN_EMAILS` / `SUPPORT_EMAIL` | opcional | Administradores e contato de suporte |

O servidor valida as variáveis ao iniciar e, em produção, recusa subir sem `APP_SECRET`, `ENCRYPTION_KEY` válida e `APP_URL` com HTTPS.

---

## Planos, limites e pagamentos

Planos padrão (inseridos só se não existirem; ajustes feitos no banco são preservados):

| Plano | Mensal | Anual | Canais | Contatos ativos/mês | Destaques |
| --- | --- | --- | --- | --- | --- |
| Gratuito | R$ 0 | — | 1 (Instagram **ou** WhatsApp) | 100 | 2 automações, fluxos de até 10 blocos |
| Starter | R$ 39,90 | R$ 399 | 1 (Instagram **ou** WhatsApp) | 1.000 | Automações ilimitadas, construtor completo |
| Pro | R$ 79,90 (R$ 49,90 nos 3 primeiros meses) | R$ 799 | Instagram **e** WhatsApp | 2.000 | Mesma automação nos dois canais, Instagram → WhatsApp, sequências, IA (100/mês), analytics completo |
| Business | R$ 149,90 | R$ 1.499 | Até 3 Instagram + 3 números de WhatsApp | 10.000 | Tudo do Pro, IA 500/mês |

- **Contato ativo** = pessoa que mandou mensagem no mês (qualquer canal). Quem passa do limite deixa de receber respostas automáticas até o mês virar ou o plano mudar (o motivo aparece nos logs).
- **Mensagens do WhatsApp não estão no plano:** a Meta cobra direto do cliente (respostas em até 24 h ao cliente não são cobradas; modelos de marketing/utilidade são cobrados por mensagem). O painel mostra uma estimativa em Canais → WhatsApp.
- Os planos ficam na tabela **`plans`** (`limits`, `features`, `perks`, preços mensal/anual/promocional em centavos; `null` = ilimitado). Alterar limites ou preços **não exige mudar código**.
- Pagamento: Configurações → Plano → checkout do Mercado Pago. Cancelamento no mesmo lugar (cancela as próximas cobranças; o plano vale até o fim do período pago). Se o pagamento falhar, a assinatura fica "pagamento pendente" e o plano é mantido até 3 dias após o vencimento.
- Trocar o plano manualmente: painel **Admin → Espaços de trabalho**, ou `npm run plan:set --workspace server -- email@cliente.com pro [--trial=14]` (no container: `node dist/set-plan.js email@cliente.com pro`).

---

## Limitações da API oficial

O painel explica cada uma delas no lugar certo; nenhuma é contornada.

| Limitação | Como o Veloxia trata |
| --- | --- |
| **Novo seguidor:** não existe webhook para isso | Gatilho exibido como indisponível, com o motivo |
| **Janela de 24 h:** mensagens livres só até 24 h após a última mensagem do contato | Instagram: envios fora da janela não são feitos (logs), esperas limitadas a 23 h, Human Agent só com aprovação da Meta. WhatsApp: fora da janela só modelos aprovados — o construtor exige um bloco "Modelo do WhatsApp" depois de esperas longas |
| **WhatsApp: modelos passam por análise da Meta** | Status sincronizado por webhook; só modelos aprovados aparecem para uso |
| **WhatsApp: qualidade e limite diário do número** | Exibidos em Canais → WhatsApp, com alerta quando a qualidade cai |
| **Comentário → Direct:** uma resposta privada por comentário, até 7 dias; as próximas mensagens só depois que a pessoa responder | O construtor valida o fluxo (uma mensagem antes da resposta da pessoa) e sugere botões para continuar a conversa |
| **Menção em Story** não tem texto | Gatilho sem palavra-chave |
| **Perfil do contato** (nome/foto) só para quem interagiu com a conta | Buscado após a primeira mensagem e atualizado periodicamente |
| **Mídia** precisa de URL pública | Uploads ficam disponíveis em `/api/media/...` no seu domínio |
| **Limites de envio e erros da Graph API** | Erros classificados (token, permissão, janela, limite, usuário indisponível…), mensagens amigáveis, reenvio automático em falhas temporárias e pausa da automação + notificação em erros de configuração |
| **Modo de desenvolvimento** | Só testadores conseguem conectar até a Análise do app ser aprovada |

---

## Segurança e privacidade

- Senhas com **scrypt**; bloqueio temporário após tentativas erradas; recuperação de senha com token de uso único e expiração.
- Sessão por cookie **HttpOnly/SameSite=Lax/Secure** com token opaco (apenas o hash fica no banco); listar e encerrar sessões; excluir conta.
- Proteção CSRF por cabeçalho obrigatório, CSP (Helmet), CORS restrito, rate limit por rota.
- Tokens do Instagram e do WhatsApp criptografados com **AES-256-GCM**; nunca retornados pela API nem exibidos.
- Webhooks da Meta validados por **HMAC-SHA256** e do Mercado Pago pela assinatura `x-signature`; callbacks da Meta (`signed_request`) verificados.
- **Isolamento por cliente:** toda consulta é filtrada pelo espaço de trabalho da sessão (coberto por teste).
- Erros internos nunca chegam ao usuário: mensagens amigáveis na interface e detalhes apenas nos logs/painel admin (com dados sensíveis mascarados).
- Exclusão de dados pela Meta e pelo próprio usuário; links rastreados assinados.
- **As páginas de Privacidade e Termos são um ponto de partida e precisam ser revisadas por um advogado (LGPD) antes do lançamento.**

---

## Testes

```bash
npm test   # shared (regras puras) + server (integração contra PostgreSQL real, banco veloxia_test)
```

Os testes do servidor simulam apenas a **fronteira HTTP da Meta** (respostas da Graph API e webhooks assinados) e exercitam o sistema real: banco, fila, motor, rotas e criptografia.

Testes ponta a ponta (navegador real) com o app rodando:

```bash
npm run build && npm start            # em outro terminal
npx playwright install chromium       # uma vez
npm run e2e --workspace web           # E2E_BASE_URL=http://localhost:3333 por padrão
```

O CI (`.github/workflows/veloxia-ci.yml`) roda typecheck, testes, build, e2e e o build da imagem Docker a cada push que altera `veloxia/`.

---

## Critérios de aceitação

| # | Critério | Onde está / como é verificado |
| --- | --- | --- |
| 1 | Criar uma conta | `/cadastro` · `auth.test.ts`, e2e |
| 2 | Fazer login | `/login` · `auth.test.ts`, e2e |
| 3 | Conectar conta profissional pelo login oficial | Onboarding e página Instagram · `api.test.ts` (OAuth, token criptografado, webhooks, recusa de conta pessoal) |
| 4 | Criar uma automação | Criação rápida, modelos e construtor · `api.test.ts`, e2e |
| 5 | Uma ou várias palavras-chave | Editor de palavras-chave e Palavras-chave · `engine.test.ts`, `keywords.test.ts` |
| 6 | Definir uma resposta | Texto, link com botão, imagem, vídeo, botões · `engine.test.ts` |
| 7 | Publicar | Publicação versionada · `engine.test.ts` |
| 8 | Receber mensagem real | Webhook assinado e idempotente · `engine.test.ts` |
| 9 | Identificar a palavra-chave | Matching com precedência · `engine.test.ts` |
| 10 | Executar a automação | Fila + runner · `engine.test.ts` |
| 11 | Enviar a resposta automaticamente | `POST /me/messages` · `engine.test.ts` |
| 12 | Registrar a execução | Automações → Logs · `engine.test.ts` |
| 13 | Exibir a conversa na Inbox | Conversas · `engine.test.ts`, `api.test.ts` |
| 14 | Exibir o contato | Contatos · `engine.test.ts` |
| 15 | Exibir métricas | Dashboard e Analytics · `api.test.ts` |
| 16 | Pausar | Ativar/pausar nos cards e no detalhe · `engine.test.ts` |
| 17 | Editar | Mantém a versão publicada até republicar · `engine.test.ts` |
| 18 | Excluir | Interrompe fluxos em andamento e preserva os logs · `engine.test.ts` |
| 19 | Reconectar o Instagram | Canais → Instagram → Reconectar · `api.test.ts` |
| 20 | Tratar erros da API | Classificação, retry, pausa e notificação · `engine.test.ts` |
| 21 | Conectar o WhatsApp pelo cadastro incorporado | Canais → WhatsApp · `whatsapp.test.ts` (troca do código, registro, inscrição, limite de canais do plano) |
| 22 | Responder no WhatsApp e respeitar a janela/modelos | `whatsapp.test.ts` (texto, botões, listas, modelo fora da janela, erros classificados, status e cobrança) |
| 23 | Assinar, renovar e cancelar pelo Mercado Pago | Configurações → Plano · `billing.test.ts` (assinatura validada, consulta à API, promoção, cancelamento) |

Os critérios 3, 8 e 11 dependem de um app da Meta configurado: os testes cobrem o comportamento contra respostas da Graph API, e a validação final é feita com uma conta real seguindo o [passo a passo](#configurando-o-app-da-meta-passo-a-passo).

---

## Personalização e próximos passos

- **Nome e marca:** `APP_NAME` e `APP_TAGLINE` em `shared/src/constants.ts`; cores e fontes em `web/src/styles.css` (`@theme`); logotipo em `web/src/components/brand/Logo.tsx`.
- **Textos legais:** `web/src/pages/public/Legal.tsx`.
- **Novos canais** (ex.: Messenger): adicione o canal em `shared/src/channels.ts` (rótulo, janela de mensagens, recursos), crie o cliente em `server/src/integrations/`, o `ChannelDriver` em `server/src/channels/` (registre em `registry.ts`) e o tradutor de webhook que chama o pipeline comum (`engine/inbound.ts`). Motor, construtor, inbox, CRM e métricas não mudam; o painel ganha a aba em Canais.
- **Repositório próprio:** este app é independente do restante do repositório. Para separá-lo mantendo o histórico:
  ```bash
  git subtree split --prefix veloxia -b veloxia-only
  git push git@github.com:SUA_ORG/veloxia.git veloxia-only:main
  ```
  Depois mova o workflow de CI para `.github/workflows/` do novo repositório (removendo `working-directory` e os filtros de `paths`) e ajuste os caminhos `./veloxia/...` do `render.yaml`.

### Referências oficiais

- API do Instagram com login do Instagram — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
- Login comercial do Instagram (OAuth) — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- Mensagens (Instagram Messaging) — https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
- Respostas privadas a comentários — https://developers.facebook.com/docs/instagram-platform/private-replies
- Webhooks — https://developers.facebook.com/docs/instagram-platform/webhooks
- Análise do app — https://developers.facebook.com/docs/app-review
- WhatsApp Cloud API — https://developers.facebook.com/docs/whatsapp/cloud-api
- Cadastro incorporado (Embedded Signup) — https://developers.facebook.com/docs/whatsapp/embedded-signup
- Modelos de mensagem — https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- Preços do WhatsApp — https://developers.facebook.com/docs/whatsapp/pricing
- Mercado Pago: Assinaturas — https://www.mercadopago.com.br/developers/pt/docs/subscriptions/landing
- Mercado Pago: Checkout Pro — https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing
- Mercado Pago: Webhooks — https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
