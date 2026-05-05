# SESSION-NOTES — PayJarvis

> Atualizado automaticamente ao final de cada sessão ou tarefa significativa.
> A próxima sessão DEVE ler este arquivo antes de qualquer ação.

## Última Sessão

- **Data**: 2026-04-06 (sessão 2)
- **Objetivo**: Executar as 4 tarefas pendentes (voice, email, rawFacts, roteiro humanizado)
- **Status**: CONCLUÍDO — todas 4 tarefas completadas e deployadas

## O Que Foi Feito (2026-04-06 sessão 2)

### 1. Voice Calls — Migration recordingUrl (CORRIGIDO)
- Coluna `recordingUrl` existia no schema Prisma mas nunca foi migrada para o banco
- Criada migration `20260406_add_recording_url_voice_calls`
- Aplicada com `prisma migrate deploy` — coluna agora existe na tabela `voice_calls`
- Gravações de chamadas agora são salvas corretamente

### 2. Email Sending — await adicionado (CORRIGIDO)
- 4 chamadas `sendEmail()` em `notifications.ts` eram fire-and-forget (sem await)
- Erros eram silenciosos — emails falhavam e ninguém sabia
- Adicionado `await` nas linhas 200, 238, 277, 333
- Agora erros de email são capturados pelo .catch() de forma síncrona

### 3. rawFacts.find Bug — OpenClaw (CORRIGIDO)
- `gemini.js` e `grok-client.js` tinham null-safety fraca no rawFacts
- Se `userContext` fosse null/undefined, `userContext._raw` causava TypeError
- Fix: `(isStructured && Array.isArray(userContext._raw)) ? ... : Array.isArray(userContext) ? ... : []`
- Commit: openclaw master 8573208

### 4. Roteiro Humanizado — Dual-LLM Voice (IMPLEMENTADO)
- **Arquitetura**: Grok (conversa/empatia) + Gemini/API (execução de tools)
- **Fluxo**: User fala → Grok responde → se `[TOOL:...]` detectado → API executa → Grok humaniza resultado
- **Tools disponíveis em chamadas**: search_products, search_flights, search_hotels, search_restaurants, track_package, search_events
- **Funções adicionadas** em `twilio-voice.service.ts`:
  - `parseToolIntent()` — extrai markers [TOOL:nome|param=valor]
  - `executeVoiceTool()` — chama API interna (localhost:3001)
  - `humanizeToolResult()` — Grok reescreve resultado para tom natural de telefone
- Prompt do live call atualizado com instruções de tool markers
- **Latência**: filler audio toca enquanto tool executa (sistema já existente)

### Deploy
- Build: turbo build API — OK (0 erros TypeScript)
- PM2 restart: payjarvis-api + openclaw — OK
- Smoke test: **16/16 passed**, 0 failed, 2 warnings non-critical
- Commits: PayJarvis 4f8d10b, OpenClaw 8573208

## Pendências — PRÓXIMA SESSÃO

_(4 tarefas anteriores CONCLUÍDAS nesta sessão — ver "O Que Foi Feito" acima)_

## Pendências — Rebranding (menor prioridade)

- [ ] WhatsApp Business profile display name → "Sniffer" (manual no Twilio Console)
- [ ] Aguardar aprovação dos 2 Twilio templates (sniffer_welcome, sniffer_referral)
- [ ] Deletar templates antigos do Twilio após aprovação dos novos

## Estado dos Serviços
- payjarvis-api: online (port 3001)
- payjarvis-web: online (port 3000)
- openclaw: online (Telegram bot)
- browser-agent: online (port 3003)
- Todos PM2 processes: healthy

## Sandboxes
- `/root/sandbox/Payjarvis_20260404/` — backup pré-deploy desta sessão
- `/root/sandbox/Payjarvis_20260402/` — backup do rebranding anterior

## O Que Foi Feito (2026-04-06)

### Trail of Bits Security Skills Instalados
- Marketplace registrado: `trailofbits-skills` em `~/.claude/plugins/`
- 5 plugins instalados e habilitados:
  - **gh-cli** v1.4.0 — intercepta GitHub URLs → `gh` CLI autenticado
  - **insecure-defaults** v1.0.0 — detecta secrets hardcoded, configs fail-open
  - **differential-review** v1.0.0 — security code review com blast radius
  - **supply-chain-risk-auditor** v1.0.0 — audita dependências npm
  - **sharp-edges** v1.0.0 — detecta API footguns
- 33 plugins ignorados (blockchain, binary, macOS, Python-specific, etc.)
- Smoke test pós-instalação: 16/16 passed, 0 failed
- **NOTA**: Reiniciar sessão Claude Code para ativar hooks do gh-cli

## Sandboxes
- `/root/sandbox/Payjarvis_20260406/` — backup pré-deploy desta sessão (sessão 2)
- `/root/sandbox/Payjarvis_20260404/` — backup anterior
- `/root/sandbox/Payjarvis_20260402/` — backup do rebranding

## Contexto Para Próxima Sessão
- **4 tarefas completadas**: voice recordingUrl, email await, rawFacts null-safety, dual-LLM voice
- **Dual-LLM voice**: testável via chamada live — Grok detecta [TOOL:...] e executa via API interna
- Trail of Bits skills ativados — security review automático disponível
- Rebranding B2C ~99% completo (pendências menores: WhatsApp profile name, templates Twilio)
- Todos serviços PM2 healthy, smoke test 16/16 passando

## Sessão 2026-05-05 — Auditoria Stripe (READ-ONLY)
- **Auditoria Stripe concluída em 2026-05-05** — ver `.planning/STRIPE-AUDIT-2026-05-05.md`
- Achados críticos:
  - Conta Stripe pertence a `IMMIGRATION IA INC` (acct_1SUAyaPqILx9X6ls), não à entidade legal de PayJarvis
  - Stripe **Issuing NÃO ativada** (TOS pendente, capability ausente) → demo VPC bloqueado
  - `STRIPE_WEBHOOK_SECRET` **vazio** em sniffer/apps/api e sniffer/apps/brain
  - Sniffer `verifyWebhookSignature()` é fail-open (retorna `true` sempre)
  - Mesma `sk_live` reutilizada em 4 .env files; `.env.bak.2026-04-29-brfix` contém secret em texto plano
  - Discrepância BR/USD em `STRIPE_PRICE_ID_MONTHLY` entre `.env` e `.env.production`
  - BDIT e Stripe não se comunicam (BDIT só declara `aud: ['stripe']` como metadata)
- **Próxima tarefa pendente**: definida pelo Jose após review do veredito.

## Sessão 2026-05-05 — Hotfix Stripe-bleed
- **Branch**: `hotfix/stripe-bleed` em `/root/Payjarvis` (parent: `fix/audit-website-improvements`) e em `/root/projetos/sniffer` (parent: `main`). NÃO mergeado.
- **Fix 1 — Sniffer webhook signature (fail-closed)**:
  - `sniffer/apps/api/src/services/stripe.js` — `verifyWebhookSignature` agora async, throw se secret/signature/rawBody ausentes, chama `stripe.webhooks.constructEvent` real.
  - `sniffer/apps/api/src/routes/webhooks.js` — rota `/webhooks/payment/stripe` encapsulada em sub-plugin Fastify com buffer parser; try/catch retorna 400 em assinatura inválida.
- **Fix 2 — env hardening**:
  - `Payjarvis/.env.bak.2026-04-29-brfix` movido para `/root/secure-archive/` (chmod 600). Diff vs `.env` ativo: 1 linha apenas (`TWILIO_WHATSAPP_NUMBER_BR` ausente no bak).
  - `.gitignore` reforçado em PayJarvis e sniffer (regras `.env.bak*`, `.env.backup*`, variantes `**/`).
  - `chmod 600` em todos os `.env*` ativos de PayJarvis e sniffer.
  - **Não tocados** (CLAUDE.md Regra 3, fora deste projeto): `controler/.env.bak-20260420173311` (contém `sk_live`!) e `luna/cinematic/.env.bak.1777163171` (sem hits Stripe). Reportados ao Jose.
- **Fix 3 — git history audit**:
  - PayJarvis: 7 commits com hits `sk_live`/`whsec_`, **todos benignos** (placeholders, validação, geração runtime). Nenhum `.env` (live) foi adicionado ao histórico.
  - Sniffer: limpo. Zero hits.
  - **Rotação Stripe NÃO obrigatória** com base no histórico git. Decisão de rotacionar fica com Jose (riscos remanescentes: backups de VPS de terceiros, reuso da key em 4 .env, troca de entidade legal).
- **NÃO mergear** sem review do Jose.
