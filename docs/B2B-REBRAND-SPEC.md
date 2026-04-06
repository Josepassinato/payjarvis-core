# PayJarvis B2B Rebrand Spec

## Overview
Rebrand payjarvis.com from B2C shopping agent to B2B spending firewall platform for autonomous AI agents.

## Changes

### 1. HERO
- Badge: "Open-source - Apache 2.0 - Production-ready"
- Headline: "Spending Firewall for Autonomous AI Agents"
- Subheadline: "Controle granular de gastos, identidade criptografica (BDIT) com verificacao offline via JWKS e CredScore dinamico."
- Description: "PayJarvis permite que desenvolvedores definam politicas avancadas de gasto por categoria, monitorem o comportamento dos agents e mantenham aprovacao humana quando necessario."
- CTA primario: "Explorar no GitHub" -> repo
- CTA secundario: "Testar Hosted Free Tier"

### 2. REMOVED SECTIONS
- "What your bot can do" (capabilities - flights, restaurants, iFood)
- "Powered by the best" (integrations - Expedia, Amazon, iFood)
- "Start Free on Telegram" / "Try 7 days free on WhatsApp"
- All B2C shopping agent references

### 3. SECURITY (4 layers)
- KYC + CredScore Dinamico
- Spending Firewall + Rules Engine
- Human-in-the-Loop (Telegram ou SSE)
- Immutable Audit Log

### 4. SDK Example
```typescript
pj.requestApproval({
  amount: 450,
  currency: "USD",
  merchant: "stripe",
  category: "marketing",
  minCredScore: 75,
  purpose: "api_credits"
})
```

### 5. NEW SECTION: Self-Hosted vs Hosted SaaS
Comparison table

### 6. FOOTER
GitHub, Docs, Roadmap, Seguranca + "Open-source sob Apache 2.0 (c) 2026"

### 7. HEADER
Home, Features, Pricing, Docs, GitHub

### 8. META
- Title: "PayJarvis - Spending Firewall for AI Agents | Open-source + Hosted"
- Description: "Controle seguro de gastos para agentes de IA autonomos. BDIT, Rules Engine e CredScore dinamico."

### 9. PAYMENT METHODS
Keep Stripe, PayPal, Visa TAP, Mastercard AgentPay - reposition as "Gateways Suportados"
