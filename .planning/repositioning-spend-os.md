# CARD — Atualizar PayJarvis com novo posicionamento (Identity + Reputation + Governance)

**Para:** Claude Code (rodando na VPS srv1306722)
**De:** Jose
**Prioridade:** Alta — preparação pra lançamento público
**Branch:** Criar `feat/repositioning-spend-os` a partir de `main`

---

## 1. Contexto e objetivo

O PayJarvis está sendo reposicionado de "Spending Firewall" para uma camada de **Identity + Reputation + Governance** para agentes de IA autônomos que gastam dinheiro. Esse card cobre os ajustes necessários no código (landing, copy, configs) e no README do GitHub para alinhar o repo ao novo posicionamento antes do lançamento público open-source.

**Não questionar as decisões abaixo — elas estão cravadas.** Executar.

### Decisões cravadas

- **Headline:** "Stop your AI agents from going rogue with money."
- **Subheadline:** "Identity, reputation, and governance for autonomous AI agents that spend money. Open-source policy engine. Managed audit and analytics."
- **Três pillars:** Identity (BDIT), Reputation (score público), Governance (policy + audit + analytics)
- **ICP primário:** CFO / Procurement / Ops
- **Customer #0 público:** SnifferShop (mencionado discretamente, sem hero status)
- **Licenças:**
  - Core, dashboard, audit engine → **Business Source License 1.1** (converte pra Apache 2.0 após 4 anos)
  - Spec do BDIT, JSON Schemas, SDKs → **Apache License 2.0**
- **Reputação pública:** mensagem inclui literalmente "for better, or for worse" — manter
- **Auth de operador:** Clerk (signup, signin, MFA, organizations)
- **Identity verification (KYC):** terceirizado para provider especializado (Stripe Identity ou Persona — decidir depois)

---

## 2. Tarefas (executar em ordem)

### 2.1 Reconhecimento do repositório atual

Antes de modificar qualquer coisa:

```bash
cd /root/projetos/payjarvis  # confirmar caminho real
git status
git checkout main && git pull
git checkout -b feat/repositioning-spend-os

# Mapear estrutura
tree -L 3 -I 'node_modules|.next|.turbo|dist'
cat package.json
ls -la apps/ packages/ 2>/dev/null
```

**Output esperado:** confirmação da estrutura real do monorepo (apps, packages, pnpm-workspace, turbo.json). Documentar no terminal antes de prosseguir.

### 2.2 Substituir o README principal

O conteúdo do novo README está no arquivo anexo `payjarvis-core-README.md`. Substituir o `README.md` da raiz do repo pelo conteúdo desse arquivo.

**Adaptações obrigatórias antes do commit:**

- URLs dos badges: ajustar para a URL real do repo (provavelmente `github.com/Josepassinato/payjarvis` ou `github.com/payjarvis/payjarvis-core` — verificar `git remote -v`)
- Links internos (`./CONTRIBUTING.md`, `./SECURITY.md`, etc.): manter como estão; arquivos serão criados em 2.4
- Link pra `bdit-spec` repo: criar como link comentado por enquanto se o repo ainda não foi separado; deixar TODO no commit message
- Link pra Discord: criar invite real ou comentar até criar
- Email `security@payjarvis.com` e `hello@payjarvis.com`: confirmar com Jose se já estão configurados; se não, deixar TODO

### 2.3 Atualizar landing page (apps/web ou similar)

Localizar a landing page no monorepo (provavelmente `apps/web/` em Next.js). Atualizar:

**Hero section:**
```
H1: Stop your AI agents from going rogue with money.
Subhead: Identity, reputation, and governance for autonomous AI agents that spend money. Open-source policy engine. Managed audit and analytics.
CTA primário: "Get started" → /signup (via Clerk)
CTA secundário: "Read the docs" → /docs ou link pro README do GitHub
```

**Section "The three pains we solve":**

Três cards lado a lado, cada um com título + parágrafo curto:

1. **The bot is buying things. You have no control.**
   _When agents drift, get prompt-injected, or simply do what an ill-considered prompt told them to do, they can drain a budget in minutes. PayJarvis runs policy before every transaction. Categorical limits, velocity caps, time windows, fail-closed execution, immutable audit log._

2. **If the bot screws up, who is responsible?**
   _ACP doesn't answer this. Stripe doesn't answer this. Today, prosecutors go after whoever they can identify — almost never the actual operator. PayJarvis ties every agent to a legally accountable human or entity through BDIT and verified KYC._

3. **How do you know whether to trust this bot?**
   _Reputation that follows the agent across merchants, MCPs, and platforms — for better, or for worse. Bots that behave gain trust. Bots that don't lose it._

**Section "How it works":**

Diagrama (pode ser SVG inline ou imagem) do fluxo: Agent → PayJarvis Policy Engine (Identity + Reputation + Policy) → Decision (allow/deny + audit) → ACP/Stripe/MCP merchant. Texto curto explicando.

**Section "Used by":**

- SnifferShop (logo + uma linha: "Autonomous shopping agent built on PayJarvis governance")
- Placeholder "Want to be listed? Email hello@payjarvis.com"

**Footer:**

- Links: Docs, GitHub, Discord, Security, Privacy, Terms
- "Built by 12Brain Solutions LLC. Identity verification operated by specialized partners; PayJarvis remains co-responsible as data controller."
- Copyright

**Remover qualquer copy antigo** que mencione "Spending Firewall" sem contexto ou que foque exclusivamente em "checkout" / "shopping". A narrativa migrou de transação pra governança.

### 2.4 Criar arquivos de governança

Criar na raiz do repo:

**SECURITY.md**
```markdown
# Security Policy

## Reporting a Vulnerability

Please do NOT open a public issue for security vulnerabilities. Email **security@payjarvis.com**. PGP key: [link or fingerprint].

We commit to:
- Acknowledge within 48 hours
- Provide remediation timeline within 7 days
- Credit you in the public advisory (unless you prefer anonymity)

## Supported Versions

Currently supported: latest minor version of `main`. Older versions are not patched.

## Scope

In scope: payjarvis-core, bdit-spec, official SDKs, dashboard SaaS.
Out of scope: third-party integrations, customer-managed deployments.
```

**CONTRIBUTING.md**
```markdown
# Contributing to PayJarvis

Thanks for your interest in contributing.

## Types of contributions

### Protocol changes (BDIT spec)
Submit RFC PRs to [`bdit-spec`](https://github.com/payjarvis/bdit-spec). Use the SEP (Standard Enhancement Proposal) template. Major changes require community review before merge.

### Core engine, SDKs, dashboard
Submit PRs to this repo. Follow the existing code style. Include tests for new features.

## Pull request process

1. Open an issue first for non-trivial changes
2. Fork, branch from `main`
3. Add tests
4. Run `pnpm lint && pnpm test && pnpm build` before submitting
5. Sign the CLA (link)
6. Submit PR with clear description

## Code of conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). We follow Contributor Covenant 2.1.
```

**GOVERNANCE.md**
```markdown
# Governance

## Current state (v0)

PayJarvis is currently developed and maintained by 12Brain Solutions LLC. The BDIT specification is published as an open Apache 2.0 protocol, but governance of the spec is held by 12Brain Solutions during the bootstrapping phase.

## Transition plan

We acknowledge that long-term protocol legitimacy requires multi-stakeholder governance. Our planned transition:

- **v0 → v1 (now to ~12 months):** 12Brain Solutions as sole maintainer; community feedback via RFC PRs
- **v1 → v2 (~12-24 months):** Form a working group with 3-5 external maintainers from independent organizations
- **v2+ (24+ months):** Transition spec governance to an independent foundation (W3C-style or Linux Foundation Project)

This timeline accelerates if adoption requires it.

## Conflict of interest

We commit to documenting and disclosing any cases where 12Brain commercial interests conflict with protocol decisions.
```

**CODE_OF_CONDUCT.md** — usar texto padrão Contributor Covenant 2.1, contato `conduct@payjarvis.com`.

### 2.5 Arquivos de licença

Criar na raiz:

- `LICENSE` — apontador que explica a estrutura dual:
  ```
  This repository contains code under two licenses:

  - Files in /core/, /apps/dashboard/ — Business Source License 1.1 (see LICENSE-BSL)
  - Files in /spec/, /packages/sdk-*, /packages/types/ — Apache License 2.0 (see LICENSE-APACHE)

  Each file's license is also indicated in its SPDX header.
  ```

- `LICENSE-BSL` — texto completo da BSL 1.1 com:
  - Licensor: 12Brain Solutions LLC
  - Licensed Work: PayJarvis Core
  - Additional Use Grant: Production use is permitted, except for offering a hosted commercial service that competes with PayJarvis SaaS
  - Change Date: data atual + 4 anos
  - Change License: Apache License 2.0

- `LICENSE-APACHE` — texto completo da Apache 2.0 padrão

Adicionar SPDX headers nos arquivos relevantes:

```typescript
// SPDX-License-Identifier: BSL-1.1
// Copyright (c) 2026 12Brain Solutions LLC
```

ou

```typescript
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 12Brain Solutions LLC
```

### 2.6 Atualizar package.json e configs

Para cada `package.json` no monorepo:

- `description`: alinhar ao novo posicionamento (não mais "spending firewall"; usar variações de "policy engine for autonomous AI agents", "BDIT SDK", etc.)
- `license`: declarar corretamente (`"BSL-1.1"` ou `"Apache-2.0"` por pacote)
- `repository`, `homepage`, `bugs`: confirmar URLs corretas
- `keywords`: adicionar `ai-agents`, `agentic-commerce`, `governance`, `policy-engine`, `bdit`, `identity`, `reputation`

### 2.7 Validação

**Não usar localhost** (ADR-010). Testar via URL pública.

Comandos de validação:

```bash
pnpm install
pnpm lint
pnpm test
pnpm build

# Deploy preview pra URL pública (Vercel, Cloudflare Pages, ou nginx no VPS)
# Validar:
# - Site renderiza com novo conteúdo em payjarvis.com (ou subdomain de preview)
# - README renderiza bonito em github.com/[org]/[repo] (push para branch e olhar render)
# - Build não quebra
# - Lint passa
# - Tests passam
```

Se o site exigir interação com bot WhatsApp/Telegram pra teste, usar Playwright autonomamente (não precisa pedir permissão).

### 2.8 Commit e PR

- Commits atômicos por seção (README, landing, governance, licenses, configs)
- Mensagens em PT-BR ou EN, mas consistente
- PR title: `feat: repositioning to Identity + Reputation + Governance`
- PR body: link pra esse card, lista de mudanças, checklist do que foi testado, screenshots da landing renderizada

---

## 3. Restrições

- **NÃO** renomear o repo (manter URL atual; mudar nome do repo quebra links)
- **NÃO** quebrar integrações WhatsApp / Telegram existentes (testar antes de PR)
- **NÃO** commitar `.env`, credenciais, tokens, ou secrets — verificar com `git diff` antes de cada commit
- **NÃO** alterar lógica do policy engine, do core, ou do BDIT issuance — esse card é só posicionamento, copy, governance e licenças
- **NÃO** rodar `git push --force` em main; sempre PR
- **NÃO** modificar o `package.json` em ways que quebrem o build do `pnpm install` em outros desenvolvedores

---

## 4. Output esperado

Quando concluir:

1. PR aberto com diff completo, descrição clara, checklist
2. Build passando, lint passando, tests passando
3. Preview URL ativo mostrando landing nova
4. README renderizando corretamente no GitHub (verificar com push pra branch e abrir no navegador)
5. Lista de TODOs pendentes em comentário do PR (ex: "Discord invite a criar", "Email security@payjarvis.com a configurar no DNS", "Stripe Identity vs Persona a decidir")
6. Mensagem de volta pro Jose: link do PR + screenshots + lista de TODOs

---

## 5. Notas operacionais

- Playwright disponível e autorizado para qualquer teste de UI no VPS
- Antes de pedir ação manual ao Jose, verificar se há API/CLI que automatize
- Hook `gsd-validate-commit.sh` missing é não-bloqueante — ignorar
- Testar tudo via URL pública conforme ADR-010
- Se encontrar credenciais expostas no git history (do trabalho anterior), parar e alertar Jose imediatamente — não tentar limpar sozinho

---

## 6. Anexos

- `payjarvis-core-README.md` — conteúdo completo do novo README

Boa execução. Quando terminar, manda o link do PR + screenshots da landing.
