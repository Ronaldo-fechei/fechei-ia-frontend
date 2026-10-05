# Gatilho

Automação de Direct, comentários e Stories do Instagram **usando somente a API oficial da Meta**.

O usuário cria uma conta, conecta uma conta profissional do Instagram pelo login oficial, cadastra palavras-chave e respostas (ou monta um fluxo visual), publica — e cada mensagem real recebida é respondida automaticamente, com histórico, inbox, contatos e métricas.

> Sem scraping, sem automação de navegador, sem senha do Instagram. Quando a API oficial não oferece um recurso (ex.: evento de novo seguidor), o painel informa isso em vez de simular.

---

## Sumário

1. [Recursos](#recursos)
2. [Arquitetura](#arquitetura)
3. [Rodando localmente](#rodando-localmente)
4. [Configurando o app da Meta (passo a passo)](#configurando-o-app-da-meta-passo-a-passo)
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
| **Conexão oficial** | OAuth da *API do Instagram com login do Instagram*, token de longa duração (renovado automaticamente), inscrição de webhooks, reconectar/desconectar. O token é criptografado (AES-256-GCM) e nunca aparece na interface. |
| **Automações** | Criação rápida (palavra-chave → resposta com link/imagem/atraso) ou **construtor visual** com gatilho, palavra-chave, mensagem, imagem, vídeo, link, botões, condição, aguardar, adicionar/remover tag, capturar informação, atendimento humano e finalizar. Arrastar, conectar, zoom, salvamento automático, desfazer/refazer, validação, simulador e publicação versionada. |
| **Gatilhos** | Mensagem no Direct, comentário em publicação/reel (Comentário → Direct com resposta privada e resposta pública opcional), resposta a Story, menção em Story. "Novo seguidor" aparece como **indisponível** (a API não envia esse evento). |
| **Palavras-chave** | Contém a palavra, contém a frase, exata, começa com, termina com. Sem diferenciar maiúsculas, com opção de ignorar acentos. A mais específica vence; prioridade manual e detecção de conflitos. |
| **Proteções** | Idempotência de webhooks, uma execução ativa por contato/automação, intervalo anti-repetição (cooldown), janela de 24 h, limite por plano, opt-out, pausa em atendimento humano. |
| **Inbox** | Conversas em tempo real (SSE), "Assumir conversa" (pausa as automações para o contato) e "Retomar automação", envio manual dentro da janela permitida. |
| **CRM** | Contatos com foto/nome (User Profile API), tags, campos personalizados, captura de e-mail/telefone/texto, histórico e exportação CSV. |
| **Métricas** | Dashboard e analytics com filtros (hoje, 7, 30, 90 dias, período): mensagens, contatos, cliques em links rastreados, palavras mais pedidas, horários de pico, desempenho por automação. |
| **Modelos** | Envio de link, FAQ, produto, promoção, captura de lead, atendimento, comentário→DM, story→DM, menção em story — "Usar este modelo". |
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
│   ├── src/integrations  Cliente da Graph API, OAuth e adaptador de canal do Instagram
│   ├── src/engine        Processador de webhooks, matching, runner de fluxos, executor e simulador
│   ├── src/queue         Fila durável no Postgres (SKIP LOCKED + LISTEN/NOTIFY), worker e agendador
│   ├── src/modules       Rotas por domínio (auth, instagram, automations, inbox, crm, analytics…)
│   └── test              Testes de integração contra um PostgreSQL real
└── web/      Painel (React 19 + Vite + Tailwind v4 + React Query + React Flow)
```

### Caminho de uma mensagem

```
Instagram ──POST──▶ /api/webhooks/instagram
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
           • cria execução ─▶ runFlow (interpretador puro) ─▶ InstagramChannel ─▶ Graph API /me/messages
           • esperas (aguardar, botões, captura) viram jobs agendados; logs, métricas e eventos em tempo real
```

O motor não conhece o Instagram diretamente: ele fala com uma interface `ChannelAdapter`. O simulador usa o **mesmo interpretador** com um runtime em memória — por isso o "Testar" mostra exatamente o que seria enviado, sem enviar nada.

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

Abra http://localhost:5173, crie uma conta e explore. Sem as credenciais da Meta o painel funciona normalmente — automações, construtor, simulador, contatos — e mostra em **Ajuda → Configuração técnica** exatamente o que falta para conectar o Instagram.

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

O Gatilho usa a **API do Instagram com login do Instagram** (Instagram API with Instagram Login), que não exige Página do Facebook. A versão da Graph API fica em `META_GRAPH_API_VERSION` (padrão `v25.0`).

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
   - Ao conectar cada conta, o próprio Gatilho chama `POST /me/subscribed_apps` para ativar os webhooks dela (se falhar, a página Instagram mostra o erro com o botão "Tentar novamente").
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

### Como conferir que está tudo certo

- **Ajuda → Configuração técnica** mostra os itens configurados (credenciais, webhook, HTTPS, e-mail, IA).
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

- **Render:** o arquivo [`render.yaml`](render.yaml) cria o serviço web e o PostgreSQL. Em *New → Blueprint*, escolha o repositório e informe o caminho `veloxia/render.yaml`. Use um plano pago: instâncias gratuitas hibernam, atrasando webhooks e pausando os blocos "Aguardar".
- **Railway, Fly.io, VPS, Kubernetes:** qualquer host de containers + PostgreSQL gerenciado. Requisitos: HTTPS público (a Meta exige), `TRUST_PROXY=true` atrás de proxy, `DATABASE_SSL=true` se o banco exigir SSL.
- **Worker separado:** para escalar, rode a API com `RUN_WORKER=false` e um ou mais workers com `node dist/worker.js` (mesma imagem e mesmas variáveis).
- **Health check:** `GET /health`.
- **Backups:** faça backup do PostgreSQL e guarde a `ENCRYPTION_KEY` em local seguro — sem ela os tokens salvos não podem ser lidos (basta reconectar as contas).
- **Domínio:** depois de trocar o domínio, atualize `APP_URL` e todas as URLs no painel da Meta.

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
| `META_WEBHOOK_VERIFY_TOKEN` | para webhooks | Token inventado por você |
| `SMTP_*` | recomendado | Recuperação de senha por e-mail |
| `ANTHROPIC_API_KEY` | opcional | Habilita os recursos de IA (`AI_MODEL`, padrão `claude-opus-5-5`) |
| `ADMIN_EMAILS` / `SUPPORT_EMAIL` | opcional | Administradores e contato de suporte |

O servidor valida as variáveis ao iniciar e, em produção, recusa subir sem `APP_SECRET`, `ENCRYPTION_KEY` válida e `APP_URL` com HTTPS.

---

## Planos, limites e pagamentos

- Os planos ficam na tabela **`plans`** (`limits` e `features` em JSON; `null` = ilimitado). Alterar limites, preços ou criar planos **não exige mudar código**. Os planos padrão (Gratuito, Pro, Business) são inseridos só se não existirem — ajustes feitos no banco são preservados.
- Limites aplicados: contas do Instagram, automações ativas, contatos, mensagens por mês e gerações de IA por mês; recursos: construtor de fluxos, analytics avançado, IA, automações de comentário.
- Trocar o plano de um cliente: painel **Admin → Espaços de trabalho**, ou `npm run plan:set --workspace server -- email@cliente.com pro [--trial=14]` (no container: `node dist/set-plan.js email@cliente.com pro`).
- **Pagamentos não estão implementados — de propósito, nada de cobrança fictícia.** A tela de planos mostra os preços e direciona para o `SUPPORT_EMAIL`. A estrutura já está pronta: `subscriptions` tem `provider`, `provider_customer_id`, `provider_subscription_id`, status (`trialing`, `active`, `past_due`, `canceled`) e período. Para integrar um gateway (Mercado Pago, Stripe…), crie o checkout e um webhook do gateway que atualize `subscriptions` — o restante do sistema já respeita o plano ativo.

---

## Limitações da API oficial

O painel explica cada uma delas no lugar certo; nenhuma é contornada.

| Limitação | Como o Gatilho trata |
| --- | --- |
| **Novo seguidor:** não existe webhook para isso | Gatilho exibido como indisponível, com o motivo |
| **Janela de 24 h:** só é possível enviar até 24 h após a última mensagem do contato | Envios fora da janela não são feitos e aparecem nos logs; esperas limitadas a 23 h; Human Agent (7 dias) só com aprovação da Meta |
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
- Tokens do Instagram criptografados com **AES-256-GCM**; nunca retornados pela API nem exibidos.
- Webhooks validados por **HMAC-SHA256**; callbacks da Meta (`signed_request`) verificados.
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
| 19 | Reconectar o Instagram | Página Instagram → Reconectar · `api.test.ts` |
| 20 | Tratar erros da API | Classificação, retry, pausa e notificação · `engine.test.ts` |

Os critérios 3, 8 e 11 dependem de um app da Meta configurado: os testes cobrem o comportamento contra respostas da Graph API, e a validação final é feita com uma conta real seguindo o [passo a passo](#configurando-o-app-da-meta-passo-a-passo).

---

## Personalização e próximos passos

- **Nome e marca:** `APP_NAME` e `APP_TAGLINE` em `shared/src/constants.ts`; cores e fontes em `web/src/styles.css` (`@theme`); logotipo em `web/src/components/brand/Logo.tsx`.
- **Textos legais:** `web/src/pages/public/Legal.tsx`.
- **Novos canais** (ex.: Messenger, WhatsApp): implemente um `ChannelAdapter` em `server/src/integrations/` — o motor e o construtor não mudam.
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
