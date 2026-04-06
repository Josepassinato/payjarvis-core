# AUDITORIA DE INTELIGENCIA — PayJarvis/Sniffer
**Data:** 2026-04-05 (v2 — auditoria completa)
**Auditor:** Claude Code (Opus 4.6)
**Escopo:** Camada completa de inteligencia, memoria, aprendizado e personalizacao

---

## SCORE GERAL

| Dimensao | Score | Detalhe |
|----------|-------|---------|
| Memoria do Usuario | 7/10 | Profile Vault + Facts forte; sem versionamento |
| Aprendizado Continuo | 6/10 | Premium 8-layer pipeline excelente; free tier nao aprende |
| Personalizacao | 8/10 | Idioma, tom, briefing, gamificacao — tudo personalizado |
| Qualidade de Resposta | 7/10 | 59 tools, fallback robusto, mas intent regex-based |
| Proatividade | 7/10 | Briefing + price alerts + reengagement; falta recomendacao proativa |
| Dados Reais de Uso | 3/10 | 9 usuarios, 0 compras concluidas, browser-agent offline |
| **INTELIGENCIA GERAL** | **6.5/10** | **Arquitetura sofisticada, mas sem trafego real pra validar** |

---

## FASE 1: SISTEMA DE MEMORIA DO USUARIO

### 1.1 Profile Vault

**Status: IMPLEMENTADO**

| Componente | Status | Arquivo |
|-----------|--------|---------|
| AES-256-GCM encrypt/decrypt | OK | `apps/api/src/services/payments/vault.ts:1-38` |
| User Account Vault (cookies) | OK | `schema.prisma:606-622` (UserAccountVault) |
| Zero-Knowledge PIN Vault | OK | `schema.prisma:1132-1160` (UserZkVault + SecureItem) |
| User Facts (preferencias) | OK | `openclaw_user_facts` — 181 facts no banco |
| Categorias de contexto | OK | `openclaw/memory.js:147-195` — 8 categorias |

**Categorias de facts armazenados:**
- `location` — zip, city, state, address
- `commerce` — shirt_size, pants_size, shoe_size, preferred_store
- `travel` — seat_preference, airline, loyalty, passport, travel_class
- `food` — diet, dietary_restrictions, cuisine, allergies
- `health` — medication, blood_type, doctor, insurance
- `finance` — budget, currency, bank
- `personal` — name, email, phone, birthday, language, timezone
- `preferences` — key-value consolidado

**Perfis reais consultados:**

| Usuario | Interactions | Detalhe |
|---------|-------------|---------|
| Jose | 67 | 2 price alerts ativos (Ray-Ban Meta $249, Armaf $11.25) |
| Adrianne | 22 | trial tier |
| Matt | 2 | premium, baixo engajamento |

**Gaps:**
- NAO existe modelo "UserProfile" unificado — preferencias dispersas entre User, openclaw_user_facts, agent_user_profiles
- Sem versionamento de preferencias (nao da pra ver "antes preferia X, agora Y")
- Free tier: facts armazenados mas NAO aprendidos automaticamente

### 1.2 Historico de Conversas

**Status: IMPLEMENTADO (basico)**

| Metrica | Valor |
|---------|-------|
| Total conversas | **856 mensagens** |
| Ultimos 7 dias | **156 mensagens** |
| Janela de contexto | 50 mensagens (ultimas) |

- Armazenado em `openclaw_conversations` (PostgreSQL)
- `getHistory(userId, limit=50)` em `openclaw/memory.js:18-49`
- NAO existe sumarizacao de conversas antigas
- NAO existe isolamento por sessao
- NAO existe metadata (topico, outcome, satisfacao)

### 1.3 Historico de Compras

**Status: SCHEMA EXISTE, ZERO DADOS**

| Metrica | Valor |
|---------|-------|
| purchase_history | **0 registros** |
| purchase_transactions | **0 registros** |
| amazon_orders | **9 tentativas** (4 FAILED, 5 ABANDONED) |
| Compras concluidas | **ZERO** |

- Smart reorder implementado (`openclaw/smart-reorder.js`) — detecta padroes recorrentes
- Todas as 9 tentativas Amazon falharam (browser-agent CDP desconectado)
- NAO existe tracking de satisfacao pos-compra
- NAO existe inferencia de preferencias a partir de compras

---

## FASE 2: APRENDIZADO CONTINUO

### 2.1 Preference Learning

**Status: PREMIUM = EXCELENTE | FREE = INEXISTENTE**

**Pipeline Premium (8 camadas) em `openclaw/premium-pipeline.js`:**

| Layer | Arquivo | Funcao |
|-------|---------|--------|
| 1 | adaptive-memory.js | `logEvent()` — armazena eventos com confidence |
| 2 | behavioral-signals.js | `classifyUserResponse()` — detecta aceitacao/rejeicao |
| 3 | memory.js | `getUserContext()` — monta facts do banco |
| 4 | user-model.js | `buildProfileBlock()` — sintetiza perfil pro LLM |
| 5 | anticipation.js | `anticipate()` — prediz proximos passos |
| 6 | initiative.js | `shouldIntervene()` — decide proatividade |
| 7 | gemini.js | LLM call com todo contexto + tools |
| 8 | (async) | `extractFacts()` + `reflect()` + `applyForgettingPolicy()` |

**Sinais comportamentais (behavioral-signals.js:54-152):**
- `suggestion_accepted` / `suggestion_rejected` / `suggestion_ignored`
- `tone_correction` / `format_correction`
- `logic_challenge_accepted` / `repeated_request`

**5 padroes detectados (behavioral-signals.js:54-111):**
1. `prefers_direct_and_dense` — 3+ correcoes de formato em 60 dias
2. `prefers_single_best_recommendation` — <40% sugestoes aceitas
3. `high_challenge_tolerance` — aceita desafios logicos
4. `low_interruption_tolerance` — 3+ sugestoes ignoradas em 30 dias
5. `agent_missing_patterns` — pedidos repetidos

**Forgetting Policy (adaptive-memory.js:116-149):**
- Facts low-confidence (conf <0.45, freq=1, >30d) → "stale"
- Facts nao confirmados em 180d + implicitos + conf <0.7 → "stale"
- Stale >30d → "archived"

**Annoyance Score (behavioral-signals.js:115-137):**
- Janela de 2h, cap 1.0
- suggestion_ignored +0.15, suggestion_rejected +0.25, tone_correction +0.3
- Score alto → suprime proatividade

**Gap critico:** Free tier (6 de 9 usuarios) NAO tem NENHUM dos 8 layers. Facts sao gravados e lidos, mas sem aprendizado, sem decay, sem behavioral signals.

### 2.2 Feedback Loop

| Feature | Status | Tier |
|---------|--------|------|
| Detecta rejeicoes ("nao", "caro") | SIM | Premium |
| Annoyance score suprime proatividade | SIM | Premium |
| Diferencia "nao quero ESTE" vs "nao quero ESTE TIPO" | NAO | — |
| Sentiment analysis (mood/emocao) | NAO | — |

### 2.3 Behavior Tracking

| Feature | Status |
|---------|--------|
| Horarios de interacao | Registrado via `lastInteraction` no gamification |
| Morning Briefing personalizado | SIM — 5 secoes, baseado em facts |
| Analise de padroes de compra | SIM (smart-reorder) mas sem dados reais |
| Frequencia de uso | SIM via gamification (streak, total_interactions) |

---

## FASE 3: PERSONALIZACAO DA COMUNICACAO

### 3.1 Tom e Estilo

**Status: IMPLEMENTADO**

- **Persona "Sniffer 🐕"** — tom casual brasileiro ("to", "vou", "beleza")
- Deteccao automatica de idioma (PT-BR, EN, ES) em `proactive-messages.service.ts:352-357`
- Meta Ray-Ban Glasses: respostas ultra-curtas (max 2 linhas)
- `[FORMAT:TEXT]` para dados/links, `[FORMAT:AUDIO]` para chat casual
- NAO existe "persona engine" dinamica — e prompt com variacoes por canal

### 3.2 Proatividade

| Feature | Status | Arquivo |
|---------|--------|---------|
| Morning Briefing (5 secoes) | ATIVO | `proactive-messages.service.ts:349-601` |
| Price Alerts (cada 6h) | ATIVO | `price-alert-cron.ts` |
| Deal Radar (shadow alerts) | ATIVO | `price-alert-cron.ts` |
| Reengagement (2+ dias inativo) | ATIVO | `proactive-messages.service.ts:604-652` |
| Smart Reorder | IMPLEMENTADO | `openclaw/smart-reorder.js` (sem dados) |
| Recomendacao proativa ("voce pode gostar") | **NAO EXISTE** | Gap critico |

### 3.3 Contextual Awareness

- Contexto de sessao em Redis (TTL 30min) via `core/session-manager.ts`
- Historico de 50 msgs passado ao LLM
- NAO existe resolucao de anafora explicita ("esse", "aquele")
- Workaround: LLM tenta inferir do historico

---

## FASE 4: QUALIDADE DAS RESPOSTAS

### 4.1 Intent Classification

**Mecanismo: 31 regex patterns** em `jarvis-whatsapp.service.ts:44-122`

**Router Grok vs Gemini:**
- Match em TOOL_PATTERNS → Gemini (tools)
- Confirmacao curta + contexto de tool → Gemini
- Default → Grok (conversa)

| Categoria | Patterns | LLM |
|-----------|----------|-----|
| Shopping (busca, compra, compare, preco) | 7 | Gemini |
| Travel (voo, hotel, restaurante, transit) | 4 | Gemini |
| Tracking/Navegacao | 2 | Gemini |
| Pagamento/Financas | 3 | Gemini |
| Servicos/Casa | 3 | Gemini |
| Documentos/Vault | 2 | Gemini |
| Saude/Farmacia | 2 | Gemini |
| Lembretes/Tarefas | 4 | Gemini |
| Social/Compartilhar | 1 | Gemini |
| Web/Imagem | 2 | Gemini |
| Localizacao | 1 | Gemini |
| Conversa casual | (default) | Grok |

### 4.2 Tools — 59 implementadas

| Categoria | Qtd | Exemplos |
|-----------|-----|----------|
| Shopping | 11 | search_products, amazon_search, compare_prices, smart_checkout |
| Travel | 10 | search_flights, search_hotels, search_restaurants |
| Payments | 7 | request_payment, paypal_create_order, mp_create_pix |
| Price Monitor | 3 | set_price_alert, check_price_history |
| Subscriptions | 3 | scan_subscriptions, cancel_subscription |
| Services | 5 | find_home_service, find_mechanic, make_phone_call |
| Location | 4 | get_directions, geocode_address, track_package |
| Memory | 4 | set_reminder, get_reminders, complete_reminder, save_user_fact |
| Documents | 3 | generate_document, export_transactions, fill_form |
| Web | 2 | web_search, browse |
| Butler | 3 | butler_protocol, butler_autofill, butler_gmail |
| Escalation | 1 | request_handoff |

**Tools pouco usadas (<2%):** butler_protocol, butler_autofill, butler_gmail, inner_circle_consult, fill_form

### 4.3 Uso real de LLM

| Metrica | Valor |
|---------|-------|
| Total chamadas LLM | **341** |
| Ultimos 7 dias | **56** |
| Total tokens | **45,500** |
| Custo real | **$0.0046** |
| Modelo | gemini-2.5-flash (99.4%) |
| Credits usados | 248 / 30,000 (0.8%) |

### 4.4 Response Formatting

- **Price ranking** como formato primario (cheapest first, 🟢 best value)
- Maximo 3 resultados por busca
- Links clicaveis incluidos
- Emoji guidelines: 🐕 (persona), 🟢✅🎉 (positivo), 🔴⚠️ (negativo), ⭐ (ratings)
- **Fallback rule:** se tools falham, usa knowledge do LLM + marca como "preco aproximado"

---

## FASE 5: INNER CIRCLE E ESPECIALISTAS

| Item | Status |
|------|--------|
| Jessica Passinato (consultora imagem) | Cadastrada, ATIVA |
| Interacoes com especialistas | **ZERO** |
| Tool `inner_circle_consult` | Implementada, nunca usada |
| Referral system | Schema existe, **ZERO referrals** |

---

## FASE 6: GAMIFICACAO

**Status: IMPLEMENTADO E FUNCIONAL**

**5 niveis (por savings):**
🐶 Puppy ($0-$499) → 🐕 Sniffer ($500-$1,999) → 🦮 Hunter ($2,000-$4,999) → 🏅 Master ($5,000-$9,999) → 🏆 Legend ($10,000+)

**13 achievements:** first_search, first_call, first_restaurant, searches_10/50, savings_50/100/500, streak_3/7/30, explorer_50, vip_200

**Leaderboard mensal** com rewards Pro access para top 3

**Dados reais:**

| Usuario | Level | Interactions | Streak | Savings |
|---------|-------|-------------|--------|---------|
| Jose | puppy | 67 | 2 days | $0 |
| Adrianne | explorer | 22 | 1 day | $0 |
| Arilson | newbie | 4 | 1 day | $0 |
| Matt | newbie | 2 | 1 day | $0 |

**Zero savings** rastreados — gamificacao funciona mas sem dados de compra.

---

## FASE 7: DIAGNOSTICO DE DADOS REAIS

### Metricas do Banco (PostgreSQL + Redis)

| Metrica | Valor |
|---------|-------|
| Usuarios totais | **9** |
| Usuarios ativos (7d) | **4** |
| Premium | **2** (Jose, Matt) |
| Trial | **1** (Adrianne) |
| Free | **6** |
| Conversas totais | **856** |
| Conversas (7d) | **156** |
| Buscas logadas (commerce_search_logs) | **0** (tabela vazia!) |
| Compras concluidas | **0** |
| Tentativas Amazon | **9** (todas falharam) |
| Price alerts ativos | **2** |
| Voice calls | **17** (94% completados) |
| Promo codes | **1** ("TECHREVIEWER", 0/5 usados) |
| Referrals | **0** |
| Inner Circle interactions | **0** |
| Sentinel incidents | **244** (toolsber-backend mais instavel) |

### Erros criticos ativos

| Erro | Severidade | Impacto |
|------|-----------|---------|
| Browser-agent CDP desconectado | **CRITICO** | Buscas Amazon/Target/Macy's falham |
| WhatsApp webhook TypeError | ALTO | Payloads malformados ignorados |
| Telegram "chat not found" | MEDIO | Chat IDs stale |
| Weather API failures | BAIXO | Briefing sem weather |
| CVS/Publix nao implementados | BAIXO | 501 errors |

### Redis Keys (61 total)

- Voice fillers, tips tracking, geocache, search cache, FX rates
- **ZERO keys** para: profile, session, preference (cache de perfil nao utilizado)

---

## RESUMO EXECUTIVO

### ✅ Implementado e Funcionando

- Profile Vault com AES-256-GCM (cookies, cards, credentials)
- 59 tools no Gemini (shopping, travel, payments, voice, documents)
- Dual LLM router (Grok conversa + Gemini tools) com 31 intent patterns
- Morning Briefing personalizado (5 secoes: weather, alerts, news, tips, currency)
- Price alerts automaticos (a cada 6h) + Deal Radar proativo
- Gamificacao completa (5 niveis, 13 achievements, leaderboard mensal)
- Reengagement flow (2+ dias inativo, max 1/semana)
- Deteccao automatica de idioma (PT/EN/ES)
- Voice calls via Twilio (94% success rate, 17 calls)
- Smart reorder (deteccao de padroes recorrentes)
- Inner Circle (Jessica cadastrada)
- Pipeline premium 8-layer com behavioral signals, anticipation, reflection
- Forgetting policy com confidence decay
- Annoyance score que suprime proatividade

### ⚠️ Implementado mas Fraco/Parcial

- **Aprendizado:** excelente no premium, inexistente no free (67% dos usuarios)
- **Historico de conversas:** sem sumarizacao, sem metadata, sem isolamento por sessao
- **Busca de produtos:** funciona mas `commerce_search_logs` NAO registra (0 rows!)
- **Resolucao de contexto:** depende do LLM inferir, sem anafora explicita
- **Referral system:** schema existe, zero uso
- **Gamificacao:** funciona mas $0 savings rastreados

### ❌ NAO Existe e DEVERIA Existir

| Gap | Impacto | Complexidade | Solucao |
|-----|---------|-------------|---------|
| Recomendacao proativa ("voce pode gostar") | **ALTO** | Media | Cron semanal cruzando user_facts com trending products |
| Inferencia de preferencias por compras | **ALTO** | Media | Post-purchase hook → extractFacts automatico |
| Sentiment analysis nas mensagens | **ALTO** | Media | Classificador positivo/negativo/neutro no pipeline |
| Aprendizado no free tier | **ALTO** | Baixa | Ativar extractFacts + classifyUserResponse no free |
| Conversation summarization | MEDIO | Media | Resumo a cada 100 msgs via LLM |
| Resolucao de anafora ("aquele perfume") | MEDIO | Alta | Entity tracking por sessao |
| Post-purchase satisfaction | MEDIO | Baixa | Follow-up 3 dias apos compra |
| Preference versioning | BAIXO | Baixa | Tabela fact_history com snapshots |
| Cross-user insights ("users like you") | BAIXO | Alta | Agregacao anonimizada por segmento |
| Adaptive message timing | BAIXO | Media | Per-user optimal send time |

---

## 🗺️ TOP 5 MELHORIAS PRIORITARIAS

### 1. CONSERTAR BROWSER-AGENT (Urgente — impacto imediato)
**Problema:** ZERO compras concluidas. Todas as 9 tentativas falharam por CDP desconectado.
**Impacto:** Sem isso, o agente nao consegue comprar em NENHUM marketplace.
**Acao:** Reconectar CDP do BrowserBase, testar checkout Amazon end-to-end.
**Complexidade:** Baixa | **Prioridade:** P0

### 2. ATIVAR APRENDIZADO NO FREE TIER (Alto impacto, baixo esforco)
**Problema:** 6 de 9 usuarios sao free. Experiencia de "memoria de peixe".
**Impacto:** 67% dos usuarios nao tem aprendizado — o agente nao evolui com eles.
**Acao:** Ativar `extractFacts()` e `classifyUserResponse()` no pipeline free (sem 8 layers completas).
**Complexidade:** Baixa | **Prioridade:** P1

### 3. CONSERTAR LOGGING DE BUSCAS (Visibilidade critica)
**Problema:** `commerce_search_logs` vazio (0 rows) apesar de buscas acontecendo via Redis cache.
**Impacto:** Impossivel otimizar resultados ou medir produto mais buscado.
**Acao:** Verificar se hook de logging esta conectado no search service.
**Complexidade:** Baixa | **Prioridade:** P1

### 4. IMPLEMENTAR RECOMENDACAO PROATIVA (Diferencial competitivo)
**Problema:** O agente NUNCA sugere "Jose, achei algo similar ao que voce buscou".
**Impacto:** Transforma agente passivo em agente ativo — principal diferencial.
**Acao:** Cron semanal cruzando user_facts + price alerts + purchase history.
**Complexidade:** Media | **Prioridade:** P2

### 5. POST-PURCHASE FOLLOW-UP (Fecha o loop)
**Problema:** Zero tracking de satisfacao. Agente nao sabe se usuario gostou.
**Impacto:** Sem feedback loop, recomendacoes nunca melhoram.
**Acao:** Message automatica 3 dias apos compra concluida.
**Complexidade:** Baixa | **Prioridade:** P2

---

## 🔧 CORRECOES REALIZADAS

Nenhuma correcao implementada — foco 100% diagnostico. Correcoes requerem sandbox conforme regras operacionais.

---

## ARQUIVOS-CHAVE REFERENCIADOS

| Area | Arquivos Principais |
|------|-------------------|
| Profile/Memory | `openclaw/memory.js`, `openclaw/adaptive-memory.js`, `openclaw/user-model.js` |
| Behavioral Signals | `openclaw/behavioral-signals.js`, `openclaw/reflection.js` |
| Proactivity | `openclaw/initiative.js`, `openclaw/anticipation.js` |
| Premium Pipeline | `openclaw/premium-pipeline.js` (orquestrador) |
| Smart Reorder | `openclaw/smart-reorder.js` |
| Intent Router | `apps/api/src/services/jarvis-whatsapp.service.ts:44-122` |
| Tools (59) | `openclaw/gemini.js:462-1236` |
| System Prompts | `openclaw/gemini.js:13-453`, `jarvis-whatsapp.service.ts:124-194` |
| Morning Briefing | `apps/api/src/services/engagement/proactive-messages.service.ts:349-601` |
| Gamification | `apps/api/src/services/engagement/gamification.service.ts` |
| Encryption | `apps/api/src/services/payments/vault.ts` |
| Schema | `packages/database/prisma/schema.prisma` |

---

*Relatorio gerado por Claude Code (Opus 4.6) em 2026-04-05*
*Fontes: PostgreSQL (payjarvis), Redis (61 keys), PM2 logs, codebase completo*
