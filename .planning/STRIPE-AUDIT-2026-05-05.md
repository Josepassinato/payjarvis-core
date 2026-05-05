# Stripe Audit — 5 maio 2026

> Auditoria READ-ONLY. Nenhum arquivo de código ou .env foi modificado.
> Chaves mascaradas como `prefixo...últimos4`.

## 1. .env.production (e arquivos correlatos)

### PayJarvis — `/root/Payjarvis/.env`
| Variável | Status | Modo |
|---|---|---|
| `STRIPE_SECRET_KEY` | SET | `sk_live_...JWvO` |
| `STRIPE_WEBHOOK_SECRET` | SET | `whsec_...rrX2` |
| `STRIPE_PRODUCT_ID` | SET | `prod_...kKM1E` |
| `STRIPE_PRICE_ID_MONTHLY` | SET | `price_...EtAw` |
| `STRIPE_PRICE_ID_MONTHLY_USD` | SET | `price_...4mOc` |
| `STRIPE_PORTAL_CONFIG_ID` | SET | `bpc_...G9KM` |

### PayJarvis — `/root/Payjarvis/.env.production`
| Variável | Status | Modo |
|---|---|---|
| `STRIPE_SECRET_KEY` | SET | `sk_live_...JWvO` |
| `STRIPE_WEBHOOK_SECRET` | SET | `whsec_...rrX2` |
| `STRIPE_PRODUCT_ID` | COMENTADO | `prod_...kKM1E` (linha começa com `#`) |
| `STRIPE_PRICE_ID_MONTHLY` | SET | `price_...4mOc` ⚠️ aponta para o ID que em `.env` é "USD"; pode haver inversão BR/USD |
| `STRIPE_PORTAL_CONFIG_ID` | SET | `bpc_...G9KM` |

### PayJarvis — `apps/web/.env.production`
| Variável | Status | Modo |
|---|---|---|
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | SET | `pk_live_...Snmb` |

### PayJarvis — `apps/web/.env.local` e `apps/api/.env.production`
- Nenhuma `STRIPE_*` definida (fallback à raiz).

### PayJarvis — `.env.example`
- Todas as três variáveis (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) estão como PLACEHOLDER (`""`).

### Backup `/root/Payjarvis/.env.bak.2026-04-29-brfix`
- Contém **sk_live** e **whsec** em texto plano. Mesmas chaves de produção. ⚠️ risco se versionado.

### SnifferShop / Sniffer — `/root/projetos/sniffer/apps/api/.env`
| Variável | Status | Modo |
|---|---|---|
| `STRIPE_SECRET_KEY` | SET | `sk_live_...JWvO` (mesma chave do PayJarvis) |
| `STRIPE_PUBLISHABLE_KEY` | SET | `pk_live_...Snmb` |
| `STRIPE_WEBHOOK_SECRET` | **EMPTY** | — (linha existe vazia) |

### Sniffer — `/root/projetos/sniffer/apps/brain/.env`
| Variável | Status | Modo |
|---|---|---|
| `STRIPE_SECRET_KEY` | SET | `sk_live_...JWvO` |
| `STRIPE_PUBLISHABLE_KEY` | SET | `pk_live_...Snmb` |
| `STRIPE_WEBHOOK_SECRET` | **EMPTY** | — |

### Sniffer landing (`/root/projetos/sniffer/apps/landing/`) e `/root/projetos/sniffershop/`
- Nenhum `.env` próprio. `sniffershop` standalone (3010) só serve HTML + proxy waitlist.

---

## 2. Setup Intent

- **Status geral**: COMPLETO no PayJarvis (backend + frontend + webhook). PARCIAL no Sniffer (backend completo, sem verificação real de webhook).
- **Endpoints PayJarvis** (Fastify, todos com Clerk JWT salvo onde indicado):
  - `POST /api/payment-methods/setup-intent` — `apps/api/src/routes/payment-methods.ts:90`
  - `POST /api/payment-methods/setup-intent/confirm` — `apps/api/src/routes/payment-methods.ts:136`
  - `POST /api/shopping-config/setup-intent` — `apps/api/src/routes/shopping-config.ts:142`
  - `POST /api/shopping-config/confirm-card` — `apps/api/src/routes/shopping-config.ts:196`
  - `POST /api/wallet/setup-card` — `apps/api/src/routes/skyfire.ts:67`
  - Provider central: `StripeProvider.createSetupIntent` em `apps/api/src/services/payments/providers/stripe.provider.ts:69`
  - Onboarding: `onboarding-bot.service.ts:1362` cria SetupIntent + gera link `/setup-payment?intent=...`
- **Endpoints Sniffer**:
  - `POST /billing/setup-intent` — `apps/api/src/routes/billing.js:28`
  - `POST /billing/payment-methods` (confirm) — `billing.js:55`
  - `GET/DELETE /billing/payment-methods[/:id]` — `billing.js:110/121`
  - Service: `apps/api/src/services/stripe.js` (mocka tudo se `STRIPE_SECRET_KEY` ausente).
- **Frontend "Connect Card" / "Adicionar cartão"**:
  - `apps/web/src/app/(dashboard)/payment-methods/page.tsx` (botão `paymentMethods.addCard`)
  - `apps/web/src/app/(dashboard)/wallet/setup/page.tsx` ("Adicionar cartao de pagamento")
  - `apps/web/src/app/onboarding/step/2/page.tsx` (Stripe Elements + `confirmCardSetup`)
  - `apps/web/src/app/(dashboard)/setup-shopping/page.tsx`
  - `apps/web/src/app/setup-payment/page.tsx` (deep link a partir do Telegram)
- **Gap**: No PayJarvis o fluxo está fechado (intent → confirmCardSetup → /confirm → `PaymentMethod` no DB + audit). No Sniffer o webhook handler **não verifica assinatura HMAC** (`verifyWebhookSignature` retorna `true` sem usar `constructEvent`) — qualquer POST forjado é aceito.

---

## 3. Stripe Issuing

- **Capability na conta**: **NÃO ATIVA**.
  - Conta `acct_1SUAyaPqILx9X6ls`, tipo `standard`.
  - `capabilities` retornadas pela API: `card_payments`, `link_payments`, `acss_debit`, `afterpay_clearpay`, `amazon_pay`, `bancontact`, `cashapp`, `crypto`, `eps`, `klarna`, `pix`, `transfers`, `us_bank_account_ach`, `cartes_bancaires=pending`. **`card_issuing` ausente.**
  - `settings.card_issuing.tos_acceptance` = `{ date: null, ip: null }` — TOS de Issuing nunca aceito.
- ⚠️ **Conta pertence a `IMMIGRATION IA INC`** (dashboard "Afiliados saas", URL `immigration.sonofari.com`, MCC 5734, BR/FL endereço de suporte). Não é a "Increase Trainer Inc EIN 87-1490358" mencionada no CLAUDE.md como entidade legal de PayJarvis/Visa-Mastercard.
- **Referências em código** (Issuing):
  - `/root/projetos/sniffer/apps/api/src/services/stripe.js:34` — `createVirtualCard()` usa `stripe.issuing.cards.create({ type: 'virtual', spending_controls: ... })`. Cai em mock (`number: 4242…`) se `STRIPE_SECRET_KEY` ausente. Hoje, com a key presente mas capability inativa, retorna erro real.
  - Nenhum hit de `issuing` / `cardholder` / `virtual.card` no PayJarvis (apps/api ou packages). Os hits de `cardholder` são do Mastercard MDES (FPAN/DPAN), não Stripe Issuing.

---

## 4. Webhooks

### PayJarvis
- **Endpoint**: `POST /api/webhooks/stripe` — `apps/api/src/routes/stripe-webhook.ts:37` (registrado em `server.ts:65`).
- Verifica assinatura via `stripe.webhooks.constructEvent(rawBuffer, sig, STRIPE_WEBHOOK_SECRET)` — OK.
- **Eventos tratados**:
  - `setup_intent.succeeded` → finaliza onboarding + grava `PaymentMethod` + envia mensagem Telegram
  - `invoice.paid` → `handleInvoicePaid()` + grava `CostEntry` (taxa Stripe 2.9% + $0.30)
  - `invoice.payment_failed` → `handleInvoicePaymentFailed()`
  - `customer.subscription.deleted` → `handleSubscriptionDeleted()`
  - `customer.subscription.updated` → `handleSubscriptionUpdated()`
  - default → log "Unhandled".
- ⚠️ Path de webhook é `/api/webhooks/stripe`, mas o CLAUDE.md / docs mencionam `/webhook/stripe` em alguns pontos — confirmar que o endpoint configurado no Stripe Dashboard bate com `/api/webhooks/stripe`.

### Sniffer
- **Endpoint**: `POST /webhooks/payment/stripe` — `apps/api/src/routes/webhooks.js:41`.
- `verifyWebhookSignature()` em `services/stripe.js:72` **retorna `true` sempre** (comentário "Real verification would use stripe.webhooks.constructEvent"). Sem secret configurado também não falha.
- Apenas emite evento interno (`webhook.stripe.<type>`) — nenhuma lógica de subscrição/issuing implementada.

---

## 5. BDIT ↔ Stripe

- **Tem ponte de execução**: NÃO.
- Detalhe: `packages/bdit/src/generate.ts:54` apenas declara o JWT como `aud: ['merchants', 'stripe', 'visa_tap']` — é metadata de claim, não invoca Stripe API. BDIT é identidade/governance (RS256 / JWKS); Stripe é provider de pagamento separado (`StripeProvider` em `services/payments/providers/stripe.provider.ts`). Não há código que valide BDIT antes de criar PaymentIntent, nem que injete BDIT como header em chamadas Stripe. Os dois domínios não se cruzam hoje.

---

## 6. SnifferShop

- **Path**:
  - Código fonte ativo: `/root/projetos/sniffer/` (monorepo: `apps/api`, `apps/brain`, `apps/landing`, `apps/web`, `packages/db`, `packages/shared`).
  - Landing pública (PM2 `sniffershop`, 3010): `/root/projetos/sniffer/apps/landing/server.js`.
  - **`/root/projetos/sniffershop/` é resíduo** (HTML + server proxy duplicado, não usado por nenhum processo PM2). Pode ser arquivado.
  - Dashboard de métricas dentro do PayJarvis admin: `apps/admin/app/(dashboard)/sniffershop/page.tsx` — só consome `api` interna; não chama Stripe.
- **Backend**: **separado** do PayJarvis.
  - Processos PM2: `sniffer-api` (3021), `sniffer-brain`, `sniffer-web`, `sniffershop` (landing 3010).
  - Stack: Fastify + JS puro + Prisma próprio (`packages/db`).
  - Endpoints próprios: `auth`, `intents`, `tasks`, `approvals`, `orders`, `billing`, `webhooks`, `events`, `search`, `reorder`, `status`. Nenhuma chamada cross para PayJarvis API.
- **Cobrança B2C implementada**: SIM (parcial / "scaffolding com graceful degradation").
  - Fluxo SetupIntent off_session (`/billing/setup-intent` + `/billing/payment-methods`) — funcional com a key live.
  - **VPC (Virtual Payment Card) via Stripe Issuing — bloqueado**: `services/stripe.js:34` chama `issuing.cards.create`, mas a capability não está ativa na conta → cairá em erro real ou no mock 4242.
  - Webhook sem verificação de assinatura (ver §4).
  - Nenhuma rota de subscription/recurring no Sniffer (R$30/mês mencionado no roadmap **não tem implementação aqui** — vive no PayJarvis via `/api/subscription/*`).

---

## VEREDITO

### Para cobrar pilot B2B hoje, falta:
1. **Definir CNPJ/EIN da conta Stripe**: a conta atual (`IMMIGRATION IA INC`) não bate com a entidade legal "Increase Trainer Inc EIN 87-1490358" do CLAUDE.md, nem com PayJarvis Solutions. Receita em conta de outra empresa = problema fiscal/contábil. Decidir: migrar para conta nova ou formalizar uso compartilhado.
2. **Resolver o conflito BR/USD em `STRIPE_PRICE_ID_MONTHLY`**: `.env` tem dois IDs distintos (BR `...EtAw`, USD `...4mOc`), `.env.production` aponta o de USD como "MONTHLY" sem o sufixo `_USD`. Risco de cobrar valor errado em quem assinar pelo dashboard.
3. **Confirmar URL do webhook no Stripe Dashboard** = `/api/webhooks/stripe` (não `/webhook/stripe` como aparece em docs antigos).
4. **Smoke test real**: criar customer → SetupIntent → confirm → invoice. Não há prova nos logs de que o fluxo end-to-end roda em produção desde o rebranding.

### Para demo "agente compra com firewall" (VPC), falta:
1. **Ativar Stripe Issuing**: aceitar TOS (`tos_acceptance` zerado) + obter aprovação Stripe (US Issuing requer underwriting, não é self-serve). **Bloqueador absoluto.**
2. **Decidir entidade que vai operar Issuing**: idem item 1 acima — Issuing é US-only e exige business profile coerente com o pitch.
3. **Implementar caminho real no `createVirtualCard`** (hoje é scaffolding); plugar com `intents`/`approvals` do Sniffer e com o fluxo BDIT do PayJarvis (que hoje não conhece Stripe).
4. **Webhook hardening**: implementar `constructEvent` real em `sniffer/apps/api/src/services/stripe.js:72` antes de aceitar qualquer evento de `issuing.authorization.*`.

### Bloqueios fortes:
- **Stripe Issuing não ativada** + TOS pendente → demo de cartão virtual impossível na conta atual.
- **Conta Stripe = IMMIGRATION IA INC**, não a entidade que aparece nos materiais de PayJarvis. Tudo que for cobrado cai contabilmente nessa empresa.
- **`STRIPE_WEBHOOK_SECRET` vazio** em `sniffer/apps/api` e `sniffer/apps/brain` → mesmo se ativarem assinatura, a verificação cai em "skip".

### Riscos descobertos:
- **`sk_live` reusada em 4 lugares**: `Payjarvis/.env`, `Payjarvis/.env.production`, `sniffer/apps/api/.env`, `sniffer/apps/brain/.env`. Comprometeu uma → comprometeu todas. Sem rotação fácil.
- **`Payjarvis/.env.bak.2026-04-29-brfix`** com `sk_live` e `whsec` em texto plano dentro do diretório do projeto. Verificar se está em `.gitignore` e se nunca foi commitado.
- **Sniffer webhook fail-open**: `verifyWebhookSignature` retorna `true` sem secret. Qualquer POST público em `/webhooks/payment/stripe` é aceito (atrás do firewall, mas mesmo assim).
- **Discrepância BR vs USD em pricing**: detalhado no veredito B2B.
- **`/root/projetos/sniffershop/` órfão**: confunde a leitura do projeto e tem reference a "cartão virtual Stripe" no HTML que pode dar a impressão de feature pronta. Sugerir arquivar.
- **BDIT não conversa com Stripe**: o pitch "firewall agentic" depende de BDIT autorizar criação de VPC; não existe esse fio hoje.
- **Mesma `pk_live` no `apps/web/.env.production` e em `sniffer/apps/api/.env`**: aceitável (publishable é pública), mas indica que web do PayJarvis e Sniffer compartilham conta — usuário B2B do PayJarvis verá no extrato Stripe a mesma conta usada para B2C do Sniffer.

---

## HOTFIXES APLICADOS — 2026-05-05

> Branch: `hotfix/stripe-bleed` em ambos os repos (PayJarvis e `/root/projetos/sniffer`).
> NÃO mergeado em main — aguarda review do Jose.

### Fix 1 — Webhook signature (Sniffer)
- **Arquivos modificados**:
  - `/root/projetos/sniffer/apps/api/src/services/stripe.js` (função `verifyWebhookSignature`)
  - `/root/projetos/sniffer/apps/api/src/routes/webhooks.js` (rota `POST /webhooks/payment/stripe`)
- **Antes**: `verifyWebhookSignature(rawBody, signature)` retornava `true` incondicionalmente. Sem `STRIPE_WEBHOOK_SECRET` apenas logava warn e seguia. Comentário literal: "Real verification would use stripe.webhooks.constructEvent". Resultado: qualquer POST com qualquer corpo era aceito como evento Stripe legítimo.
- **Depois**:
  - `verifyWebhookSignature` agora é **async** e:
    - `throw` se `STRIPE_WEBHOOK_SECRET` ausente (fail-closed).
    - `throw` se header `stripe-signature` ausente.
    - `throw` se `rawBody` não for `Buffer`/`string`.
    - Chama `client.webhooks.constructEvent(rawBody, signature, secret)` — propaga `Stripe.errors.StripeSignatureVerificationError` em assinatura inválida.
    - Retorna o `Stripe.Event` parseado.
  - A rota `/webhooks/payment/stripe` foi encapsulada em sub-plugin Fastify que **substitui o JSON parser por buffer parser** apenas para essa rota (`parseAs: 'buffer'`). As outras rotas (`/webhooks/merchant/:merchant`, `/webhooks/email`) continuam recebendo JSON parseado normalmente.
  - Handler agora envolve em `try/catch` e responde 400 `{ error: "invalid_signature", detail }` em qualquer falha de verificação. Apenas eventos verificados disparam `emitEvent`.
- **Brain (`sniffer/apps/brain`)**: nenhuma rota Stripe. Não exigiu alteração.

### Fix 2 — `.env.bak` removidos / hardening
- **Arquivos movidos para `/root/secure-archive/`** (chmod 700 no diretório, 600 nos arquivos):
  - `/root/Payjarvis/.env.bak.2026-04-29-brfix` → `/root/secure-archive/payjarvis.env.bak.2026-04-29-brfix`
    - Pré-checagem: `diff` vs `.env` ativo mostrou só 1 linha de diferença (`TWILIO_WHATSAPP_NUMBER_BR` presente apenas em `.env`). Nenhum valor único de Stripe perdido.
- **Backups encontrados em outros projetos (FORA DE ESCOPO desta sessão)** — **NÃO TOCADOS** por isolamento (CLAUDE.md Regra 3):
  - `/root/projetos/controler/.env.bak-20260420173311` — contém 1 hit de `sk_live`/`whsec_`. Recomendação para Jose: rodar este mesmo procedimento no projeto Controler.
  - `/root/projetos/luna/cinematic/.env.bak.1777163171` — sem hits Stripe. Provavelmente seguro mas vale arquivar pelo mesmo princípio.
- **`.gitignore` atualizado**:
  - `/root/Payjarvis/.gitignore` — adicionadas regras `.env.bak*`, `.env.backup*`, `**/.env.bak*`, `**/.env.backup*` (já tinha cobertura de `.env`, `.env.production` etc).
  - `/root/projetos/sniffer/.gitignore` — endurecido de 2 para 14 regras de env (era apenas `.env` e `.env.local`; agora cobre `.env.production`, `.env.development`, `.env.*.local`, `.env.bak*`, `.env.backup*`, todas com variantes `**/`, e exceção `!.env.example`).
- **`chmod 600` aplicado nos `.env*` ativos** (não-`.env.example`):
  - PayJarvis: `.env`, `.env.production`, `.env.production.bak.20260318_205919`, `apps/api/.env.production`, `apps/web/.env.production`, `apps/web/.env.local`, e os duplicados em `Payjarvis/Payjarvis/...` (subdir órfã, vide nota abaixo).
  - Sniffer: `apps/api/.env` (e `apps/brain/.env`, que é symlink para o mesmo arquivo).
- **Nota colateral**: existe `/root/Payjarvis/Payjarvis/` — subdiretório duplicado com `.env`, `.env.production`, `.env.production.bak.*` próprios. Aplicado `chmod 600` por segurança, mas o diretório parece resíduo de cópia antiga (não referenciado por PM2). Recomenda limpeza separada.

### Fix 3 — Git history audit
**Critério**: `git log --all -S "sk_live"`, `-S "whsec_"`, `-S "rk_live"` em ambos os repos.

**PayJarvis** — 7 commits trouxeram esses tokens, **todos benignos**:
| Commit | Descrição | Conteúdo do hit |
|---|---|---|
| `23e5fcd` (Mar 13) | "feat: 4-layer architecture..." | Texto em `HISTORICO.md` ("Stripe: sk_live_ configurada") + validação `Must start with sk_test_ or sk_live_` em código + i18n placeholders `keyPlaceholder: "sk_live_..."` |
| `7e17bf6` (Mar 10) | "feat: dashboard improvements, i18n, payment methods" | Mesma string de validação + placeholders i18n em `apps/api/src/routes/payment-methods.ts` |
| `232891b` | "feat(web): redesign landing..." | Placeholder `webhookSecret: 'whsec_xxxx'` em landing page |
| `9456da1` | "chore: open source prep — sanitize credentials" | **REMOÇÃO** de placeholder `whsec_...` de `.env.example` |
| `44b8ab9` | "feat: agent identity, trust score, PayPal..." | Código gerador: `whsec_${crypto.randomBytes(24).toString("hex")}` |
| `b7c7325` | "feat: initial release - PayJarvis v1.0.0" | `STRIPE_WEBHOOK_SECRET="whsec_..."` em `.env.example` |
| `aa4614f` | "feat: PayJarvis MVP monorepo" | Mesmo placeholder em `.env.example` |

Arquivos `.env` (não-`.env.example`) **nunca foram adicionados** ao histórico (`git log --all --diff-filter=A --name-only` mostra apenas `.env.example` e `packages/agent-sdk/.env.example`).

**Sniffer (`/root/projetos/sniffer`)** — **nenhum hit** em `sk_live`, `whsec_` ou `rk_live`. Histórico só tem `.env.example`.

**sk_live em commits**: nenhum (todos hits são placeholders, mensagens de erro, geração runtime, ou strings de notas).
**whsec_ em commits**: nenhum (todos hits são placeholders ou geração runtime).

**Recomendação**: **Rotação NÃO obrigatória** com base no histórico Git. As chaves `sk_live_...JWvO` e `whsec_...rrX2` nunca passaram pelo `git`. Continuam expostas apenas via filesystem (e via o backup que acabou de ser arquivado). Riscos remanescentes que sustentam *alguma* chance de rotação preventiva:
1. O `.env.bak.2026-04-29-brfix` ficou em `/root/Payjarvis/` por dias — se houver snapshot/backup de VPS de terceiros, vazou ali.
2. Conta pertence a `IMMIGRATION IA INC` — se a entidade legal mudar (recomendado no veredito), key precisará ser rotacionada de qualquer jeito.
3. Mesma chave reusada em 4 .env (PayJarvis + Sniffer); se um deploy/host for comprometido, todos caem.

Decisão de rotacionar e/ou rodar `git filter-repo` fica com o Jose. Nenhuma reescrita de história foi feita.
