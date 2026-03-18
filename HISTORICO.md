# HISTORICO.md — PayJarvis

## 2026-03-18 — Fix: Context reutilizado + Verificação completa

### Diagnóstico BrowserBase Contexts
- **Contexts JÁ estavam implementados** — `bb-context.service.ts` cria Contexts, `bb-checkout.ts` vincula Sessions
- Stagehand suporta nativamente via `browserbaseSessionCreateParams.browserSettings.context.id`
- Context `cc08d476-...` existia no BrowserBase (verificado via API)
- Banco: 3 `store_contexts`, 1 com `bbContextId` preenchido

### Bug corrigido
- `start-live-login` criava **Context NOVO a cada login** em vez de reutilizar o existente do banco
- Fix: verifica `store_contexts.bbContextId` primeiro → só cria se não existir
- Removidos dynamic imports duplicados de prisma → import estático no topo

### Fluxo correto agora
1. Primeiro login: cria Context → Session → usuário loga → cookies persistem no Context
2. Próximas compras: mesmo Context → nova Session → **já logado** → direto pro checkout
3. Contexts duram indefinidamente no BrowserBase (sem TTL)

---

## 2026-03-18 — Live Login iFrame (BrowserBase) + Logs + PendingProduct + TTL 60min

### O que foi feito (Parte 7 — Live Login iFrame)

#### Página /connect/amazon reescrita
- **Formulário email/senha removido como fluxo principal**
- Agora abre sessão BrowserBase → navega para Amazon signin → mostra iFrame com Live View
- Usuário digita credenciais **diretamente na Amazon real** dentro do iFrame
- PayJarvis **NUNCA recebe as credenciais** — só o BrowserBase tem acesso
- Polling a cada 8s verifica se login completou (abre sessão verify com mesmo context)

#### Novos endpoints API
| Endpoint | Método | Função |
|---|---|---|
| `/api/vault/amazon/start-live-login` | POST | Cria contexto BB + sessão login + retorna liveUrl |
| `/api/vault/amazon/check-live-login/:bbContextId` | GET | Verifica se login completou via sessão verify |

#### Fluxo completo
1. Token verificado → auto-inicia sessão BrowserBase
2. Stagehand navega para Amazon signin, verifica se já logado
3. Se já logado → marca authenticated imediatamente
4. Se não → mostra iFrame com Live View (página real da Amazon)
5. Polling verifica login a cada 8s (primeira check após 15s)
6. Login detectado → "Amazon Connected!" com nome da conta
7. StoreContext salvo com bbContextId + status=authenticated

#### Fallbacks (Safari mobile / iFrame bloqueado)
- Botão "Open in new tab" → `window.open(liveUrl)`
- Botão "Use form instead" → formulário legacy email/senha
- Timeout 10s se iFrame não carrega → mostra ambas opções
- Formulário legacy mantido como fallback completo (NEEDS_HUMAN, 2FA, etc)

### Arquivos alterados
| Arquivo | Ação |
|---|---|
| apps/api/src/routes/vault.ts | +2 endpoints (start-live-login, check-live-login) |
| apps/web/src/app/connect/amazon/page.tsx | Reescrito — iFrame + fallbacks |

---

## 2026-03-18 — Logs detalhados + PendingProduct + TTL 60min + Auto-checkout após login

### O que foi feito

#### PARTE 1: Logs detalhados em todo o fluxo
- 38+ console.log com prefixos `[AMAZON-CHECKOUT]`, `[BB-CHECKOUT]`, `[CONNECT-AMAZON]`
- checkout.service.ts: logs em checkSession, startCheckout, confirmOrder (cada etapa)
- bb-checkout.ts: logs em create-context, open-session, action, close-session
- vault.ts: logs em verify-token, login, login-status
- checkout.ts (routes): logs "Tool called" em cada endpoint
- page.tsx (browser): console.log para debug no DevTools

#### PARTE 2: Token TTL 60 minutos
- checkout.service.ts: `15 * 60 * 1000` → `60 * 60 * 1000`
- vault.ts: `15 * 60 * 1000` → `60 * 60 * 1000`

#### PARTE 3: PendingProduct — produto salvo antes do login
- Schema Prisma: `pendingProduct Json?` no model StoreContext
- Migration: `20260318_add_pending_product`
- checkout.service.ts: salva `{asin, name, price, url}` quando NEEDS_AUTH
- Novo endpoint: `GET /api/amazon/checkout/pending-product?userId=` — retorna e limpa

#### PARTE 4: Auto-checkout após login ("conectado/pronto/done")
- jarvis-whatsapp.service.ts: intercepta "conectado/pronto/done/já fiz login" antes do Gemini
  - Verifica pendingProduct → auto-inicia checkout → retorna resumo ao usuário
- openclaw/index.js: mesma interceptação no Telegram
  - Chama `/api/amazon/checkout/pending-product` → auto-inicia checkout

#### PARTE 5: Gemini tools amazon_* no WhatsApp
- Adicionadas 3 tools: amazon_check_session, amazon_start_checkout, amazon_confirm_order
- handleTool: 3 novos cases chamando a API de checkout
- Já existiam no OpenClaw (Telegram) — adicionados logs `[AMAZON-CHECKOUT]`

### Arquivos alterados
| Arquivo | Ação |
|---|---|
| apps/api/src/services/amazon/checkout.service.ts | Logs + TTL 60min + pendingProduct save/recover |
| apps/api/src/routes/checkout.ts | Logs + novo endpoint pending-product |
| apps/api/src/routes/vault.ts | Logs + TTL 60min |
| apps/api/src/services/jarvis-whatsapp.service.ts | 3 Gemini tools + handlers + interceptação login |
| apps/browser-agent/src/routes/bb-checkout.ts | Logs [BB-CHECKOUT] detalhados |
| apps/web/src/app/connect/amazon/page.tsx | console.log browser |
| packages/database/prisma/schema.prisma | pendingProduct Json? |
| openclaw/index.js | Interceptação login + logs |

### Teste
- Build OK: API, browser-agent, web
- PM2 restart: payjarvis-api, browser-agent, payjarvis-web, openclaw — todos online
- Migration aplicada no banco

### Integracoes ativas
- BrowserBase: Stagehand v3.1.0, contexts persistentes
- Gemini 2.5 Flash: tools amazon_check_session, amazon_start_checkout, amazon_confirm_order
- Telegram (OpenClaw): interceptação de "conectado/pronto"
- WhatsApp (Jarvis): interceptação de "conectado/pronto"

---

## 2026-03-18 — Amazon Checkout Reescrito: BrowserBase Context + Playwright

### O que foi feito
1. **checkout.service.ts** reescrito — vault cookie injection → BrowserBase Context (cookies persistentes)
2. **bb-checkout.ts** (browser-agent) — 4 endpoints Playwright: create-context, open-session, action, close-session
3. **checkout.ts** (routes) — novo endpoint check-session
4. **resolveUserId()** — mapeia telegramId → Prisma userId automaticamente
5. **Gemini tools** re-adicionadas no OpenClaw: amazon_check_session, amazon_start_checkout, amazon_confirm_order

### Arquivos
| Arquivo | Ação |
|---|---|
| apps/api/src/services/amazon/checkout.service.ts | Reescrito |
| apps/api/src/routes/checkout.ts | Modificado |
| apps/browser-agent/src/routes/bb-checkout.ts | **Novo** |
| apps/browser-agent/src/server.ts | Modificado |

### Teste
- POST /api/amazon/checkout/check-session → 200 OK, authUrl retornado
- BrowserBase Context criado: cc08d476-e9d9-4378-85af-c1079e72ebd5
- Playwright CDP connected em 2087ms, navigation em 318ms

---

## 2026-03-17 — Referral Banner + Template Proativo WhatsApp

### Banner de convite
- Criado `apps/api/public/images/referral-banner.png` (1200x628, 78KB)
- Gradiente azul/roxo, robô Jarvis, "Você foi convidado!", badge "60 dias GRÁTIS"
- Nginx: `/images/` → servido diretamente do filesystem
- URL: https://www.payjarvis.com/images/referral-banner.png

### Template proativo WhatsApp
Novo fluxo de indicação: envio direto de template Twilio pro WhatsApp do amigo.

**Fluxo no Telegram (openclaw/index.js):**
1. Usuário diz "quero indicar" → "Telegram ou WhatsApp?"
2. Se WhatsApp → "Sabe o número do amigo? 1=Sim, 2=Não (gera link)"
3. Se Sim → pergunta número → pergunta nome → chama API
4. Se Não → fallback: QR Code/link (fluxo antigo)

**Novos steps no `_sharePending`:** `wa_choice`, `friend_phone`, `friend_name`

**API (routes/referrals.ts):**
- `POST /api/referrals/send-invite` — recebe referrerName, friendPhone, friendName
- Valida: número não tem conta, não tem pending_referral
- Cria `pending_referrals` (PostgreSQL) — phone, share_code, referrer_name, 7d TTL
- Envia template Twilio HX07d65064afbb7d96223a0a406b2769c2

**Webhook WhatsApp (jarvis-whatsapp.service.ts):**
- Novo: quando número desconhecido manda qualquer mensagem
- Verifica `pending_referrals` por phone
- Se existe: marca `used=true`, inicia `startOnboarding()` com share_code
- Se não: "Peça um convite a um amigo ou acesse payjarvis.com"

### Tabela pending_referrals (PostgreSQL)
- phone, share_code, referrer_name, referrer_user_id, invitee_name
- expires_at: now + 7 dias
- Index em phone WHERE used = false

### Teste real
- `POST /api/referrals/send-invite` → Twilio template enviado (SID: MMc9401b...)
- `pending_referrals` criado corretamente
- Validações funcionando: "já tem conta", "já tem convite pendente"

### Arquivos alterados
- `openclaw/index.js` — 3 novos steps (wa_choice, friend_phone, friend_name), handleDirectWhatsAppInvite
- `apps/api/src/routes/referrals.ts` — NOVO, endpoint send-invite
- `apps/api/src/server.ts` — import + register referralRoutes
- `apps/api/src/services/jarvis-whatsapp.service.ts` — pending_referrals check no handler de unknown user
- `apps/api/public/images/referral-banner.png` — NOVO, banner de convite
- `/etc/nginx/sites-enabled/payjarvis` — location /images/

---

## 2026-03-17 — Fix Share Platform Switch + WhatsApp Onboarding UX

### Problema 1: Troca de plataforma não executava ação
- Usuário dizia "ele precisa do whatsapp eu me enganei" no Telegram
- Bot respondia "Compreendido. Estou gerando o link para o WhatsApp" (Gemini)
- Mas NÃO enviava QR Code nem link
- Causa: `isPlatformSwitch()` não reconhecia "precisa", "enganei", "mas", "na verdade"
- Fallback em `tryHandleShareContext()` exigia "mand/envi/gera" — insuficiente

### Fix Problema 1 (openclaw/index.js)
- `isPlatformSwitch()` expandido: +8 palavras contextuais (precisa, quer, prefere, errei, enganei, na verdade, mas, melhor)
- Fallback no `tryHandleShareContext()`: qualquer menção de plataforma dentro da janela de 5min agora é suficiente
- Testado: "ele precisa do whatsapp eu me enganei" → `[SHARE] Platform switch: telegram → whatsapp`

### Problema 2: Experiência confusa do indicado no WhatsApp
- Link `wa.me/17547145921?text=start+LKA9DB3Q` mostrava texto técnico "start LKA9DB3Q"
- Usuário não sabia o que fazer com tela vazia
- Novo usuário sem conta recebia resposta do Gemini (genérica)

### Fix Problema 2

#### Link mais amigável
- Texto pré-preenchido: `start LKA9DB3Q` → `Quero começar LKA9DB3Q`
- Atualizado em 3 locais: openclaw/index.js, jarvis-whatsapp.service.ts, bot-share.ts
- Backend aceita ambos: `START CODE` e `Quero começar CODE` (regex `/^(?:START|Quero\s+come[cç]ar)\s+(\S+)$/i`)

#### Greeting melhorado (onboarding-bot.service.ts)
- Com referrer: "Olá! 👋 Bem-vindo ao Jarvis! Seu amigo {nome} te convidou... 🎁 Você ganhou 60 dias GRÁTIS!"
- Sem referrer: "Olá! 👋 Bem-vindo ao Jarvis! Sou seu assistente pessoal disponível 24/7..."

#### Handler de usuário desconhecido (jarvis-whatsapp.service.ts)
- Novo: se !resolvedUserId e !hasOnboarding → mensagem amigável
- "Parece que você ainda não tem uma conta. Peça um convite a um amigo ou acesse payjarvis.com"
- Evita que Gemini responda genericamente para quem não tem conta

### Arquivos alterados
- `openclaw/index.js` — isPlatformSwitch expandido, fallback contextual simplificado
- `jarvis-whatsapp.service.ts` — regex START expandido, link "Quero começar", handler unknown user
- `onboarding-bot.service.ts` — greeting melhorado com menção de 60 dias grátis
- `bot-share.ts` — link "Quero começar"

### Estado atual
- OpenClaw: ONLINE, 0 erros
- PayJarvis API: ONLINE, 0 erros, health 200

---

## 2026-03-17 — Migração Email: Resend → Zoho SMTP

### O que foi feito
- `email.ts` reescrito: Resend SDK → Nodemailer com Zoho SMTP
- Retry com 3 tentativas e backoff (1s, 2s)
- Reset de transporter em erros de autenticação
- `.env` e `.env.production`: RESEND_API_KEY comentada, SMTP_* configuradas
- Interface pública inalterada: `sendEmail()`, `sendOnboardingConfirmation()`, todos os templates

### Credenciais Zoho
- SMTP: smtp.zoho.com:465 (SSL)
- User: admin@payjarvis.com
- From: PayJarvis <admin@payjarvis.com>

### Teste real
- Email enviado com sucesso via SMTP Zoho: `250 Message received`
- MessageId: `2383ac56-5c2a-2afd-a67f-35c043824c6c@payjarvis.com`
- API health: 200 OK, webhook WhatsApp: 200 OK

### Consumidores do email service (sem alteração necessária)
- `onboarding-bot.service.ts` — código 6 dígitos de confirmação
- `notifications.ts` — alertas do sistema
- `routes/notifications.ts` — API de notificações

### Estado atual
- API: ONLINE, porta 3001, 0 erros pós-restart
- Email: Zoho SMTP ativo, Resend desabilitada
- Todos os templates mantidos (approval, confirmed, blocked, daily summary, handoff, onboarding)

---

## 2026-03-17 — Migração WhatsApp Sandbox → Produção (OpenClaw)

### Problema
ClawdBot/OpenClaw gerava links de indicação WhatsApp apontando para o sandbox Twilio (+14155238886). Sandbox expira a cada 72h, causando erro "not connected to a Sandbox" para novos usuários.

### O que foi feito
- `openclaw/.env` — adicionado `WHATSAPP_BOT_NUMBER=17547145921` (número de produção)
- `openclaw/index.js:1378` — fallback alterado de `14155238886` para `17547145921`
- Verificado que `jarvis-whatsapp.service.ts` já trata `START <CODE>` na linha 810 (regex `/^START\s+(\S+)$/i`)
- Webhook produção `/webhook/whatsapp` → PayJarvis API (porta 3001) — já configurado no nginx
- OpenClaw reiniciado via PM2 — online, 0 erros

### Fluxo de indicação agora
1. Usuário usa `/indicar` no Telegram → escolhe WhatsApp
2. OpenClaw gera link: `wa.me/17547145921?text=start+<CODE>`
3. Amigo clica → WhatsApp abre com número de produção
4. Twilio recebe → webhook → PayJarvis API → `processWhatsAppMessage` → `startOnboarding`

### Estado atual
- OpenClaw: ONLINE, porta 4000, links WhatsApp apontam para +17547145921
- PayJarvis API: ONLINE, porta 3001, webhook WhatsApp respondendo 200
- Sandbox Twilio (+14155238886): NÃO mais usado por nenhum projeto ativo

### Integração WhatsApp
- Número produção: +17547145921 (Twilio, conta ACbbe2c9...)
- Webhook: https://www.payjarvis.com/webhook/whatsapp → localhost:3001
- Templates: Welcome (HXed40c5...) e Referral (HX07d650...)

---

## 2026-03-17 — Multi-Tenant Isolation Audit + Onboarding Hardening

### O que foi feito

#### Auditoria de Isolamento Multi-Tenant
- **User.phone @unique** — campo era opcional sem constraint, permitia lookup ambiguo via findFirst
- **User.telegramChatId @unique** — duplicata real encontrada no DB (user 1762460701 em 2 registros)
- **session-manager.ts** — chave Redis era `session:bot:${botId}` (sem userId), agora `session:bot:${botId}:user:${userId}`
- **jarvis-whatsapp.service.ts** — findFirst com OR → findUnique no phone (determinístico)
- **onboarding-bot.service.ts** — WhatsApp phone agora salvo em User.phone durante onboarding

#### 4 Riscos Corrigidos
1. **Email brute-force** — max 5 tentativas no email_confirm, após isso regenera código e reenvia email
2. **Fire-and-forget** — initSequence agora tem retry com backoff (1s, 2s, 4s) + log CRITICAL se falhar
3. **Transaction** — completeOnboarding usa prisma.$transaction (session + user + credits atômicos)
4. **Sessão 24h → 72h** — mais tempo para completar onboarding

#### Limpeza de DB
- Removido telegramChatId duplicado do user cmmnz1os7 (teste antigo)
- Deletados 2 registros de crédito órfãos (userId='1762460701', 'test-final')
- Migração SQL: unique indexes + emailAttempts column

### Arquivos alterados
- `apps/api/src/core/session-manager.ts` — sessionKey inclui userId
- `apps/api/src/routes/core.ts` — passa userId nas chamadas de sessão
- `apps/api/src/services/jarvis-whatsapp.service.ts` — findUnique no phone
- `apps/api/src/services/onboarding-bot.service.ts` — brute-force protection, transaction, retry, 72h
- `packages/database/prisma/schema.prisma` — phone @unique, telegramChatId @unique, emailAttempts
- `packages/database/prisma/migrations/20260317_phone_unique_constraint/migration.sql`

### Estado atual
- API: ONLINE, 0 restarts, 0 erros
- Health: https://www.payjarvis.com/api/health → 200 OK
- DB: unique constraints ativos em phone e telegramChatId
- Onboarding: brute-force protection + transaction + retry ativos

### Integracoes ativas
- WhatsApp: +17547145921 (Twilio, webhook /webhook/whatsapp)
- Telegram: @Jarvis12Brain_bot (webhook /webhook/telegram)
- Stripe: ativo (webhook configurado)
- Clerk: proxy /__clerk/ configurado
- Sentinel: monitoramento 24/7 + Telegram alerts
- CFO Agent: relatórios automáticos

---

## 2026-03-17 — Production Hardening: 6 Issues Resolvidos

### O que foi feito

#### Issue 1: CORS origin:true → Restrito
- `server.ts`: CORS agora aceita apenas `https://payjarvis.com`, `https://www.payjarvis.com`, `https://admin.payjarvis.com`
- Origens não permitidas não recebem headers CORS (request prossegue sem Access-Control headers)
- Requests sem origin (curl, mobile, server-to-server) continuam funcionando

#### Issue 2: API Heap usage 96% → 56%
- Adicionado `node_args: "--max-old-space-size=384"` no ecosystem.config.cjs para payjarvis-api
- V8 agora aloca heap maior (78MB vs 47MB), heap usage caiu de 96% para 56%
- Não era leak — V8 estava operando com heap default pequeno e fazendo GC agressivo

#### Issue 3: DB password "payjarvis123" → Senha forte
- Nova senha: `XLd1Vj4SAsx4aIQuZm5RpbwwoDlbzPaxDct5AF2T` (openssl rand -base64 32)
- Atualizado: PostgreSQL (ALTER USER), Payjarvis/.env, .env.production, openclaw/.env, sentinel/.env
- Senha antiga rejeitada — confirmado

#### Issue 4: Fastify logger:true → level:'warn'
- `server.ts`: logger agora é `{ level: "warn" }` em produção, `true` em dev
- Elimina logs INFO/DEBUG de cada request — reduz I/O e tamanho de logs

#### Issue 5: /api/health retornava 404 → 200
- Nginx: adicionado `location = /api/health` com `proxy_pass http://127.0.0.1:3001/health`
- Testado: `curl https://www.payjarvis.com/api/health` → 200 OK

#### Issue 6: payjarvis-kyc 266k+ restarts → 0
- Causa: contador histórico acumulado, não crashes ativos
- Reset: `pm2 reset payjarvis-kyc` → 0 restarts
- Sentinel: corrigido health check de `GET /` (404) para `GET /health` (200)
- KYC agora monitorado corretamente pelo Sentinel

### Arquivos alterados
- `apps/api/src/server.ts` — CORS whitelist + logger level warn
- `ecosystem.config.cjs` — --max-old-space-size=384 para API
- `/etc/nginx/sites-enabled/payjarvis` — location /api/health
- `/root/sentinel/monitors/services.js` — KYC health URL corrigida
- `.env`, `.env.production`, `openclaw/.env`, `sentinel/.env` — nova DB password

### Estado atual
- Todos serviços: ONLINE, 0 restarts
- CORS: restrito a 3 domínios payjarvis.com
- DB: senha forte ativa
- Heap: 56% usage (saudável)
- /api/health: 200 OK via Nginx
- KYC: estável, monitorado corretamente

### Integracoes ativas
- WhatsApp: +17547145921 (Twilio, webhook /webhook/whatsapp)
- Telegram: @Jarvis12Brain_bot (webhook /webhook/telegram)
- Stripe: ativo (webhook configurado)
- Clerk: proxy /__clerk/ configurado
- Sentinel: monitoramento 24/7 + Telegram alerts
- CFO Agent: relatórios automáticos

---

## 2026-03-17 — Visa Click to Pay: Frontend + Backend integração completa

### Sessão 4 — Integração Full-Stack Click to Pay

#### Backend (API)
- **`routes/visa.routes.ts`** criado com 3 endpoints:
  - `GET /api/visa/sdk-config` — retorna config para inicializar SDK (requer auth)
  - `POST /api/visa/checkout` — descriptografa payload JWE do checkout (requer auth)
  - `GET /api/visa/status` — diagnóstico público (certs, credentials, SDK URL)
- Registrado em `server.ts`

#### Frontend (Web)
- **`components/visa-click-to-pay.tsx`** — componente React completo:
  - Carrega SDK Visa dinamicamente via `<script>`
  - Fluxo: init → isRecognized → identityLookup → OTP → getSrcProfile → checkout
  - UI com steps: loading → lookup → OTP → card selection → success
  - Envia payload JWE para backend descriptografar
- **`payment-methods/page.tsx`** atualizado:
  - Card "Visa Click to Pay" adicionado ao grid de providers
  - Botão "Set up Click to Pay" → abre componente inline
  - Dynamic import (SSR disabled)

#### Testes
- `GET /api/visa/sdk-config` → 401 sem auth (correto)
- `GET /api/visa/status` → 200, certLoaded: true, keyLoaded: true, credentialsConfigured: true
- `/payment-methods` → 307 (redirect para login, correto)
- Build API: 0 erros TypeScript
- Build Web: sucesso, `/payment-methods` 5.21 kB
- PM2: payjarvis-api e payjarvis-web reiniciados e online
- Logs: sem erros

#### Arquivos criados/modificados
| Arquivo | Ação |
|---|---|
| `apps/api/src/routes/visa.routes.ts` | Criado |
| `apps/api/src/server.ts` | Modificado (+ import/register visaRoutes) |
| `apps/web/src/components/visa-click-to-pay.tsx` | Criado |
| `apps/web/src/app/(dashboard)/payment-methods/page.tsx` | Modificado (+ Visa card) |

---

## 2026-03-16 — Visa Click to Pay: Arquitetura correta identificada (SDK frontend)

### Sessão 3 — Descoberta: SRC é SDK frontend, não REST API

#### Descoberta crítica
Visa Click to Pay (Secure Remote Commerce) **NÃO é uma REST API backend**.
É um **SDK JavaScript frontend** carregado no browser do usuário.

- Sandbox SDK: `https://sandbox-assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2`
- Production SDK: `https://assets.secure.checkout.visa.com/checkout-widget/resources/js/src-i-adapter/visaSdk.js?v2`

#### Evidência: testes de endpoint
- Todos endpoints `/src/...` retornaram **404** (rota não existe)
- Endpoints como `/vdp/helloworld` e `/visadirect/...` retornaram **401** (existem, sem acesso)
- Conclusão: endpoints SRC não existem no `sandbox.api.visa.com`

#### Arquitetura correta Click to Pay
| Camada | Responsabilidade |
|---|---|
| **Frontend (SDK JS)** | init, isRecognized, identityLookup, checkout, authenticate (9 métodos) |
| **Backend (visa.service.ts)** | Fornece config pro SDK, descriptografa payload JWE pós-checkout |
| **mTLS** | Para outras APIs Visa (VisaDirect, etc.), não para SRC |

#### visa.service.ts atualizado
- `getSdkConfig()` — retorna config para o frontend inicializar o SDK
- `decryptCheckoutPayload(jwe)` — descriptografa resposta do checkout (RSA-OAEP + AES-256-GCM)
- `helloWorld()` — teste de conectividade mTLS
- `testConnection()` — diagnóstico de certificados e credenciais
- Build TypeScript: 0 erros

---

## 2026-03-16 — Visa mTLS: Shared Secrets descriptografados, serviço criado, auth 401

### Sessão 2 — Shared Secrets + visa.service.ts

#### Shared Secrets descriptografados via XPay RSA
- Gerado par RSA 2048 para XPay Token (`visa-xpay-private.key` / `visa-xpay-public.pem`)
- Public key registrada no portal VDP
- **Secret 1** (API Key SJD7...): descriptografado e salvo em `VISA_SHARED_SECRET_1`
- **Secret 2** (API Key N2MUFKY2...): descriptografado e salvo em `VISA_SHARED_SECRET`

#### visa.service.ts criado
- `apps/api/src/services/visa.service.ts` — mTLS via `https.Agent` + Basic Auth
- Métodos: `helloWorld()`, `clickToPay()`, `testConnection()`
- Build TypeScript: 0 erros

#### Testes de autenticação — TODOS 401
Testamos **todas combinações** de credenciais × certificados:
- Old cert+key, new cert+key, P12 keystore
- username:secret1, username:secret2, username:apikey, apikey:secret
- **mTLS handshake sempre OK** (TLS 1.2 aceito)
- **Basic Auth sempre 401** (code 9122 "Authentication failed")

#### Diagnóstico provável
O 401 em todas combinações indica que **o projeto VDP pode não ter Hello World API adicionada**, ou as credenciais no portal precisam ser vinculadas ao certificado enviado. Não é problema de escape de caracteres (testado via Python com base64 direto).

### Estado atual dos certificados
| Arquivo | Status | Detalhes |
|---|---|---|
| `certs/visa-private.key` | OK | RSA 2048, corresponde ao CSR e self-signed cert |
| `certs/visa-key.pem` | Salvo | Chave nova do portal (par diferente, aguardando cert correspondente) |
| `certs/visa-cert.pem` | Placeholder | Cópia do self-signed (substituir com cert oficial da Visa) |
| `certs/visa-csr.pem` | OK | `CN=payjarvis.com, O=Increase Trainer Inc` |
| `certs/visa-self-signed.pem` | OK | Self-signed 365 dias |
| `certs/visa-keystore.p12` | OK | PKCS12 (senha: payjarvis2026) |
| `certs/visa-xpay-private.key` | OK | RSA 2048 para XPay Token |
| `certs/visa-xpay-public.pem` | OK | Public key registrada no portal |

### Pendências
1. **No portal VDP**: verificar se Hello World API está adicionada ao projeto
2. **Vincular certificado**: no portal, Two-Way SSL → upload do CSR ou cert
3. **Obter cert assinado pela Visa**: substituir `visa-cert.pem` quando disponível
4. **CA Bundle**: baixar `SBX-2024-Prod-Root.pem` + `SBX-2024-Prod-Inter.pem` do portal

### Referências
- [Two-Way SSL](https://developer.visa.com/pages/working-with-visa-apis/two-way-ssl)
- [CSR Wizard FAQ](https://developer.visa.com/pages/csr-wizard-faq)
- [Going Live](https://developer.visa.com/pages/going-live)

---

## 2026-03-16 — Share/Referral via WhatsApp com QR Code

### Problema
Usuário pedia "quero compartilhar" no WhatsApp → Gemini respondia "Sim, pode compartilhar" sem gerar link ou QR Code.

### Solução
1. **Intent detection** em `processWhatsAppMessage()` — regex detecta "compartilhar", "indicar", "share", "invite", "QR code", etc.
2. **`generateShareForWhatsApp()`** — nova função que:
   - Busca user no PostgreSQL (se existir, usa bot share link formal)
   - Se não tiver conta formal, gera código anônimo `WA{XXXX}{4digits}`
   - Gera QR Code PNG via `qrcode.toFile()` → salva em `/public/qr/`
   - Envia QR Code como imagem MMS via Twilio (`mediaUrl`)
   - Envia link clicável `wa.me/17547145921?text=START {CODE}`
3. **Tool `share_jarvis`** — adicionada ao Gemini como fallback se intent direto não matchou
4. **Credenciais Twilio API Key** adicionadas ao `.env.production`

### Testes
- "quero compartilhar jarvis com um amigo" → intent detectado → QR Code gerado
- QR Code servido: `GET /public/qr/qr_WA3UQ92431.png` → 200
- MMS com imagem: `MM100646adfb46d09e246f4ed34f7054d8` → **delivered** (media=1)
- Texto com link: `SM71462c7668380f329015e97de1f3317c` → **delivered**
- Link gerado: `wa.me/17547145921?text=START WA3UQ92431`

### Integracoes
- QR Codes salvos em `/root/Payjarvis/public/qr/` (servidos via Fastify static)
- Twilio MediaUrl aponta para `https://www.payjarvis.com/public/qr/qr_{CODE}.png`

---

## 2026-03-16 — Templates OK + Remoção completa do sandbox + START referral

### Templates testados
- **Welcome** (`HXed40c560b2a6a80126988a2657e47004`): delivered para José
- **Referral** (`HX07d65064afbb7d96223a0a406b2769c2`): delivered para José

### Sandbox removido
Todas referências a `+14155238886` e "sandbox" removidas dos fontes:
- `credit.service.ts`, `subscription.service.ts`, `sequence.service.ts` — fallback atualizado para `+17547145921`
- `broadcast.service.ts` — corrigido bug double-prefix (`whatsapp:whatsapp:+...`)
- `bot-share.ts` — link WhatsApp atualizado: `wa.me/17547145921?text=START+{CODE}`
- `server.ts` — comentário "sandbox" → "production"

### START referral (novo)
WhatsApp agora suporta deep-link de referral:
- URL: `https://wa.me/17547145921?text=START CODIGO`
- `processWhatsAppMessage()` intercepta `START XXXXX` → chama `startOnboarding(userId, "whatsapp", code)`
- Inicia onboarding com nome do referrer se código válido

### Testes
- Webhook + Gemini + REST API response → `delivered`
- START TESTCODE → onboarding iniciado, mensagem enviada (erro 63024 = número fictício, esperado)
- `grep -r "14155238886" apps/` → zero resultados

---

## 2026-03-16 — Fix WhatsApp: PM2 env cacheado + mensagens delivered

### Bug
Webhook recebia mensagens (HTTP 200) mas respostas saíam do número errado (`+14155238886` sandbox).
Twilio retornava erro 63016 (freeform outside allowed window) porque o sandbox não tinha sessão 24h.

### Causa raiz
`pm2 restart` NÃO recarrega env do `ecosystem.config.cjs`. O PM2 cacheou `TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886` do deploy anterior.

### Fix
`pm2 delete payjarvis-api && pm2 start ecosystem.config.cjs --only payjarvis-api` — forçou reload do `.env.production` com `whatsapp:+17547145921`.

### Testes realizados
- Webhook recebe msg com X-Twilio-Signature → 200 OK
- Gemini processa → responde via REST API → `SM7be5eb1a37a0c9dc6551a18e823b3312`
- Status callback: `sent` → `delivered` — mensagem entregue no WhatsApp do José
- Zero erros nos logs

### Lição
Sempre usar `pm2 delete + pm2 start ecosystem.config.cjs` ao mudar variáveis de ambiente (não apenas `pm2 restart`).

---

## 2026-03-16 — WhatsApp Production: Twilio REST API (saindo do sandbox)

### O que foi feito
1. **Sender registrado** no Twilio via Senders API v2 (SID: `XE70bc55a9f4ceb7bd010f518782d38219`)
2. **Número**: `whatsapp:+17547145921` (WABA ID: `1447380596882836`) — status ONLINE
3. **Webhook configurado** via API: `callback_url` → `https://www.payjarvis.com/webhook/whatsapp`
4. **Status callback**: `https://www.payjarvis.com/webhook/whatsapp/status`
5. **Twilio SDK instalado** (`npm install twilio` em apps/api)
6. **Novo serviço**: `twilio-whatsapp.service.ts` — sendWhatsAppMessage(), sendWelcomeTemplate(), sendReferralTemplate()
7. **Webhook reescrito**: `whatsapp-webhook.ts` — REST API (não TwiML), validação X-Twilio-Signature, resposta 200 imediata
8. **Nginx**: rota `/webhook/whatsapp/status` adicionada
9. **.env.production** atualizado: número production, template SIDs

### Integracoes ativas
- **Twilio Sender**: `XE70bc55a9f4ceb7bd010f518782d38219` → ONLINE
- **Webhook**: `POST /webhook/whatsapp` → Fastify (porta 3001) → Gemini AI
- **Status Callback**: `POST /webhook/whatsapp/status` → logs delivery status
- **Templates**: welcome (`HXed40c560b2a6a80126988a2657e47004`), referral (`HX07d65064afbb7d96223a0a406b2769c2`)

### Testes realizados
- Health check `GET /webhook/whatsapp` → `{"mode":"production"}` OK
- Mensagem de teste enviada via REST API → SID `SMe0952bddc4de205158a33cb417805987` → queued OK
- Status callback recebido → `sent` → `undelivered` (63016 — destino sem sessão 24h, comportamento esperado)
- Zero erros de startup nos logs

### Observacoes
- Mensagens free-form só funcionam dentro da janela de 24h (usuário precisa enviar primeiro)
- Para mensagens fora da janela: usar templates (welcome/referral) via Content API
- Número antigo sandbox `+14155238886` removido de todas as configs

---

## 2026-03-16 — Fix onboarding: step 'name' antes do email

### Bug
Bot (OpenClaw) perguntava "Qual é o seu nome?" mas API criava sessão com step="email". Quando usuário digitava o nome, API rejeitava como email inválido.

### O que foi feito
1. Schema Prisma: +`fullName String?` em `OnboardingSession`
2. Migration: `20260316100000_add_onboarding_fullname`
3. State machine: `name → email → email_confirm → limits → payment → complete`
4. Nova função `handleNameStep()` — valida nome (2-100 chars), salva `fullName`, avança para email
5. `startOnboarding()` agora cria sessão com `step: "name"` e greeting pergunta nome
6. `createUserAndBot()` usa `session.fullName` como nome do User
7. `notifyReferrer()` usa `fullName` ao invés de email
8. `getStepMessage()` inclui case `"name"` para sessões resumidas

### Testes realizados
- Start → step="name", greeting "Qual é o seu nome?" OK
- Nome "Arilson" → "Prazer, Arilson! Qual é o seu email?" OK
- Nome "Maria" → email "maria@gmail.com" → código enviado OK
- Nome curto "A" → rejeita com "Nome muito curto" OK
- Zero erros nos logs pós-deploy

### Estado atual
- payjarvis-api: ONLINE, onboarding corrigido
- Fluxo: nome → email → código → limites → pagamento → completo

---

## 2026-03-15 — Subscription $20/mês + Sistema Completo de Billing

### O que foi feito

#### Stripe Setup
1. Produto criado: `prod_U9gj6oSC4kKM1E` (Jarvis Executive Assistant)
2. Preço recorrente: `price_1TBNLaPqILx9X6lsIkOO4mOc` ($20/mês)
3. Customer Portal: `bpc_1TBNLaPqILx9X6lsKhG5G9KM` (cancelar, trocar cartão)
4. Customer duplicado do José deletado (manteve cus_U8YITiNRBEFXER)

#### Backend
5. `subscription.service.ts` — create, cancel, portal URL, status, webhook handlers
6. `subscription.ts` (rota) — 4 endpoints: create, status, portal, cancel
7. `stripe-webhook.ts` — +4 handlers: invoice.paid, invoice.payment_failed, subscription.deleted, subscription.updated
8. `credit.service.ts` — premium subscribers = unlimited messages (não desconta créditos)
9. Schema Prisma: +stripeSubscriptionId, +subscriptionStatus, +subscriptionEndsAt, +planType

#### Frontend
10. `/billing` page — status atual, upgrade to Premium, manage subscription, message packs
11. Sidebar: +Billing item no menu principal
12. i18n: +nav.billing em en/pt/es

#### Migração
13. `20260315223000_add_subscription_fields` — via `prisma migrate deploy` (seguro)

### Estado atual
- Stripe: Product + Price + Portal ativos
- payjarvis-api: ONLINE, subscription endpoints funcionais
- payjarvis-web: ONLINE, /billing acessível (307 redirect para auth)
- Tabelas openclaw_*: intactas
- Webhooks: prontos para invoice.paid, payment_failed, subscription.deleted/updated

### Integracoes ativas
- Stripe Subscriptions: $20/mês recurring via `stripe.subscriptions.create()`
- Stripe Customer Portal: self-service (cancelar, trocar cartão)
- Notificações: Telegram/WhatsApp em eventos de subscription
- STRIPE_WEBHOOK_SECRET: precisa configurar no Stripe Dashboard → apontar para https://www.payjarvis.com/api/webhooks/stripe

### Pendente
- Configurar webhook no Stripe Dashboard (events: invoice.paid, invoice.payment_failed, customer.subscription.deleted, customer.subscription.updated, setup_intent.succeeded)
- STRIPE_WEBHOOK_SECRET vazio no .env — precisa do signing secret do webhook configurado
- INTERNAL_SECRET ainda como dev-internal-secret

---

## 2026-03-15 — Credits, Sequence Drip, Prisma Migrate Deploy

### O que foi feito

#### Sistema de Créditos LLM
1. `credit.service.ts` — 5.000 msgs grátis, trial 60 dias por referral, alertas 75%/90%/100%, compra via Stripe
2. `credits.ts` (rota) — 4 endpoints: consume, balance, purchase, packages (público)
3. `trial-cron.ts` — alertas de trial dia 55, 58, 60 (cron diário 9AM)

#### Sequência de Onboarding (Drip)
4. `sequence.service.ts` — 8 etapas ao longo de 60 dias, pausa se inativo >2d, resume automaticamente
5. `sequence.ts` (rota) — 2 endpoints: active, status
6. `sequence-cron.ts` — processa sequências a cada hora + 9AM
7. 8 banners em `public/banners/` (welcome, health, learning, news, documents, finance, travel, intelligence)

#### Integração WhatsApp
8. `jarvis-whatsapp.service.ts` — credit check antes de processar mensagem, markSequenceActive, system prompt reescrito em PT com personalidade executiva

#### Integração OpenClaw (Telegram)
9. `index.js` — credit check em text/photo/voice handlers, markSequenceActive, fail-open se API offline

#### Infra
10. Migração para `prisma migrate deploy` (NÃO mais `db push`) — tabelas raw SQL (openclaw_*) protegidas
11. Nginx: rota `/public/` → Fastify static (banners acessíveis via HTTPS)
12. `onboarding-bot.service.ts` — initCredits + initSequence ao completar onboarding

#### Package.json
13. +node-cron, +@fastify/static, +@types/node-cron

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — com crons de sequence e trial
- payjarvis-web: ONLINE (pm2, porta 3000)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- openclaw: ONLINE (pm2, porta 4000) — com credit check integrado
- Banners: https://www.payjarvis.com/public/banners/ → 200
- Credits API: https://www.payjarvis.com/api/credits/packages → 200

### Integracoes ativas
- Stripe: cobranças off_session para credit packs
- Telegram: credit check + sequence active mark
- WhatsApp (Twilio): credit check + alertas de crédito
- Prisma Migrate Deploy: migrações formais, sem risco para tabelas raw SQL
- Crons: sequence (horário + 9AM), trial alerts (diário 9AM)

### Riscos / Atencao
- `INTERNAL_SECRET` está como `dev-internal-secret` — trocar em produção
- Tabelas openclaw_* são raw SQL (não gerenciadas pelo Prisma) — NUNCA usar `prisma db push`
- payjarvis-kyc: em restart loop (168 restarts) — investigar separadamente
- Banners dependem de Nginx roteando `/public/` → API (configurado)

---

## 2026-03-15 — Share via Bot + Fix "Link nao encontrado"

### O que foi feito
- **Endpoint interno**: `GET /api/bots/:botId/share/generate?telegramId=X` — gera share link + QR Code base64 sem Clerk auth, protegido por x-internal-secret
- **Comando /indicar**: novo comando no OpenClaw que chama share/generate e envia link + QR Code no Telegram
- **Deteccao de texto**: "compartilhar", "share", "indicar", "quero indicar", "link de indicacao" ativam o fluxo automaticamente
- **Menu atualizado**: `/indicar` adicionado ao menu de comandos do /start (pt e en)

### Bug corrigido — "Link nao encontrado" na pagina /join
- **Causa raiz**: `NEXT_PUBLIC_API_URL=https://www.payjarvis.com/api` + chamadas com `/api/share/...` = URL duplicada `/api/api/share/...` → 404
- **Fix**: removido prefixo `/api` das chamadas `getSharePreview`, `cloneSharedBot` e `getBotShareLinks` em `apps/web/src/lib/api.ts`
- Codigos estavam salvos corretamente no banco — o problema era puramente no frontend

### Testes producao
- `GET /api/share/LKA9DB3Q` → 200, valid=true, sharedBy=Jose ✓
- `/join/LKA9DB3Q` → HTTP 200 ✓
- Sem duplo `/api/api/` no frontend ✓
- `GET share/generate` → 200, code + QR base64 ✓
- Sem auth → 401 ✓
- Logs sem erros ✓

### Integracoes ativas
- OpenClaw: /indicar + texto "compartilhar" → gera link + QR Code
- API: share/generate interno para bots
- Frontend: /join/[code] carrega preview corretamente

---

## 2026-03-15 — Zero Friction Onboarding via Bot

### O que foi feito
- **Schema**: modelo `OnboardingSession` no Prisma com 16 campos (telegramChatId, whatsappPhone, shareCode, step, email, emailToken, etc)
- **Migration**: `20260315180000_add_onboarding_session` — tabela `onboarding_sessions` criada no PostgreSQL
- **Service**: `onboarding-bot.service.ts` — state machine completa (start → email → email_confirm → limits → payment → complete)
- **Routes**: `onboarding-bot.ts` — 3 endpoints internos (POST /start, POST /step, GET /status/:chatId) protegidos por x-internal-secret
- **Stripe Webhook**: handler `setup_intent.succeeded` adicionado ao `stripe-webhook.ts`
- **Email**: template `sendOnboardingConfirmation` com codigo 6 digitos adicionado ao `email.ts`
- **Pagina /setup-payment**: Stripe Elements para adicionar cartao (page.tsx)
- **Pagina /join atualizada**: CTAs "Ativar no Telegram", "Ativar no WhatsApp", "Prefiro configurar pelo site"
- **Server.ts**: rotas onboarding registradas
- **OpenClaw**: handler `/start SHARECODE` chama onboarding API + interceptor de mensagens redireciona para processStep durante onboarding ativo

### Bug corrigido durante deploy
- `requireInternal` era funcao sincrona sem `done()` — Fastify travava o request. Corrigido para `async function`

### Testes producao
- `POST /api/onboarding/start` → 200, retorna sessionId + mensagem de boas-vindas ✓
- `GET /api/onboarding/status/test999` → 200, `{ active: true }` ✓
- `POST /api/onboarding/step` (email) → 200, avanca para email_confirm ✓
- `POST /api/onboarding/start` sem header → 401 (auth obrigatoria) ✓
- `/join/TEST` → 200 ✓
- `/setup-payment` → 307 (redirect Clerk, esperado) ✓
- Logs sem erros ✓

### Integracoes ativas
- OpenClaw: detecta shareCode no /start e redireciona mensagens para onboarding
- Stripe: Setup Intent + webhook para confirmacao de cartao
- Email: envio de codigo de confirmacao 6 digitos
- Clerk: /join e /setup-payment como rotas publicas

### Backup
- `pre-zeroonboard-20260315-1814` em `/root/backups/`

---

## 2026-03-15 — Bot Share (Viral Growth Engine)

### O que foi feito
- **Schema**: 2 novos modelos Prisma — `BotShareLink`, `BotClone` com relacoes a Bot e User
- **Migration**: `20260315125847_add_bot_share` aplicada no PostgreSQL
- **Service**: `bot-share.service.ts` — gera links, preview publico, clonagem de bot (sem credenciais), stats
- **Routes**: 5 endpoints — POST share, GET preview (publico), POST clone, GET links, DELETE deactivate
- **Referral**: `referral.service.ts` — tracking de clones e conversoes
- **Join Page**: `/join/[code]` — pagina publica viral, dark theme, gradients, CTA adaptativo
- **NFC**: `nfc-share.tsx` — Web NFC API para Android com fallback QR Code
- **Dashboard**: Botao "Compartilhar" no card do bot com modal (QR, copy link, WhatsApp, Telegram)
- **Middleware**: `/join(.*)` adicionado as rotas publicas do Clerk
- **QR Code**: Dependencia `qrcode` instalada na API

### Testes producao
- `GET /api/share/TESTCODE` → 404 (correto, code inexistente)
- `GET /join/TESTCODE` → 200 (pagina publica acessivel)
- `POST /api/bots/:id/share` → 401 (auth obrigatoria, correto)
- `POST /api/share/:code/clone` → 401 (auth obrigatoria, correto)
- Logs sem erros criticos

### Integracoes ativas
- Clerk auth middleware com /join como rota publica
- QR Code generation via `qrcode` npm
- Web NFC API (Android only, fallback QR para iOS)

### Backup
- `pre-botshare-20260315-1258` em `/root/backups/`

---

## 2026-03-15 — PRIMEIRA COMPRA APROVADA

### Marco
- Fluxo completo funcionando end-to-end
- Jarvis buscou produto Amazon automaticamente
- PayJarvis aprovou transação: cmmr5rjbg000b7a56lwad3u00
- Merchant: Amazon | Amount: $6.98 USD
- Bot: @Jarvis12Brain_bot
- Modelo: deep-link (Standard plan)

### O que foi corrigido
- Policies dos 3 bots Jarvis bloqueavam transações em fins de semana (allowedDays = {1,2,3,4,5})
- Atualizado: allowedDays = {0,1,2,3,4,5,6} (todos os dias)
- Atualizado: allowedHours = 0-24 (24h)
- Atualizado: maxPerTransaction = 200
- Rules engine reiniciado para limpar cache

### Integracoes ativas
- Amazon checkout via browser-agent (CDP)
- Policy engine + Rules engine aprovando transações
- Telegram bot @Jarvis12Brain_bot conectado

---

## 2026-03-14 — Fix "Bad Request" ao conectar loja na página /stores

### Causa raiz (2 bugs)
**Bug 1 — Empty JSON body:** `stores.ts` chamava `POST /browser/context/create` com `Content-Type: application/json` mas sem body. O Fastify do browser-agent rejeitava com `FST_ERR_CTP_EMPTY_JSON_BODY` (400 Bad Request). Fix: adicionado `body: JSON.stringify({})`.

**Bug 2 — FK violation (clerkId vs userId):** `stores.ts` usava `(request as any).userId` diretamente no Prisma. O middleware `requireAuth` seta `userId = payload.sub` (Clerk ID, ex: `user_3Ar47...`), mas `storeContext.userId` é FK para `users.id` (CUID interno). Todas as outras rotas (bots.ts, etc.) resolvem com `prisma.user.findUnique({ where: { clerkId } })` — stores.ts não fazia isso.

### Correções
1. `apps/api/src/routes/stores.ts`: Adicionado `body: JSON.stringify({})` na chamada `browserAgentFetch("/browser/context/create")`
2. `apps/api/src/routes/stores.ts`: Todas as 5 rotas agora resolvem clerkId → user.id antes de queries Prisma (seguindo padrão de bots.ts)
3. Rebuild TypeScript (`npx tsc`) + restart pm2

### Verificação
- `GET /api/stores` autenticado → 200 ✓
- `POST /api/stores/connect` autenticado → chega ao Browserbase (não mais Bad Request) ✓
- Browserbase retorna 402 (limite do plano free) — erro externo, não bug de código
- Frontend exibe mensagem de erro corretamente no banner
- Compilação TypeScript: sem erros

### Limitação atual
Browserbase free plan minutes esgotados. Para testar store connect end-to-end: upgrade conta em browserbase.com/plans

---

## 2026-03-14 — Fix login via GitHub OAuth (sessão não persistia)

### Causa raiz
O `NEXT_PUBLIC_CLERK_PROXY_URL=https://www.payjarvis.com/__clerk` estava configurado no frontend, mas o Clerk Dashboard NÃO tinha o proxy configurado. Resultado:
1. OAuth callback ia para `clerk.payjarvis.com` diretamente (sem proxy)
2. Clerk setava cookie de sessão em `clerk.payjarvis.com`
3. Clerk JS SDK fazia requests via proxy (`www.payjarvis.com/__clerk/`) e enviava cookies de `payjarvis.com`
4. Cookie de sessão estava em domínio diferente → sessão vazia → usuário parecia não logado

Afetava GitHub E Google OAuth igualmente. Confirmado via logs do Nginx: José (174.176.182.36) completava OAuth, chegava em `/onboarding/step/1`, mas `/api/onboarding/status` retornava 401 (sem sessão).

### Correção
- Removido `NEXT_PUBLIC_CLERK_PROXY_URL` do `.env.production` (setado vazio)
- Clerk JS SDK agora fala diretamente com `clerk.payjarvis.com` (mesmo domínio do OAuth callback)
- Rebuild Next.js + restart pm2

### Verificação (Playwright)
- Página `/sign-in` carrega com 0 erros no console
- Clique em "Continue with GitHub" → redireciona para `github.com/login?client_id=Ov23liJCv4GsfeYat8AL` com `redirect_uri=clerk.payjarvis.com/v1/oauth_callback`
- GitHub mostra "Sign in to GitHub to continue to **payjarvis**" — OAuth app reconhecido
- Logs pm2: zero erros pós-deploy
- `clerk.payjarvis.com` responde OK, `oauth_github` em strategies ativo

### Para reativar proxy no futuro
Para usar `NEXT_PUBLIC_CLERK_PROXY_URL` corretamente:
1. Clerk Dashboard → Domains → Proxy URL = `https://www.payjarvis.com/__clerk`
2. Só então setar `NEXT_PUBLIC_CLERK_PROXY_URL=https://www.payjarvis.com/__clerk` no `.env.production`
3. Rebuild e restart

### Estado atual
- payjarvis-web: ONLINE (pm2, porta 3000, Next.js rebuild limpo)
- payjarvis-api: ONLINE (pm2, porta 3001)
- Clerk: comunicação direta via `clerk.payjarvis.com` (sem proxy)
- GitHub OAuth: funcional (redirect para GitHub confirmado via Playwright)

### Integracoes ativas
- Clerk auth: direto via clerk.payjarvis.com (proxy Nginx mantido mas não usado pelo Clerk JS)
- GitHub OAuth: client_id=Ov23liJCv4GsfeYat8AL, redirect_uri=clerk.payjarvis.com/v1/oauth_callback
- API: rotas /api/ via Nginx proxy para localhost:3001
- Redis, Prisma/PostgreSQL: operacionais

### Riscos / Atenção
- Safari/iOS com ITP pode teoricamente bloquear cookies de `clerk.payjarvis.com` se classificado como tracker, mas improvável pois é subdomain do mesmo eTLD+1 (payjarvis.com)
- Para garantia total em Safari: configurar proxy no Clerk Dashboard conforme instruções acima

---

## 2026-03-14 — Fix "Not Found" na página /stores

### Causa raiz
O arquivo `/etc/nginx/sites-available/payjarvis` tinha config ANTIGA com `proxy_pass http://localhost:3001/;` (trailing slash) que **removia o prefixo `/api/`** antes de enviar ao Fastify. O Fastify registra rotas com prefixo `/api/` (ex: `/api/stores`), então recebia `GET /stores` e retornava 404 "Not Found".

O config correto em `/etc/nginx/sites-enabled/payjarvis` usava `proxy_pass http://127.0.0.1:3001/api/;` (preserva prefixo). Porém era um arquivo regular, não symlink — qualquer operação que copiasse sites-available para sites-enabled reintroduzia o bug.

### Correções aplicadas
1. **Nginx**: Sincronizou `sites-available` com o config correto de `sites-enabled`, e criou symlink para evitar divergência futura
2. **Frontend stores page**: Adicionou error handling para exibir mensagens de erro da API (antes falhava silenciosamente quando `json.success` era false)
3. **Rebuild Next.js**: Build limpo com todas as rotas confirmadas

### Verificação
- `curl https://www.payjarvis.com/api/stores` → 401 (não 404) ✓
- `curl https://www.payjarvis.com/stores` → 307 redirect para sign-in ✓
- Nginx configs idênticos via symlink ✓
- Fastify recebe URL como `/api/stores` (não `/stores`) ✓
- Playwright: página carrega sem erros de console ✓

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-web: ONLINE (pm2, porta 3000, Next.js 14.2.15)
- Nginx: recarregado com config correto

### Integracoes ativas
- Clerk auth: proxy /__clerk/ configurado no Nginx (www e non-www)
- API: todas rotas com prefixo /api/ preservado pelo Nginx
- Redis, Prisma/PostgreSQL: operacionais

### Riscos / Atenção
- Clerk proxy URL (`NEXT_PUBLIC_CLERK_PROXY_URL`) está VAZIO no build — Clerk JS conecta diretamente a clerk.payjarvis.com (third-party). Safari/iOS pode bloquear cookies via ITP. Considerar setar `https://www.payjarvis.com/__clerk` no .env.production e rebuild
- José (último acesso: Safari/iPhone em Miami) pode ter problemas de sessão Clerk por causa disso

---

## 2026-03-14 — Botão Delete Bot + Limpeza Telegram

### O que foi feito
- **Botão Delete**: Adicionado em cada card na página /bots (vermelho, visível para todos os status)
- **Modal de confirmação**: "Tem certeza que deseja excluir o bot X? Irreversível..."
- **Backend cleanup**: DELETE /api/bots/:botId agora remove webhook do Telegram antes de deletar
- **Traduções**: en/pt/es para delete, deleteTitle, deleteConfirm, deleteAction, failedDelete
- **Fix 2 (unicidade)**: Verificado — NÃO existe restrição de email/telefone na tabela bots. Múltiplos bots por usuário já permitidos via POST /api/bots.

### Arquivos alterados
| Arquivo | Alteração |
|---|---|
| apps/api/src/routes/bots.ts | Telegram webhook cleanup no DELETE |
| apps/web/src/lib/api.ts | +deleteBot() |
| apps/web/src/app/(dashboard)/bots/page.tsx | Botão Delete + modal |
| apps/web/src/locales/{en,pt,es}.json | +5 chaves de tradução |

---

## 2026-03-14 — Store Credentials via Chat + Amazon Country Routing

### O que foi feito

#### Cadastro de Credenciais via Chat (Gemini Function Calling)
- **Gemini Function Calling**: Duas tools definidas — `save_store_credentials` e `remove_store_credentials`
- **Fluxo**: Usuário manda credenciais pelo chat → Gemini detecta e chama function → webhook salva no vault criptografado → confirma e deleta mensagem com senha
- **Vault Service**: Novo `credentials.ts` com CRUD (save/get/delete/list) usando AES-256 existente
- **10 lojas mapeadas**: Amazon, Macy's, Walmart, Target, Best Buy, eBay, Costco, Nordstrom, Home Depot, Lowe's
- **Lojas desconhecidas**: Salvas como `generic_<slug>` com mensagem informativa
- **Segurança**: Senha nunca ecoada, mensagem do usuário deletada via Telegram API, nota de segurança enviada
- **3 idiomas**: Confirmações em pt/es/en baseado no bot.language

#### Amazon Country Routing
- **Novo `domains.ts`**: Mapa de 23 países → domínios Amazon (US→.com, BR→.com.br, etc.)
- **System prompt**: Inclui instrução de domínio correto baseado no country do owner
- **Checkout service**: 4 URLs hardcoded → dinâmicas via `getAmazonBaseUrl(owner.country)`
- **Browser-agent scrape**: Aceita `amazonDomain` como parâmetro

### Testes realizados
- Salvar credenciais Macy's via chat → salvo no vault criptografado ✅
- Decrypt funciona → email correto, senha preservada ✅
- Remover credenciais via chat → deletado do banco ✅
- Builds API: zero erros ✅

### Arquivos criados/alterados
| Arquivo | Alteração |
|---|---|
| apps/api/src/services/vault/credentials.ts | NOVO — CRUD de credenciais de lojas |
| apps/api/src/services/amazon/domains.ts | NOVO — mapa país→domínio Amazon |
| apps/api/src/services/gemini.ts | Function calling (save/remove credentials) |
| apps/api/src/routes/onboarding.routes.ts | Handler de function calls no webhook |
| apps/api/src/services/amazon/checkout.service.ts | URLs dinâmicas por país |
| apps/browser-agent/src/routes/scrape.ts | amazonDomain como parâmetro |

---

## 2026-03-14 — System Prompt Dinâmico + Welcome /start + Amazon Form Fix

### O que foi feito

#### Correção 1: System Prompt Dinâmico por Bot/Usuário
- **Schema**: 4 novos campos no model Bot: systemPrompt, botDisplayName, capabilities, language
- **Backend**: chatWithGemini() aceita ChatContext (ownerName, botName, systemPrompt, capabilities, language)
- **Backend**: PATCH /api/bots/:botId aceita os 4 novos campos
- **Dashboard**: Seção "Bot Personality" na página do bot (nome, idioma, capabilities, prompt customizado)

#### Correção 2: Mensagem de Boas-Vindas no /start
- Webhook detecta /start e envia welcome template (sem tokens Gemini)
- Personalizada com first_name + botDisplayName + capabilities
- 3 idiomas (pt/es/en) baseado em bot.language

#### Fix: Amazon Form Validation
- type="email" → type="text" inputMode="email" nos formulários Amazon

#### Fix: Gemini Model Update
- gemini-2.0-flash (descontinuado) → gemini-2.5-flash

### Testes (curl)
- /start → welcome com nome "Adrianne" ✅
- Mensagem normal → Gemini com prompt dinâmico ✅
- Builds API + Web: zero erros ✅

### Arquivos alterados
| Arquivo | Alteração |
|---|---|
| packages/database/prisma/schema.prisma | +4 campos Bot |
| apps/api/src/services/gemini.ts | ChatContext dinâmico |
| apps/api/src/routes/onboarding.routes.ts | /start handler + dynamic prompt |
| apps/api/src/routes/bots.ts | allowedFields expandido |
| apps/web/src/lib/api.ts | Bot interface expandido |
| apps/web/src/app/(dashboard)/bots/[id]/page.tsx | Seção Bot Personality |
| apps/web/src/components/amazon-vault-card.tsx | type="email" fix |
| apps/web/src/app/(dashboard)/connect/amazon/page.tsx | type="email" fix |

---

## 2026-03-14 — Telegram Bot Token Integration (Dashboard)

### O que foi feito

#### Backend — 4 novos endpoints em `onboarding.routes.ts`
1. **`POST /api/bots/:botId/telegram/connect`** — Recebe token do Telegram, valida via `getMe`, configura webhook via `setWebhook`, salva em `BotIntegration` (provider: `telegram_bot`)
2. **`GET /api/bots/:botId/telegram/status`** — Retorna status de conexão (connected, username, name, connectedAt)
3. **`POST /api/bots/:botId/telegram/disconnect`** — Remove token, deleta webhook no Telegram, desativa integração
4. **`POST /api/bots/:botId/telegram/webhook`** — Recebe updates do Telegram (validação de secret token)

#### Frontend — Integrations page
- Seção "Telegram Bot" aparece quando bot selecionado é plataforma TELEGRAM
- Input para colar token do @BotFather com botão "Validate & Save"
- Status "Connected" com @username quando já configurado
- Botão "Disconnect" para remover conexão
- Feedback visual: loading, sucesso, erro
- Traduções em 3 idiomas (en, pt, es)

#### API Client (`apps/web/src/lib/api.ts`)
- `connectTelegramBot()` — POST token para validação
- `getTelegramBotStatus()` — GET status de conexão
- `disconnectTelegramBot()` — POST para desconectar

#### Testes realizados (API direto)
- Token inválido → rejeitado pela API do Telegram
- Token vazio → 400 "required"
- Token real → sucesso, retorna @PayJarvisBot
- Status → connected: true com dados
- Webhook sem secret → 403 "Invalid secret"
- Disconnect → sucesso, status volta para connected: false

### Estado atual
- Endpoints em produção e testados
- Bot da Adrianne (JARVIS) com token conectado (@PayJarvisBot)
- Webhook configurado em `https://www.payjarvis.com/api/bots/:botId/telegram/webhook`
- Frontend buildado e deployado

### Integrações ativas
- Clerk Auth: OK
- Telegram Bot Token: NOVO — salvo em BotIntegration.config
- Webhook Telegram (global): `/api/notifications/telegram/webhook` — mantido
- Webhook Telegram (per-bot): `/api/bots/:botId/telegram/webhook` — NOVO

### Arquivos alterados
| Arquivo | Alteração |
|---|---|
| `apps/api/src/routes/onboarding.routes.ts` | +4 endpoints Telegram (connect, status, disconnect, webhook) |
| `apps/web/src/lib/api.ts` | +3 funções API (connectTelegramBot, getTelegramBotStatus, disconnectTelegramBot) |
| `apps/web/src/app/(dashboard)/integrations/page.tsx` | Seção Telegram Bot com input/status/disconnect |
| `apps/web/src/locales/en.json` | +11 chaves de tradução |
| `apps/web/src/locales/pt.json` | +11 chaves de tradução |
| `apps/web/src/locales/es.json` | +11 chaves de tradução |

---

## 2026-03-14 — Multi-User Architecture + Onboarding Rewrite + VPS Optimization

### O que foi feito

#### Auditoria Completa (7 blocos)
- Amazon Vault: OK (schema + endpoints + crypto)
- Amazon Checkout: OK (service + browser-agent + scrape)
- OpenClaw Tools: OK (3 Amazon tools já existiam em gemini.js + index.js)
- Nginx: OK (proxy /api/ preservado)
- Onboarding: Reescrito de 5 para 3 steps
- Frontend Dashboard: OK (transactions prefix fix)
- Infra: 7/7 services online

#### Onboarding Simplificado (3 steps)
1. **Step 1**: Nome + Telefone + País (auto-cria bot JARVIS)
2. **Step 2**: Pagamento (SDK ou Stripe Elements inline)
3. **Step 3**: Threshold + Deep Link Telegram (polling auto-detect)
- Removido: KYC/OCR, upload documento, selfie, 5 steps antigos
- i18n: pt.json, en.json, es.json completamente reescritos

#### Plug-and-Play JARVIS (deep link)
- `POST /api/onboarding/generate-link` — gera código act_xxx, retorna t.me URL
- `GET /api/onboarding/activation-status` — polling (connected: bool)
- `POST /api/onboarding/complete-activation` — chamado pelo OpenClaw
- OpenClaw `/start act_xxx` — deep link handler, envia trumpet, ativa user
- Activation server porta 4001 no OpenClaw
- `bot-provisioning.ts` — service que orquestra a ativação

#### Multi-User Security (race condition fix)
- **REMOVIDO**: `let _currentUserId = null` (variável global)
- **ADICIONADO**: `createToolHandler(userId)` — factory que retorna closure
- Cada mensagem cria toolHandler isolado com userId local
- Zero variáveis globais de estado de usuário
- **REMOVIDO**: `isAdmin(ctx)` — single-user lock
- **ADICIONADO**: `isAuthorizedUser(ctx)` — verifica onboardingCompleted via API
- Cache de auth: 5 min TTL, admin bypass garantido

#### API Step Handlers (frontend/backend sync)
- Step 1 API: aceita `{fullName, phone, country}` (não mais KYC)
- Step 2 API: aceita `{method: "sdk"|"stripe_card"}` (não mais bot creation)
- Step 3: handled by `/api/onboarding/generate-link` + `/complete-activation`
- `GET /api/users/telegram/:id` — retorna approvalThreshold, botId, onboardingCompleted
- `GET /api/transactions` — prefix fix (/api/transactions)

#### DB Schema
- Adicionado: `phone`, `approvalThreshold`, `onboardingCompleted`, `botActivatedAt` na tabela users
- Reusa `telegram_link_codes` para deep link activation codes

#### VPS Optimization (FASE 1)
- Disco: 97% → 79% (35GB de sandboxes + 776MB journal limpos)
- Ollama: desativado (redundante com Gemini API)
- payjarvis-kyc: parado (removido do fluxo)
- botfriendly-mcp: parado (não usado)
- pm2-logrotate: instalado (10MB max, 3 retained, compressed)

### Arquivos criados
- `/root/Payjarvis/apps/api/src/services/bot-provisioning.ts`

### Arquivos alterados
- `schema.prisma` — 4 campos novos (phone, approvalThreshold, onboardingCompleted, botActivatedAt)
- `onboarding.routes.ts` — steps 1/2 reescritos + 3 endpoints deep link + /activate
- `health.ts` — endpoint users ampliado
- `transactions.ts` — prefix /api/ fix
- `api.ts` (web lib) — generateActivationLink + getActivationStatus
- `onboarding-progress.tsx` — 3 steps
- `onboarding-guard.tsx` — threshold atualizado
- `step/1/page.tsx` — nome+telefone+país (sem KYC)
- `step/2/page.tsx` — pagamento Stripe inline
- `step/3/page.tsx` — threshold + deep link + polling
- Steps 4 e 5 removidos
- `pt.json`, `en.json`, `es.json` — i18n reescrito
- `/root/openclaw/index.js` — createToolHandler, isAuthorizedUser, deep link /start, activation server

### Estado atual
- 5 services online: payjarvis-api, payjarvis-web, payjarvis-rules, browser-agent, openclaw
- 2 services parados: payjarvis-kyc, botfriendly-mcp
- pm2-logrotate: ativo
- Chrome CDP: online porta 18800
- PostgreSQL: 25 tabelas
- Disco: 42GB livres, RAM: 12GB disponível

### Integracoes ativas
- Telegram webhook: https://www.payjarvis.com/webhook/telegram
- OpenClaw activation: porta 4001
- Clerk auth: proxy via /__clerk/
- Stripe: SetupIntent flow no onboarding
- Gemini 2.5 Flash: function calling no OpenClaw
- Chrome CDP: stealth mode, porta 18800

### Riscos e pontos de atenção
- Disco ainda em 79% — monitorar crescimento
- `payjarvis-rules` (:3002) não é chamado por ninguém — candidato a desativar
- Docker containers (n8n, dozzle, agent-mongodb) consomem recursos sem uso ativo
- Deep link flow depende do OpenClaw estar online na porta 4001
- Auth cache de 5 min pode atrasar revogação de acesso

---

## 2026-03-14 — Welcome Trumpet + User Lookup API + Onboarding Diagnosis

### O que foi feito

#### Welcome Trumpet (OpenClaw)
1. **`isFirstMessage(userId)`** — Nova função em memory.js: COUNT de mensagens no PostgreSQL
2. **`sendWelcomeTrumpet(ctx)`** — Detecta primeiro acesso, resolve nome (Telegram → PayJarvis API → fallback "amigo")
3. **Mensagem bilíngue** — PT (se language_code pt/es) ou EN (outros), formatada com Markdown
4. **Idempotência** — Trumpet salvo como mensagem 'model' no histórico, nunca dispara de novo
5. **Salva nome como fact** — `upsertFact(userId, 'name', name, 'personal', 'auto')`

#### API Endpoint
6. **`GET /api/users/:telegramId`** — Busca User por telegramChatId, retorna name + email (public, sem auth)
7. Adicionado em health.ts, compilado para dist/, restart PM2

#### Diagnóstico Onboarding (mapeamento completo)
- 8 steps avaliados: 3 funcionais, 2 parciais, 3 faltantes
- Detalhes no relatório entregue ao usuário

### Arquivos alterados
- `/root/openclaw/memory.js` — +isFirstMessage(), +export
- `/root/openclaw/index.js` — +getWelcomeTrumpet(), +getUserNameFromPayJarvis(), +sendWelcomeTrumpet(), integrado no message handler
- `/root/Payjarvis/apps/api/src/routes/health.ts` — +GET /api/users/:telegramId
- `/root/Payjarvis/apps/api/dist/routes/health.js` — recompilado

### Estado atual
- payjarvis-api: ONLINE (porta 3001) — com endpoint /api/users/:telegramId
- openclaw: ONLINE (porta 4000) — com welcome trumpet ativo
- Testado: trumpet dispara na primeira msg, não repete na segunda

### Integracoes ativas
- Telegram webhook: https://www.payjarvis.com/webhook/telegram
- VAULT_ENCRYPTION_KEY: configurada
- Prisma/PostgreSQL: tabelas intactas
- Chrome CDP: porta 18800
- Stripe: CONNECTED (visa ****5798)

### Sandbox pendente (NÃO deployado)
- `/root/sandbox/Payjarvis_onboarding_simplify_20260313/` — onboarding simplificado (3 steps)
- Aguardando aprovação do José para deploy

---

## 2026-03-13 — Amazon Account Vault + Real Checkout System

### O que foi feito

#### Modelo de Dados
1. **UserAccountVault** — tabela para sessões criptografadas (AES-256-CBC) por provider
2. **AmazonOrder** — tracking de pedidos Amazon (PENDING → CHECKOUT_STARTED → PLACED → FAILED)
3. Tabelas já existiam no banco, Prisma client regenerado

#### Serviços (apps/api/src/services/)
4. **vault/crypto.ts** — AES-256-CBC encrypt/decrypt de cookies de sessão
5. **vault/vault.service.ts** — CRUD: saveSession, getSession, deleteSession, listSessions, verifySession
6. **amazon/checkout.service.ts** — startCheckout (add to cart + proceed) + confirmOrder (place order)

#### Rotas API
7. **routes/vault.ts** — 7 endpoints:
   - POST /api/vault/amazon/connect — inicia fluxo de login
   - POST /api/vault/amazon/connect-link — gera link JWT (15min) para Telegram
   - POST /api/vault/amazon/verify-token — valida token JWT
   - POST /api/vault/amazon/capture — captura cookies após login
   - GET /api/vault/amazon/status/:userId — verifica sessão
   - POST /api/vault/amazon/verify/:userId — testa se sessão funciona
   - DELETE /api/vault/amazon/disconnect/:userId — remove sessão
   - GET /api/vault/sessions/:userId — lista todos os providers
8. **routes/checkout.ts** — 3 endpoints:
   - POST /api/amazon/checkout/start
   - POST /api/amazon/checkout/confirm
   - GET /api/amazon/checkout/:orderId

#### Browser Agent
9. /navigate já suporta injectCookies (cookies do vault)
10. /extract-cookies já implementado (captura cookies via CDP)

#### Frontend
11. **connect/amazon/page.tsx** — página de conexão Amazon com suporte JWT token
12. **amazon-vault-card.tsx** — card na página de integrações (status, verify, disconnect)
13. Integrations page atualizada com seção "Account Vault"

#### OpenClaw (Bot Telegram)
14. 3 novos tools Gemini: amazon_check_session, amazon_start_checkout, amazon_confirm_order
15. System prompt com fluxo de checkout completo
16. Tool handlers chamando PayJarvis API

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — vault + checkout endpoints respondendo
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2, porta 3000)
- browser-agent: ONLINE (pm2, porta 3003) — CDP connected porta 18800
- openclaw: ONLINE (pm2, porta 4000) — 3 novos tools registrados

### Integracoes ativas
- Chrome CDP: porta 18800
- Telegram bot: webhook mode
- VAULT_ENCRYPTION_KEY: configurada (AES-256)
- Prisma/PostgreSQL: tabelas user_account_vaults + amazon_orders

### Pendente
- Teste end-to-end real: conectar conta Amazon e fazer compra de teste
- Web build: Next.js precisa rebuild para incluir nova página /connect/amazon
- verify-sdk tem erro TS pré-existente (não relacionado ao vault)

---

## 2026-03-13 — Landing page redesign + iFood integration + client-side fix

### O que foi feito

#### Landing Page (apps/web)
1. Redesign completo da landing page — 7 secoes: Hero, Products, Capabilities, Trust, Integrations, SDK Preview, Final CTA
2. Headline: "Your AI Agent. Ready to act." com gradient text
3. 3 cards de produto: Plug & Play Bot, Bring Your Bot, Enterprise
4. 6 capabilities em grid: Flights, Restaurants, Shopping, Events, Transport, Calendar
5. 4 trust cards: KYC, Spending Firewall, Human-in-the-Loop, Audit Log
6. 10 parceiros na secao Integrations (incluindo iFood)
7. SDK preview com code window e syntax highlighting
8. Animacoes: floating orbs, fade-in staggered, hover lifts
9. Traducoes atualizadas em 3 idiomas (en/pt/es)

#### iFood Integration
1. Provider registry: iFood adicionado como delivery provider (onboarding.routes.ts)
2. Integration grid: emoji mapping para iFood (integration-grid.tsx)
3. Site extractor: apps/browser-agent/src/sites/ifood.ts — detecta restaurante, valor R$, itens
4. Affiliate signup script: apps/browser-agent/src/scripts/affiliate-signup.ts — /affiliate ifood
5. Env vars: IFOOD_CLIENT_ID, IFOOD_CLIENT_SECRET, IFOOD_MERCHANT_ID (em branco, aguardando cadastro)
6. Estrategia: API oficial = merchant/POS only; consumer orders = Layer 4 Browserbase

#### Fix: Client-side exception (payjarvis.com)
- Causa raiz: static assets (JS/CSS chunks) dessincronizados entre .next/static/ e .next/standalone/
- O build gerava novo BUILD_ID mas start-web.sh so sincroniza no boot do PM2
- Solucao: rebuild + pm2 restart (start-web.sh faz cp -r automaticamente)

### Estado atual
- payjarvis-api: ONLINE (porta 3001) — com iFood no provider registry
- payjarvis-web: ONLINE (porta 3000) — landing page nova, zero erros
- browser-agent: ONLINE (porta 3003) — com ifood.ts extractor + affiliate-signup.ts
- payjarvis-rules: ONLINE (porta 3002)
- payjarvis-kyc: ONLINE (porta 3004)
- openclaw: ONLINE (porta 18800)

### Integracoes ativas
- 10 parceiros listados: Expedia, Booking.com, Amazon, Mercado Livre, OpenTable, Yelp, Ticketmaster, Fandango, Viator, iFood
- iFood: env vars vazias — preencher apos /affiliate ifood via Browserbase
- Telegram notifications: ativo
- Clerk auth: ativo
- Stripe payments: ativo

#### OpenClaw — Telegram webhook fix
1. Convertido de long polling (bot.start) para webhook mode (webhookCallback)
2. Servidor HTTP nativo na porta 4000 com /health e /webhook/telegram
3. Nginx: location /webhook/telegram → proxy_pass localhost:4000
4. Webhook registrado: https://www.payjarvis.com/webhook/telegram
5. Bot commands registrados via setMyCommands
6. .env atualizado: PORT=4000, WEBHOOK_PATH=/webhook/telegram

### Riscos / Atencao
- iFood env vars em branco — rodar /affiliate ifood para cadastrar no developer portal
- Sempre fazer pm2 restart apos next build para sincronizar static assets
- favicon.ico 404 — cosmético, adicionar quando tiver branding final
- OpenClaw agora usa webhook mode — se mudar dominio, re-registrar webhook com setWebhook

---

## 2026-03-13 — Email SMTP + Multi-tenancy OpenClaw (Slot Manager + User Router + Instance Spawner)

### O que foi feito

#### Email Service (SMTP Zoho)
1. **`apps/api/src/services/email.ts`** — Transporter SMTP via smtp.zoho.com:587 (STARTTLS), singleton nodemailer
2. **5 templates HTML responsivos**: templateApprovalRequest, templateTransactionConfirmed, templateTransactionBlocked, templateDailySummary, templateHandoffRequest
3. **Notificações dual-channel**: `notifications.ts` agora envia Telegram + Email em paralelo (non-blocking) em: notifyApprovalCreated, notifyTransactionApproved, notifyTransactionBlocked, notifyHandoffCreated
4. **Rotas**: `POST /notifications/email` (envio avulso autenticado), `GET /notifications/email/status` (status config)
5. **Dependências**: nodemailer + @types/nodemailer
6. **Env vars**: ZOHO_EMAIL, ZOHO_PASSWORD, ZOHO_SMTP, ZOHO_PORT em .env.production

#### Multi-tenancy OpenClaw — Schema
1. **`OpenClawInstance`** model — name, processName (PM2), port (unique), capacity (default 100), currentLoad, status (ACTIVE/FULL/OFFLINE)
2. **`InstanceUser`** model — userId (unique 1:1), instanceId. Relação `instanceAssignment` no User
3. Schema sincronizado com `prisma db push`. Instance-01 seedada (PM2: openclaw, port 4000, capacity 100, 1 user)

#### Slot Manager (`apps/api/src/services/instance-manager.ts`)
- `findAvailableInstance()` — busca instância ACTIVE com menor carga
- `isInstanceFull(instanceId)` — boolean: currentLoad >= capacity
- `updateInstanceStatus(instanceId)` — auto-toggle ACTIVE ↔ FULL
- `getInstanceStats()` / `getInstanceStatus()` — array com load, capacity, available, utilizationPct

#### User Router
- `assignUser(userId)` / `assignUserToInstance()` — encontra slot, auto-spawn se todas cheias
- `releaseUser(userId)` / `removeUserFromInstance()` — libera slot, decrementa load
- `getInstanceForUser(userId)` / `getUserInstance()` — retorna instância do usuário
- `routeUser(userId)` — fluxo completo: verifica existente → assign → spawn → retorna endpoint `http://localhost:{port}`
- `getRouteForBot(botId)` — resolve botId → owner → instância → endpoint

#### Instance Spawner
- `spawnInstance()` — 1. mkdir /root/openclaw-instances/instance-{N}/ 2. Copia index.js, gemini.js, memory.js, payjarvis.js, package.json, skills/ 3. Gera .env com porta única (3010, 3011...) 4. npm install --production 5. pm2 start 6. pm2 save 7. Salva no banco. Max 10 instâncias
- `despawnInstance(instanceId)` — valida (não instance-01, vazia, >1 ativa) → pm2 delete → rm -rf dir → DELETE banco
- `deactivateInstance(instanceId)` — pm2 stop + status OFFLINE (mantém arquivos)
- `checkAndSpawn()` — se TODAS instâncias >= 90% capacidade → spawn automático

#### Rotas (`apps/api/src/routes/instances.ts`)
| Rota | Método | Ação |
|------|--------|------|
| `/instances` | GET | Lista instâncias {instances, totalUsers, totalCapacity, utilizationPct} |
| `/instances/my` | GET | Instância do usuário autenticado |
| `/instances/assign` | POST | Atribuir usuário a instância |
| `/instances/my` | DELETE | Liberar slot |
| `/instances/spawn` | POST | Spawn manual |
| `/instances/:id` | DELETE | Despawn (remove se vazia) |
| `/instances/:id/deactivate` | POST | Desativar (OFFLINE) |
| `/instances/:id/full` | GET | Boolean: cheia? |
| `/instances/route` | GET | Endpoint do usuário autenticado |
| `/instances/route/bot/:botId` | GET | Endpoint da instância do bot |
| `/instances/capacity` | GET | Check + auto-spawn se >= 90% |

#### Integrações
- **Onboarding Step 5** — ao completar onboarding, usuário é auto-atribuído a instância via assignUserToInstance()
- **Audit Logger** — 2 novos eventos: INSTANCE_SPAWNED, USER_ASSIGNED
- **Seed script** — `apps/api/scripts/seed-instance.ts` executado: instance-01 criada

### Arquivos criados
- `apps/api/src/services/email.ts`
- `apps/api/src/services/instance-manager.ts`
- `apps/api/src/routes/instances.ts`
- `apps/api/scripts/seed-instance.ts`

### Arquivos alterados
- `packages/database/prisma/schema.prisma` (+OpenClawInstance, +InstanceUser, +instanceAssignment no User)
- `apps/api/src/services/notifications.ts` (+email dual-channel em todas notificações)
- `apps/api/src/routes/notifications.ts` (+email routes, +sendEmail import)
- `apps/api/src/core/audit-logger.ts` (+INSTANCE_SPAWNED, +USER_ASSIGNED events)
- `apps/api/src/routes/onboarding.routes.ts` (+auto-assign instância no step 5)
- `apps/api/src/server.ts` (+instanceRoutes import/register)
- `apps/api/package.json` (+nodemailer, +@types/nodemailer)
- `.env.production` (+ZOHO_EMAIL, +ZOHO_PASSWORD, +ZOHO_SMTP, +ZOHO_PORT)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — com instance routes + email service
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003)
- openclaw: ONLINE (pm2) — instance-01 registrada no banco (capacity 100, load 1)

### Integracoes ativas
- **Email**: SMTP Zoho configurado (aguardando ZOHO_PASSWORD após criar jarvis@payjarvis.com)
- **Multi-tenancy**: OpenClawInstance + InstanceUser + slot manager + user router + spawner — ATIVO
- **4 Camadas**: Core + Composio + Browserbase + Dashboard — sem alterações
- Clerk auth, Stripe, Telegram, Redis, PostgreSQL, Chrome CDP — sem alterações

### Pendente
- Configurar domínio payjarvis.com no Zoho Mail (MX + SPF + TXT no GoDaddy)
- Criar mailbox jarvis@payjarvis.com e gerar app password
- Setar ZOHO_PASSWORD no .env.production

### Sandbox
- `/root/sandbox/Payjarvis_email_20260313/` — preservada para rollback

---

## 2026-03-13 — Arquitetura de 4 Camadas (Core + Composio + Browserbase + Dashboard)

### O que foi feito

#### Camada 1 — PayJarvis Core (`apps/api/src/core/`)
1. **`policy-engine.ts`** — Avalia permissões: limites diários/semanais/mensais (query Transaction aggregate), categorias whitelist/blocklist, merchants whitelist/blacklist, time window (timezone-aware), auto-approve threshold
2. **`trust-manager.ts`** — Trust levels: RESTRICTED (<200) | STANDARD (200-500) | TRUSTED (500-800) | AUTONOMOUS (>800). Auto-approve limits: $0 / $25 / $100 / $500 por nível
3. **`approval-manager.ts`** — Human-in-the-loop: requestApproval (10min TTL), approve/reject com update de trust score, checkTimeouts (background 60s), notificação Telegram automática
4. **`session-manager.ts`** — Sessões Redis com TTL 30min, key `session:bot:{botId}`, tracking de intent/pendingActions/context
5. **`audit-logger.ts`** — Log imutável append-only. 12 event types (BOT_ACTION_REQUESTED, POLICY_DECISION, APPROVAL_*, API_CALL_MADE, COMPOSIO_ACTION, BROWSERBASE_SESSION, PAYMENT_*). 4 camadas
6. **`action-executor.ts`** — Ponto central de execução. SEARCH/READ = log only. PURCHASE/BOOK/RESERVE/SEND = policy engine completa + approval flow
7. **`index.ts`** — Re-exports de todos os módulos

#### Camada 1 — Core Routes (`apps/api/src/routes/core.ts`)
- `GET /api/core/policy/:botId` — retorna política + trust level
- `PUT /api/core/policy/:botId` — atualiza política (upsert)
- `GET /api/core/approvals/:botId` — lista aprovações pendentes
- `POST /api/core/approvals/:id/approve` — aprova uma ação
- `POST /api/core/approvals/:id/reject` — rejeita uma ação
- `GET /api/core/audit/:botId` — histórico de auditoria (filtro por camada, paginação)
- `GET /api/core/session/:botId` — sessão ativa
- `POST /api/core/session/:botId/action` — executa ação via action-executor (usado pelo OpenClaw)
- `GET /api/core/status` — status das 4 camadas (para dashboard)

#### Camada 2 — Commerce Integration
- Commerce router atualizado com audit logging via Layer 1 audit-logger (AuditEvents.API_CALL_MADE)

#### Camada 3 — Composio (`apps/api/src/services/composio/`)
1. **`composio-client.ts`** — Singleton SDK, composioExecute, composioListActions, hasConnectedAccount
2. **`actions.ts`** — sendConfirmationEmail (GMAIL_SEND_EMAIL), fetchEmails (GMAIL_FETCH_EMAILS), createCalendarEvent (GOOGLECALENDAR_CREATE_EVENT), listCalendarEvents (GOOGLECALENDAR_LIST_EVENTS), sendNotification (SLACK_SEND_MESSAGE)
3. **Routes** (`/api/composio/*`): tools list, connect OAuth, connections, email/calendar/notify actions
4. **Setup script** (`apps/api/scripts/composio-setup.ts`)

#### Camada 4 — Browserbase (`apps/browser-agent/src/services/`)
1. **`browserbase-client.ts`** — SDK real: createSession, getSession, getSessionLiveURLs, closeSession, listActiveSessions
2. **`assisted-fallback.ts`** — Cloud browser fallback: cria sessão Browserbase, conecta Playwright via CDP, detecta obstáculos (CAPTCHA/AUTH/NAVIGATION), retorna NEEDS_HANDOFF com live view URL
3. **`handoff-manager.ts`** — Human handoff: mensagens amigáveis por tipo de obstáculo, cria HandoffRequest via API, resolve handoff
4. **Routes** adicionadas ao browser-agent server: `/browser/session/create`, `/browser/session/:id/live`, `/browser/session/:id/close`, `/browser/fallback`, `/browser/handoff/:sessionId`, `/browser/sessions`

#### Frontend — Layer Status Dashboard
- **`apps/web/src/app/(dashboard)/layers/page.tsx`** — Dashboard com 4 cards de status (verde/amarelo/cinza), contadores de ações por camada, botões de configuração
- **Sidebar** — "Layers" adicionado à navegação com ícone de camadas
- **i18n** — strings em EN, PT, ES (layers.title, layers.subtitle, nomes de camadas)

#### OpenClaw — Roteamento pelo Action-Executor
- **`/root/openclaw/payjarvis.js`** — `executeAction()` adicionada: roteia payments pelo `POST /api/core/session/:botId/action` antes de executar. PURCHASE passa pela policy engine (pode ser DENIED ou PENDING_APPROVAL)

#### Prisma Schema
- **`PolicyDecisionLog`** model adicionado: botId, action (JSON), allowed, reason, trustLevel, layer, createdAt

#### Variáveis de Ambiente
- `COMPOSIO_API_KEY=ak_DLG0q1eWkEv2iTOr_PRa`
- `BROWSERBASE_API_KEY=bb_live_zKhgFzlsoQ0k7JJMp316moROWsg`
- `BROWSERBASE_PROJECT_ID=d7276057-3235-4591-b90c-3cc18746e3d3`

### Arquivos criados
- `apps/api/src/core/policy-engine.ts`
- `apps/api/src/core/trust-manager.ts`
- `apps/api/src/core/approval-manager.ts`
- `apps/api/src/core/session-manager.ts`
- `apps/api/src/core/audit-logger.ts`
- `apps/api/src/core/action-executor.ts`
- `apps/api/src/core/index.ts`
- `apps/api/src/routes/core.ts`
- `apps/api/src/services/composio/composio-client.ts`
- `apps/api/src/services/composio/actions.ts`
- `apps/api/src/services/composio/index.ts`
- `apps/api/src/routes/composio.ts`
- `apps/api/scripts/composio-setup.ts`
- `apps/browser-agent/src/services/browserbase-client.ts`
- `apps/browser-agent/src/services/assisted-fallback.ts`
- `apps/browser-agent/src/services/handoff-manager.ts`
- `apps/web/src/app/(dashboard)/layers/page.tsx`

### Arquivos alterados
- `packages/database/prisma/schema.prisma` (+PolicyDecisionLog model)
- `apps/api/src/server.ts` (+coreRoutes, +composioRoutes, +startTimeoutChecker)
- `apps/api/src/services/commerce/index.ts` (+Layer 2 audit logging)
- `apps/web/src/components/sidebar.tsx` (+Layers nav item)
- `apps/web/src/locales/en.json`, `pt.json`, `es.json` (+layers section)
- `apps/browser-agent/src/server.ts` (+6 Browserbase endpoints)
- `.env.production` (+COMPOSIO_API_KEY, +BROWSERBASE_API_KEY, +BROWSERBASE_PROJECT_ID)
- `/root/openclaw/payjarvis.js` (+executeAction routing via action-executor)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — com core routes + composio routes
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2) — com dashboard /layers
- browser-agent: ONLINE (pm2, porta 3003) — com Browserbase endpoints
- openclaw: ONLINE (pm2) — com routing pelo action-executor

### Integracoes ativas
- **Camada 1**: Policy engine, trust manager, approval manager (10min timeout), session manager (Redis 30min), audit logger — TUDO ATIVO
- **Camada 2**: Commerce APIs (Amadeus, Yelp, Ticketmaster) — mock mode (sem API keys), com audit logging Layer 2
- **Camada 3**: Composio SDK conectado (API key configurada). Gmail: 23 ações, Calendar: 28 ações, Slack: 130+ ações disponíveis. Apps NOT CONNECTED (requer OAuth via /api/composio/connect/:app)
- **Camada 4**: Browserbase SDK conectado (API key + project ID configurados). Pronto para criar sessões cloud browser, assisted fallback, e human handoff com live view
- Clerk auth: Google OAuth + email verification
- Stripe: sk_live_ configurada
- Chrome CDP: porta 18800 (auto-connect)
- Telegram: @Jarvis12Brain_bot (notificações admin + user)
- Redis: cache commerce, sessions, rate limiting, token replay
- PostgreSQL: banco principal (PolicyDecisionLog table criada)

### Riscos / Atencao
- Composio apps precisam de OAuth para funcionar (Gmail, Calendar, Slack) — usar POST /api/composio/connect/:app
- Commerce APIs ainda em mock mode — configurar API keys (Amadeus, Yelp, Ticketmaster) para dados reais
- Approval timeout checker roda a cada 60s — aprovações expiram em 10 minutos
- Trust score RESTRICTED (<200) suspende o agent automaticamente
- Browserbase sessions têm timeout de 5 minutos por padrão — ajustável no createSession

### Sandbox
- `/root/sandbox/Payjarvis_4layers_20260313/` — preservada para rollback

---

## 2026-03-13 — Página de Integrações (Onboarding + Dashboard)

### O que foi feito
1. **Novo endpoint** `GET /api/integrations/available` — retorna lista de 12 providers com disponibilidade baseada em env vars do servidor
2. **Novo endpoint** `POST /bots/:botId/integrations/toggle` — toggle individual de provider com connectedAt timestamp
3. **Componente `IntegrationGrid`** reutilizável (`components/integration-grid.tsx`):
   - Grid por categoria (Travel, Restaurants, Events, Marketplace, Transport, Delivery)
   - Cards com toggle on/off, badge "Connected" (verde) e "Coming Soon" (cinza)
   - Toggle animado com spinner durante save
   - Suporte a estado otimista no dashboard
4. **Onboarding Step 3** reescrito: busca providers disponíveis do servidor, pre-habilita todos os disponíveis, salva via API no submit
5. **Dashboard `/integrations`** reescrito: seletor de bot, grid com toggles que salvam imediatamente via API, contador de serviços ativos
6. **i18n**: strings atualizadas em EN, PT, ES (categorias, badges, contadores)

### Arquivos criados
- `apps/web/src/components/integration-grid.tsx`

### Arquivos alterados
- `apps/api/src/routes/onboarding.routes.ts` (+available endpoint, +toggle endpoint)
- `apps/web/src/lib/api.ts` (+AvailableProvider type, +getAvailableIntegrations, +toggleBotIntegration)
- `apps/web/src/app/onboarding/step/3/page.tsx` (reescrito com IntegrationGrid)
- `apps/web/src/app/(dashboard)/integrations/page.tsx` (reescrito com IntegrationGrid)
- `apps/web/src/locales/en.json`, `pt.json`, `es.json` (integrations section expandida)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — com endpoints de integrações
- payjarvis-web: ONLINE (pm2) — com páginas de integrações
- Onboarding: 5 steps (1:KYC, 2:Bot, **3:Integrações**, 4:Payment, 5:Terms)
- Dashboard: `/integrations` com grid de providers e toggles

### Sandbox
- `/root/sandbox/Payjarvis_integrations_20260313/` — preservada para rollback

---

## 2026-03-13 — Commerce Provider Agents (6 serviços centralizados)

### O que foi feito
1. **6 serviços commerce** criados em `apps/api/src/services/commerce/`:
   - `flights.ts` — Amadeus Flight Offers API (OAuth2 auth, mock mode)
   - `hotels.ts` — Amadeus Hotel Offers API (2-step: find + offers, mock mode)
   - `restaurants.ts` — Yelp Fusion Business Search (mock mode)
   - `events.ts` — Ticketmaster Discovery API v2 (mock mode)
   - `transport.ts` — Uber API (placeholder, sempre mock)
   - `delivery.ts` — Uber Eats API (placeholder, sempre mock)
   - `index.ts` — Router central com cache Redis (5min), rate limiting (10 req/min/bot/service), audit logging
2. **Rotas commerce** em `apps/api/src/routes/commerce.ts`:
   - POST /api/commerce/flights/search
   - POST /api/commerce/hotels/search
   - POST /api/commerce/restaurants/search
   - POST /api/commerce/events/search
   - POST /api/commerce/transport/request
   - POST /api/commerce/delivery/search
   - Todas protegidas por `requireBotAuth` middleware
3. **Prisma schema** atualizado: modelo `CommerceSearchLog` + tabela SQL criada
4. **Redis** `redisIncr()` adicionado para rate limiting com TTL
5. **.env.example** atualizado com chaves de API commerce (Amadeus, Yelp, Ticketmaster, Uber)
6. **Todos 6 endpoints testados** com curl — todos retornando mock data corretamente

### Arquivos criados
- `apps/api/src/services/commerce/index.ts`
- `apps/api/src/services/commerce/flights.ts`
- `apps/api/src/services/commerce/hotels.ts`
- `apps/api/src/services/commerce/restaurants.ts`
- `apps/api/src/services/commerce/events.ts`
- `apps/api/src/services/commerce/transport.ts`
- `apps/api/src/services/commerce/delivery.ts`
- `apps/api/src/routes/commerce.ts`

### Arquivos alterados
- `apps/api/src/server.ts` (+import/register commerceRoutes)
- `apps/api/src/services/redis.ts` (+redisIncr function)
- `packages/database/prisma/schema.prisma` (+CommerceSearchLog model)
- `.env.example` (+Commerce APIs section)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — com commerce routes
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Commerce APIs: todas em mock mode (chaves não configuradas)
  - Amadeus (flights/hotels): precisa AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET
  - Yelp (restaurants): precisa YELP_API_KEY
  - Ticketmaster (events): precisa TICKETMASTER_API_KEY
  - Uber (transport/delivery): placeholders (requer partnership)
- Redis: cache commerce (5min TTL), rate limiting
- Clerk auth, Stripe, Telegram, Chrome CDP: sem alterações

### Riscos / Atencao
- Mock mode ativo para todos os serviços — configurar API keys no .env para dados reais
- Rate limit: 10 requests/minuto por bot por serviço — ajustável em commerce/index.ts
- Cache Redis 5 min — pode causar dados stale em buscas frequentes
- Transport e Delivery são sempre mock (APIs requerem partnership approval)

---

## 2026-03-12 — Onboarding Step "Integrations" + BotIntegration model

### O que foi feito
1. **BotIntegration model** adicionado ao Prisma schema — provider, category, enabled, config (JSON), connectedAt
2. **Tabela `bot_integrations`** criada via SQL (CREATE TABLE + indexes + unique constraint botId+provider)
3. **Onboarding expandido de 4 para 5 steps**:
   - Step 1: Identity (KYC) — sem mudanca
   - Step 2: Bot — sem mudanca
   - Step 3: **Integrations** (NOVO) — galeria de provedores em cards com toggle
   - Step 4: Payment — era step 3
   - Step 5: Terms — era step 4
4. **Completion marker**: 5 → 6 (users existentes migrados via UPDATE SET +1 WHERE >= 3)
5. **7 categorias de provedores**: Food & Delivery (Uber Eats, DoorDash, Instacart), Travel (Amadeus, Airbnb, Booking.com, Expedia), Restaurants (OpenTable, Yelp), Events (Ticketmaster, StubHub, Fandango), Marketplace (Amazon, Mercado Livre, Shopify), Transport (Uber, Lyft), Utilities (Coming Soon: electricity, internet, insurance)
6. **API routes**: POST /onboarding/step/3 (integrations), GET/PUT /bots/:botId/integrations
7. **i18n**: strings de integracoes em EN, PT, ES
8. **Frontend**: step 3 galeria, step 4 (payment reposicionado), step 5 (terms reposicionado), progress component atualizado para 5 steps

### Arquivos alterados
- `packages/database/prisma/schema.prisma` (+BotIntegration model, +integrations relation no Bot)
- `apps/api/src/routes/onboarding.routes.ts` (new step 3, renumbered step 4/5, bot integrations endpoints)
- `apps/web/src/app/onboarding/step/3/page.tsx` (reescrito: galeria de integracoes)
- `apps/web/src/app/onboarding/step/4/page.tsx` (reescrito: payment, era step 3)
- `apps/web/src/app/onboarding/step/5/page.tsx` (novo: terms, era step 4)
- `apps/web/src/app/onboarding/page.tsx` (completion threshold 5→6)
- `apps/web/src/app/(dashboard)/layout.tsx` (guard threshold 5→6)
- `apps/web/src/components/onboarding-progress.tsx` (+integrations step)
- `apps/web/src/lib/api.ts` (+BotIntegration type, +getBotIntegrations, +updateBotIntegrations)
- `apps/web/src/locales/en.json`, `pt.json`, `es.json` (+step3 integrations, renumbered step4/step5)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001) — API rebuilt com novas rotas
- payjarvis-web: ONLINE (pm2) — web rebuilt com 5 steps
- payjarvis-rules: ONLINE (pm2, porta 3002)
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Riscos / Atencao
- Users com onboardingStep=5 (old completion) foram migrados para 6 (new completion) via SQL
- Step 3 (integrations) e skippable — user pode pular e configurar depois em Settings
- Providers "Coming Soon" (utilities) mostram card desabilitado
- Integrations dashboard page (/integrations) ja existe no sidebar mas ainda mostra config OpenClaw — pode ser expandida com o grid de integracoes

---

## 2026-03-12 — Fixes: Stripe keys, i18n EN, 12h time, timezone, trust score, notifications

### O que foi feito
1. **Stripe test/live fix**: `.env.production` STRIPE_SECRET_KEY atualizado de `sk_test_` para `sk_live_`
2. **Bot username fix**: instrução de vinculação no onboarding corrigida de `@PayJarvisBot` para `@Jarvis12Brain_bot` (`apps/api/src/routes/notifications.ts`)
3. **i18n padronização EN**: todas strings de notificação (notifications.ts, routes/notifications.ts) traduzidas de PT para EN (~22 strings)
4. **Formato 12h AM/PM**: selects de horário no dashboard convertidos para formato 12h (`apps/web/src/app/(dashboard)/bots/[id]/page.tsx`)
5. **Timezone por usuário**: campo `timezone` adicionado ao Policy (Prisma schema + SQL ALTER TABLE), dropdown com 20 fusos no dashboard, `checkTimeWindow` usa `Intl.DateTimeFormat` para calcular hora local
6. **Trust score fix**: `checkTimeWindow` removido de `ANOMALY_RULES` (causava -50), novo delta `blocked_time_window: -5`. Scores dos bots resetados para 1000
7. **Notificações bot fix**: `TELEGRAM_BOT_TOKEN` e `ADMIN_TELEGRAM_BOT_TOKEN` corrigidos para @Jarvis12Brain_bot (8615760515)
8. **Browser-agent auto-connect**: CDP reconecta automaticamente no boot via setTimeout + POST /connect
9. **Browser-agent no ecosystem**: adicionado ao `ecosystem.config.cjs` para sobreviver a `pm2 delete/start`

### Arquivos alterados
- `.env.production` (Stripe key, Telegram tokens, browser-agent vars)
- `ecosystem.config.cjs` (+browser-agent app)
- `apps/api/src/routes/notifications.ts` (bot username, EN strings)
- `apps/api/src/services/notifications.ts` (EN strings, date format en-US)
- `apps/api/src/services/trust-score.ts` (time window reclassified)
- `apps/rules-engine/src/rules/check-time-window.ts` (timezone support)
- `apps/browser-agent/src/server.ts` (auto-connect CDP)
- `apps/web/src/app/(dashboard)/bots/[id]/page.tsx` (12h format, timezone dropdown)
- `apps/web/src/lib/api.ts` (+timezone field)
- `packages/database/prisma/schema.prisma` (+timezone column)
- `packages/types/src/index.ts` (+timezone in PolicyConfig)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800, auto-connect)

### Integracoes ativas
- Clerk auth: Google OAuth habilitado, email verification ativo
- Stripe: sk_live_ configurada, CardElement dark theme
- Chrome CDP: porta 18800 (auto-connect no boot)
- Telegram @Jarvis12Brain_bot: notificações admin + onboarding (token 8615760515, chat 1762460701)
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal (timezone column adicionada)

### Riscos / Atencao
- 2 bots duplicados no DB (`cmmnzmkmh000d2o9s4mvcz6iv` e `cmmnz556h00042o9slmxfs7g3`) podem ser limpos
- PM2 env caching: usar `pm2 delete + pm2 start` (não apenas restart) para recarregar env do ecosystem.config.cjs

---

## 2026-03-12 — Admin Telegram notifications via @Jarvis12Brain_bot

### O que foi feito
1. Adicionado canal de notificação admin separado via @Jarvis12Brain_bot (token: 8615760515)
2. `notifyApprovalCreated` agora SEMPRE envia para o admin (chat ID 1762460701) via @Jarvis12Brain_bot, independente do fluxo normal via @PayJarvisBot
3. Novo endpoint `POST /notifications/telegram/admin-webhook` para processar callbacks (aprovar/rejeitar) vindos do @Jarvis12Brain_bot
4. `answerCallbackQuery` e `editMessageText` agora aceitam `botToken` opcional para suportar múltiplos bots
5. Webhook do @Jarvis12Brain_bot configurado para `https://www.payjarvis.com/api/notifications/telegram/admin-webhook`
6. Verificação de segurança: admin-webhook só aceita callbacks do `ADMIN_TELEGRAM_CHAT_ID`

### Arquivos alterados
- `.env.production` (+ADMIN_TELEGRAM_BOT_TOKEN, +ADMIN_TELEGRAM_CHAT_ID)
- `apps/api/src/services/notifications.ts` (sendAdminTelegramNotification, botToken param)
- `apps/api/src/routes/notifications.ts` (admin-webhook endpoint)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Clerk auth: Google OAuth habilitado, email verification ativo
- Stripe: pk_live configurada, CardElement dark theme
- Chrome CDP: porta 18800
- Telegram @PayJarvisBot: webhook para onboarding/link de usuários (token 8486332506)
- Telegram @Jarvis12Brain_bot: webhook para notificações admin de aprovação (token 8615760515, chat 1762460701)
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal

### Sandbox
- `/root/sandbox/Payjarvis_2026-03-12/` — preservada para rollback

---

## 2026-03-12 — Painel de autenticação customizado + Google OAuth + Logout

### O que foi feito
1. **Sign-in customizado** (`/sign-in`) — substituído componente genérico `<SignIn />` por UI dark theme com email/senha, link "Esqueceu a senha?" e botão "Continuar com Google" (OAuth)
2. **Sign-up com confirmação de email** (`/sign-up`) — formulário com email, senha, confirmação + tela de código de verificação 6 dígitos enviado por email. Após verificar → redirect para onboarding
3. **Recuperação de senha** (`/forgot-password`) — fluxo 4 etapas: email → código → nova senha → sucesso com redirect
4. **Google OAuth** — botão "Continuar com Google" no login, página `/sso-callback` para finalizar fluxo OAuth (Client ID e Secret configurados no Clerk Dashboard)
5. **Botão Sair no sidebar** — abaixo de "Parceiros", usa `useClerk().signOut()` com redirect para `/sign-in`, hover vermelho
6. **Middleware atualizado** — `/forgot-password` e `/sso-callback` adicionadas como rotas públicas

### Arquivos alterados
- `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx` (reescrito)
- `apps/web/src/app/sign-up/[[...sign-up]]/page.tsx` (reescrito)
- `apps/web/src/app/forgot-password/page.tsx` (novo)
- `apps/web/src/app/sso-callback/page.tsx` (novo)
- `apps/web/src/components/sidebar.tsx` (botão Sair)
- `apps/web/src/middleware.ts` (rotas públicas)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2) — rebuild com auth customizado
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Clerk auth: Google OAuth habilitado, email verification ativo
- Stripe: pk_live configurada, CardElement dark theme
- Chrome CDP: porta 18800
- Telegram notifications: via TELEGRAM_BOT_TOKEN
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal

### Riscos / Atencao
- Clerk Dashboard precisa ter "Email code" habilitado como estratégia de verificação (Settings → Email, Phone, Username) para forgot-password e sign-up verification funcionarem
- Google OAuth precisa de redirect URI configurado no Google Cloud Console apontando para o domínio do PayJarvis
- Sandbox preservada em `/root/sandbox/Payjarvis_auth_20260312/` para rollback

---

## 2026-03-11 — Fix: Stripe CardElement dark theme (onboarding step 3)

### Problema
CardElement do Stripe renderizava com tema light (fundo branco/transparente) dentro da pagina dark theme. Texto cinza claro (#e5e7eb) ficava invisivel no fundo claro do iframe, criando aparencia de "area cinza vazia".

### O que foi feito
1. Adicionado `stripeElementsOptions` com `appearance.theme: "night"` e variaveis de cor alinhadas ao design system (colorBackground: #1e2330, colorText: #e5e7eb, colorPrimary: #2563eb)
2. `<Elements>` provider agora recebe `options={stripeElementsOptions}` em ambos os arquivos:
   - `apps/web/src/app/onboarding/step/3/page.tsx` (1 instancia)
   - `apps/web/src/app/(dashboard)/payment-methods/page.tsx` (3 instancias)
3. Build e deploy realizados com sucesso

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2) — rebuild com fix Stripe
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Stripe: pk_live configurada, CardElement com dark theme
- Chrome CDP: porta 18800
- Telegram notifications: via TELEGRAM_BOT_TOKEN
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal

### Riscos / Atencao
- appearance API do Stripe afeta principalmente PaymentElement; para CardElement legacy o efeito e parcial (fundo do iframe). Cores de texto/placeholder sao controladas pelo style option ja existente
- Sandbox preservado em /root/sandbox/Payjarvis_stripe_20260311/ para rollback

---

## 2026-03-11 — Merged Deploy: Agent Identity + Onboarding Wizard

### O que foi feito
Merge de duas sandboxes independentes em um deploy unificado:

#### Agent Identity System (sandbox Payjarvis_2026-03-11)
1. Modelo Agent (first-class, trustScore 0-1000) + AgentReputation
2. Trust score refactored (escala 0-1000, reputation tracking)
3. BDIT tokens com agent identity fields no JWT
4. JWKS com suporte a key rotation
5. Payment methods: Stripe SetupIntent + PayPal connect com validação
6. Redis hardening: redisSetNX, redisPublish, crash em prod se indisponível
7. Merchant race condition fix (atomic gate via redisSetNX)
8. Browser agent: auto-reconnect CDP, health check, obstacle detection
9. Rules engine: policy cache invalidation via Redis pub/sub
10. Frontend: nova paleta brand, reputation grid, animações

#### Onboarding Wizard (sandbox Payjarvis_onboarding_20260311_0639)
1. Páginas /onboarding/step/1-4 (KYC, bot creation, payment, terms)
2. Schema: dateOfBirth, documentNumber, country, address, kycPhotoPath, kycSubmittedAt, onboardingStep, termsAcceptedAt
3. API: /onboarding/status, /onboarding/step/1-4 (auth required)
4. OnboardingGuard no dashboard layout (redirect se step < 5)
5. Middleware: /onboarding como rota pública no Clerk
6. i18n: strings de onboarding em en/es/pt
7. OCR via tesseract.js para documento no step 1

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003)

### Integracoes ativas
- Chrome CDP: porta 18800 (auto-reconnect ativo)
- Telegram notifications: via TELEGRAM_BOT_TOKEN
- Redis: cache, token replay protection, policy invalidation pub/sub
- Prisma/PostgreSQL: banco principal (schema atualizado com Agent + onboarding fields)
- Google Fonts: DM Sans, Plus Jakarta Sans, JetBrains Mono
- Clerk auth: middleware com /onboarding como rota pública

### Sandboxes preservadas para rollback
- /root/sandbox/Payjarvis_merged_20260311/ (merge final)
- /root/sandbox/Payjarvis_2026-03-11/ (agent identity)
- /root/sandbox/Payjarvis_onboarding_20260311_0639/ (onboarding)

### Riscos / Atencao
- OnboardingGuard redireciona todo usuário novo para /onboarding/step/1 — users existentes com onboardingStep=0 serão redirecionados no próximo login
- tesseract.js carrega WASM ~10MB no browser para OCR — pode ser lento em mobile
- CDP auto-reconnect: exponential backoff até 60s max

---

## 2026-03-11 — Security Headers + SSL Hardening

### O que foi feito
1. SSL hardening: TLSv1.2/1.3 only, ciphers modernos, session tickets off
2. HSTS: max-age=63072000 (2 anos), includeSubDomains, preload
3. X-Content-Type-Options: nosniff
4. X-Frame-Options: SAMEORIGIN (frontend), DENY (API)
5. X-XSS-Protection: 1; mode=block
6. Referrer-Policy: strict-origin-when-cross-origin
7. Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self)
8. Content-Security-Policy completo (whitelists: Clerk, Google Fonts, Cloudflare challenges)
9. API (api.payjarvis.com) tambem com headers de seguranca

### Backup
- Config anterior: /etc/nginx/sites-enabled/payjarvis.bak.20260311

### Riscos / Atencao
- CSP pode bloquear scripts de terceiros nao listados — se adicionar nova integracao, atualizar CSP
- HSTS preload: uma vez submetido ao hstspreload.org, e dificil reverter

---

## 2026-03-11 — Design Overhaul do Frontend

### O que foi feito

#### Design System (11 arquivos alterados)
1. Nova paleta de cores: cinza-puro → azul-midnight (#080B12, #0D1117, #161B22, #21262D)
2. Brand color: Tailwind blue generico → azul eletrico (#0066FF, #0047FF)
3. Nova cor accent teal/cyan (#00D4AA) para diferenciacao visual
4. 3 fontes Google Fonts: DM Sans (display), Plus Jakarta Sans (body), JetBrains Mono (dados)
5. 7 animacoes CSS: fade-in staggered, slide-in, scale-in, glow

#### Landing Page
1. Hero: mesh gradient + grid pattern + animacoes staggered de entrada
2. Botao CTA com glow animation continua
3. Code block com syntax highlighting real (keywords, strings, types, functions)
4. Cards de solucao com gradientes sutis individuais
5. Flow diagrams com linhas gradiente

#### Dashboard
1. Stat cards: icones contextuais + gradientes sutis + hover scale
2. Alertas: borda lateral colorida (vermelho/amarelo) + icones SVG
3. Cores dos graficos atualizadas para novo brand

#### Componentes
1. Sidebar: logo icon gradiente (escudo) + barra lateral azul no item ativo + backdrop blur
2. DecisionBadge: dot indicator colorido + pulse no PENDING
3. TrustBar: barra com gradiente + score colorido
4. LoadingSpinner: ring duplo + texto mono
5. ErrorBox: icone de alerta + borda left vermelha
6. EmptyState: icone SVG de inbox vazio
7. Toast (approvals): slide-in da direita (corrigido de animate-pulse)

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2) — rebuild OK
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Chrome CDP: porta 18800
- Telegram notifications: via TELEGRAM_BOT_TOKEN
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal
- Google Fonts: DM Sans, Plus Jakarta Sans, JetBrains Mono (CDN externo)

### Riscos / Atencao
- Google Fonts carrega via CDN — se CDN cair, fallback para system fonts
- Sandbox preservado em /root/sandbox/Payjarvis_design_20260311/ para rollback

---

## 2026-03-11 — Correcoes API + notificacoes + handoff browser-agent

### O que foi feito

#### API (apps/api)
1. Rebuild da API — dist tinha build antigo com bug Prisma (agentReputation.findUnique com botId ao inves de agentId)
2. Novas funcoes em notifications.ts: notifyTransactionApproved() e notifyTransactionBlocked()
3. Chamadas fire-and-forget em payments.ts apos decisao APPROVED e BLOCKED
4. notifyApprovalCreated (PENDING_HUMAN) ja existia — sem alteracao

#### Browser Agent (apps/browser-agent)
1. User-Agent override: Chrome headless → Chrome 131 Windows (evita bloqueio Amazon)
2. webdriver flag desabilitado via Page.addScriptToEvaluateOnNewDocument
3. Network.enable + Network.setUserAgentOverride antes de Page.navigate
4. Timeout de load aumentado: 10s → 15s
5. Extracao de produtos Amazon: multi-seletor ([data-asin], s-search-result, etc), polling ate 10s
6. Cada produto retorna: title, price, link, rating, reviews, image, asin
7. Deteccao de obstaculos (CAPTCHA, AUTH, NAVIGATION) via Runtime.evaluate apos load
8. Handoff automatico: quando obstaculo detectado, chama POST /bots/:botId/request-handoff na API
9. State do server salva botApiKey/botId do /connect para usar no handoff

### Estado atual
- payjarvis-api: ONLINE (pm2, porta 3001)
- payjarvis-rules: ONLINE (pm2, porta 3002)
- payjarvis-web: ONLINE (pm2)
- browser-agent: ONLINE (pm2, porta 3003, CDP 18800)

### Integracoes ativas
- Chrome CDP: porta 18800 (headless, container ou local)
- Telegram notifications: via TELEGRAM_BOT_TOKEN na API
- Redis: cache de approvals, handoffs, tokens BDIT
- Prisma/PostgreSQL: banco principal

### Riscos / Atencao
- Browser-agent perde conexao CDP no restart — precisa POST /connect novamente
- Amazon pode mudar seletores de produtos — monitorar se extracao quebrar
- Handoff depende de PAYJARVIS_API_URL apontar para localhost:3001 (sem /api prefix internamente)
- Notificacoes Telegram dependem de user.notificationChannel === "telegram" e user.telegramChatId preenchido

---

## 2026-03-13 — Mega Integração Retail + Pharmacy + Transit + Free APIs

### O que foi feito

#### Novos Services (apps/api/src/services/)
1. **retail/walmart-client.ts** — Walmart Open API (RSA auth, affiliate tracking)
2. **retail/target-client.ts** — Target Redsky API (sem chave, público)
3. **retail/publix-service.ts** — Publix via browser-agent (Layer 4)
4. **retail/macys-client.ts** — Macy's affiliate API
5. **retail/retail-service.ts** — Agregador: comparePrice, findStores, bestDeal (7 plataformas)
6. **pharmacy/cvs-client.ts** — CVS via browser-agent
7. **pharmacy/walgreens-client.ts** — Walgreens API
8. **transit/amtrak-client.ts** — Amtraker API gratuita + fallback browser-agent
9. **transit/flixbus-client.ts** — FlixBus transport.rest API gratuita
10. **transit/greyhound-client.ts** — Wrapper FlixBus para rotas Greyhound
11. **transit/transit-service.ts** — Agregador: searchAllTransit, compareTransitVsFlight

#### Novas Routes
12. **routes/retail.routes.ts** — 12 endpoints retail/pharmacy
13. **routes/transit.routes.ts** — 5 endpoints transit

#### Browser Agent Sites (apps/browser-agent/src/sites/)
14. 9 novos scrapers: cvs, walgreens, target, publix, macys, amtrak, angi, turo, wrench

#### APIs Gratuitas (sem chave)
15. **FlixBus**: 1.flixbus.transport.rest (stations, journeys, locations)
16. **Amtrak**: api.amtraker.com/v1 (trains, stations, status)
17. **Target**: redsky.target.com (search, stores, products)

#### Arquivos modificados
- server.ts (+2 route imports e registrations)
- .env.example (+12 novas env vars)

### Estado atual
- payjarvis-api: ONLINE, TypeScript build clean (0 errors)
- 17 endpoints novos (12 retail + 5 transit)
- 3 APIs gratuitas funcionando sem chave (FlixBus, Amtrak, Target)
- Todos smoke tests: success=True

### Pendente
- Visa TAP + MC AgentPay + TrustBadges (agent em execução)
- Chaves: Walmart (walmart.io), Walgreens (manual), CVS (invite), Macy's (partners)
- Affiliate IDs: Walmart Impact Radius, Target CJ Affiliate, Macy's CJ

---

## 2026-03-17 — Production Hardening

### Seguranca
- **UFW hardened**: Portas 3333, 3400, 9222, 6080, 8080 fechadas. Restam: 22 (SSH), 80 (HTTP), 443 (HTTPS), 8000 (Nucleo), Tailscale
- **PostgreSQL**: Confirmado bind 127.0.0.1 only
- **Redis**: Confirmado bind 127.0.0.1 only
- **Rate limiting**: Aplicado em todos endpoints do Nginx (API: 30r/s burst 20, General: 60r/s burst 30, Webhooks: 30r/s burst 10)
- **Security headers**: Completos em www.payjarvis.com (HSTS preload, X-Frame, X-Content-Type, XSS-Protection, Referrer-Policy, Permissions-Policy)
- **Admin headers**: Hardened com HSTS preload, rate limiting adicionado
- **SSL/TLS**: TLSv1.2+1.3, certificados validos 77+ dias, certbot auto-renew ativo
- **.env.production**: Protegido via .gitignore, nao commitado

### Performance
- **Gzip**: Ativo no Nginx (level 6, todos tipos relevantes)
- **Static assets**: Cache 1y immutable via Nginx direto (bypass Next.js)
- **Public assets**: Cache 7d
- **PM2 logrotate**: Ativo (10M max, 3 retained, compressed, daily rotation)

### Confiabilidade
- **PM2 startup**: Configurado (systemd pm2-root.service)
- **PM2 save**: Executado
- **Auto-restart**: Todos servicos com autorestart=true, max_restarts=10
- **Memory limits**: API 512M, Rules 256M, Web 512M, Browser 256M, KYC 1G, Admin 512M
- **Sentinel**: Monitorando 5 servicos (API, Web, Admin, OpenClaw, KYC) a cada 60s

### Dados
- **PostgreSQL backup**: Criado cron diario 02:00 UTC (/root/scripts/backup_postgres.sh)
- **Primeiro backup**: payjarvis_20260317_001643.sql.gz (148K)
- **Retencao**: 7 dias
- **DB size**: 12MB
- **Usuarios prod**: 5

### Issues pendentes (WARNING)
- CORS origin: true (aceita qualquer origem) — restringir para payjarvis.com domains
- Fastify logger: true em producao — considerar logger: { level: 'warn' }
- API Heap usage 96.51% — monitorar, pode precisar aumentar max_memory_restart
- payjarvis-kyc: 266k+ restarts historicos (sentinel checa GET / que retorna 404, nao e crash)
- DB password "payjarvis123" — trocar para senha forte
- /api/health retorna 404 via Nginx (rota e /health, nao /api/health)

### Integracoes ativas
- WhatsApp: +17547145921 (Twilio, webhook /webhook/whatsapp)
- Telegram: @Jarvis12Brain_bot (webhook /webhook/telegram)
- Stripe: ativo (webhook configurado)
- Clerk: proxy /__clerk/ configurado
- Sentinel: monitoramento 24/7 + Telegram alerts
- CFO Agent: relatorios automaticos
