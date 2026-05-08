# PayJarvis Core

> **Stop your AI agents from going rogue with money.**
>
> Identity, reputation, and governance for autonomous AI agents that spend money. Open-source policy engine. Managed audit and analytics.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-see%20LICENSE-blue.svg" alt="License"/></a>
  <a href="docs/bdit-spec/BDIT-SPEC.md"><img src="https://img.shields.io/badge/spec-BDIT-green.svg" alt="BDIT Spec"/></a>
  <a href="https://payjarvis.com"><img src="https://img.shields.io/badge/site-payjarvis.com-black.svg" alt="PayJarvis"/></a>
</p>

---

## Why this exists

AI agents are starting to spend real money: buying inventory, paying suppliers, renewing services, completing checkouts. Three problems become unavoidable.

### The bot is buying things. You have no control.

When an agent gets prompt-injected, drifts from its original intent, or simply does what an ill-considered prompt told it to do, it can drain a budget in minutes. Per-transaction limits do not stop a bot from running hundreds of smaller transactions.

**PayJarvis solves this** with a policy engine that runs before every transaction: categorical limits, velocity caps, time windows, intent verification, fail-closed execution, and an immutable audit log.

### If the bot screws up, who is responsible?

Agentic commerce protocols and payment processors do not fully answer accountability. When a rogue agent buys something illegal, restricted, or financially harmful, the system needs a clear responsibility chain.

**PayJarvis solves this** with **BDIT** (Bot Digital Identity Token): a verifiable credential that ties every agent to an accountable operator, with KYC/KYB handled by specialized identity providers.

### How do you know whether to trust this bot?

A merchant accepting a transaction from "an AI agent" has no portable way to know if that agent has a clean history or has been blocked elsewhere for fraud, abuse, or policy violations.

**PayJarvis solves this** with reputation that travels with the BDIT. Bots that behave gain trust. Bots that do not lose it. Reputation signals can be exposed to merchants, MCP servers, and platforms that want to verify before transacting.

---

## Quickstart

Install the agent SDK:

```bash
npm install @payjarvis/agent-sdk
```

Wrap your agent's purchase flow with PayJarvis governance:

```typescript
import { PayJarvis } from "@payjarvis/agent-sdk";

const payjarvis = new PayJarvis({
  apiKey: process.env.PAYJARVIS_API_KEY,
  botId: process.env.PAYJARVIS_BOT_ID,
  baseUrl: process.env.PAYJARVIS_URL ?? "https://api.payjarvis.com",
});

const decision = await payjarvis.requestApproval({
  merchant: "staples.com",
  amount: 247.5,
  currency: "USD",
  category: "office_supplies",
  description: "Purchase office supplies from approved vendor",
});

if (decision.approved) {
  // Proceed with checkout through ACP, Stripe, or browser-based checkout.
} else {
  console.log("Blocked:", decision.reason);
}
```

Every decision, allow or deny, is written to the audit trail before the agent proceeds.

---

## The three pillars

### 1. Identity

> Every agent has a person or organization behind it. We make that explicit, verifiable, and accountable.

- **BDIT** carries agent identity, operator reference, KYC level, jurisdiction, transaction context, and short-lived signature.
- **Tiered KYC** supports sandbox, verified production, and institutional KYB flows.
- **Responsibility chain** supports multi-tenant scenarios where bot ownership spans platform owner, instance operator, and session.

The current BDIT specification lives in [`docs/bdit-spec/BDIT-SPEC.md`](docs/bdit-spec/BDIT-SPEC.md).

### 2. Reputation

> Reputation that follows the agent across merchants, MCPs, and platforms.

- Score updated by observed behavior: policy compliance, disputes, anomaly events, and operator interventions.
- Signed credentials allow merchants to verify authenticity without trusting a runtime intermediary.
- Short-lived credentials support revocation through refresh rather than long-lived bearer tokens.
- Public reputation registry is planned for a future release with due process and dispute handling.

### 3. Governance

> Stop your agents from going rogue with money. Audit every decision they make.

- **Policy engine** for limits, categories, velocity, time windows, and blocked merchants.
- **Fail-closed execution** when policy confidence is low or required context is missing.
- **Immutable audit log** designed for forensic review and compliance exports.
- **Spend Audit dashboard** for managed audit, analytics, and operational review.

---

## How it works

```text
┌─────────────────────────────────────────┐
│             Your AI Agent               │
│  Claude SDK, OpenAI Agents, custom bot  │
└────────────────────┬────────────────────┘
                     │ proposed action
                     ▼
┌─────────────────────────────────────────┐
│        PayJarvis Policy Engine          │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐  │
│  │ Identity │ │Reputation│ │ Policy  │  │
│  │  BDIT    │ │  Score   │ │ Rules   │  │
│  └─────┬────┘ └────┬─────┘ └────┬────┘  │
│        └───────────┼────────────┘       │
│                    ▼                    │
│        Decision: allow / deny           │
│            + audit event                │
└────────────────────┬────────────────────┘
                     │ if allowed
                     ▼
┌─────────────────────────────────────────┐
│   ACP Merchant / Stripe / MCP Server    │
└─────────────────────────────────────────┘
```

---

## Repository layout

```text
apps/api             PayJarvis API and commerce integrations
apps/rules-engine    Policy/rules service
apps/web             Public web application
apps/admin           Managed audit/admin dashboard
apps/browser-agent   Browser checkout automation service
packages/agent-sdk   SDK for agent-side governance
packages/merchant-sdk SDK for merchant verification flows
packages/verify-sdk  BDIT verification SDK
packages/bdit        BDIT generation and verification primitives
packages/types       Shared TypeScript types
docs/bdit-spec       Current BDIT specification
```

---

## Local development

Install dependencies:

```bash
npm install
```

Build key workspaces:

```bash
npm run build --workspace @payjarvis/api
npm run build --workspace @payjarvis/web
npm run build --workspace @payjarvis/browser-agent
```

Run services locally with the workspace scripts or with the PM2 ecosystem file used in production:

```bash
pm2 startOrReload ecosystem.config.cjs --update-env
```

Create a `.env` from `.env.example` and provide the required service keys before running production-like flows.

---

## Roadmap

### v0 - public preview

- [x] Policy engine core
- [x] Fail-closed execution
- [x] Append-only audit log
- [x] BDIT v0 specification
- [x] TypeScript SDKs
- [x] Spend Audit dashboard
- [x] Stripe integration
- [x] Browser-based checkout support

### v0.5

- [ ] Python SDK
- [ ] Anomaly detection
- [ ] Approval workflows
- [ ] Public dispute mechanism
- [ ] First transparency report

### v1

- [ ] Public reputation registry
- [ ] Federated cross-merchant reputation
- [ ] Institutional KYC tier
- [ ] Multi-region deployment
- [ ] Enterprise SSO and SOC 2 Type II

---

## Used by

- **SnifferShop** - autonomous shopping agent built on PayJarvis governance, Stripe, and browser checkout flows.

Want to be listed? Email `hello@payjarvis.com`.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

For protocol changes, submit RFC-style PRs against the BDIT specification in [`docs/bdit-spec`](docs/bdit-spec).

For core engine, SDK, API, browser agent, or dashboard changes, submit PRs in this repository.

---

## Security

If you find a vulnerability, please do not open a public issue. Email **security@payjarvis.com**. See [SECURITY.md](./SECURITY.md).

---

## License

This repository currently ships with the root [LICENSE](./LICENSE). The intended long-term split is:

- Protocol/specification and SDK surfaces under a permissive open-source license.
- Core hosted-service protection for managed commercial operations.
- Managed SaaS audit, analytics, dispute resolution, dashboard, and registry as proprietary services.

Do not change the legal license model without updating the actual license files and package metadata in the same PR.

---

**PayJarvis** is developed by [12Brain Solutions LLC](https://12brain.com). Identity verification, fraud prevention, and KYC/KYB services are operated with specialized partners.
