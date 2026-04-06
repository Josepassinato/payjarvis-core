# PayJarvis B2B — Complete Specification

## 1. Site Rebrand
- Hero: "Spending Firewall for Autonomous AI Agents"
- Sub: "Controle granular de gastos, BDIT com verificacao offline via JWKS e CredScore dinamico."
- CTAs: "Explorar no GitHub" + "Testar Hosted Free Tier"
- Badge: "Open-source - Apache 2.0 - Production-ready"
- Title: "PayJarvis — Spending Firewall for AI Agents | Open-source + Hosted"
- Meta: "Controle seguro de gastos para agentes de IA autonomos."

## 2. REMOVER do site
- "Jarvis finds it. Jarvis buys it."
- "Free AI shopping agent"
- "Start Free on Telegram" / "Try 7 days free on WhatsApp"
- Secao "What your bot can do" (voos, restaurantes, iFood)
- Secao "Powered by the best" (Expedia, Amazon, iFood)
- Qualquer referencia a agente de compras/shopping

## 3. SECURITY (4 camadas)
- KYC + CredScore Dinamico: verificacao humana + score comportamental 0-100
- Spending Firewall + Rules Engine: controle por categoria, limites, whitelist/blacklist
- Human-in-the-Loop: aprovacao via Telegram ou SSE
- Immutable Audit Log: registro criptograficamente assinado

## 4. SDK Example
```typescript
import { PayJarvis } from "@payjarvis/agent-sdk"
const pj = PayJarvis.fromEnv()

const result = await pj.requestApproval({
  amount: 450,
  currency: "USD",
  merchant: "stripe",
  category: "marketing",
  minCredScore: 75,
  purpose: "api_credits"
})

if (result.approved) console.log("BDIT:", result.bdit)
```

## 5. Self-Hosted vs Hosted (tabela)

| Recurso | Self-Hosted (Gratuito) | Hosted SaaS (Pago) |
|---------|----------------------|-------------------|
| Codigo completo | Sim (Apache 2.0) | Gerenciado |
| Infraestrutura | Voce gerencia | Gerenciada + SLA |
| CredScore | Basico | Automatico com IA |
| Analytics | Basico | Avancado |
| Integracoes | Manual | Pre-configuradas |
| Suporte | Comunidade | Prioritario + SLA |

## 6. Pricing
- Self-Hosted: Gratuito (Apache 2.0)
- Hosted Pro: $49/mes
- Enterprise: Sob consulta

## 7. Integracoes
- Stripe: Payment Intents + webhooks automaticos
- PayPal: Orders API + recurring
- Visa TAP: BDIT gera payloads compativeis
- Mastercard AgentPay: tokenizacao + limites dinamicos
- Braintree: disputas + assinaturas
- Adyen: global + HMAC validation

## 8. CredScore (0-100)
- Transacoes (40-50%): taxa sucesso, volume, cancelamentos
- Politicas (20-25%): adesao a regras por categoria
- Comportamento (15-20%): consistencia, anomalias
- Externos (10-15%): feedback merchants, KYC
- Niveis: Baixo(<50), Medio(50-75), Alto(76-90), Trusted(>90)
- Assimetrico: sucesso +gradual, falha -forte
- Decay temporal pra inativos

## 9. BDIT (Bot Digital Identity Token)
- JWT RS256, 5 min expiry
- JWKS publico em /.well-known/jwks.json
- Payload: iss, sub, ownerId, credScore, credScoreLevel, kycLevel, amount, currency, maxAmount, category, merchant, purpose, tapCompatible, consumerRecognition, policyId, rulesApplied
- Merchants verificam offline

## 10. Webhooks (todos os gateways)
- Stripe: payment_intent.succeeded/failed, charge.dispute.created, charge.refunded, invoice.*, review.opened
- PayPal: PAYMENT.CAPTURE.COMPLETED/DENIED, CUSTOMER.DISPUTE.CREATED, BILLING.SUBSCRIPTION.*
- Braintree: transaction_settled, dispute_opened/lost, subscription_charged_*
- Adyen: AUTHORISATION, CAPTURE, DISPUTE, REFUND (HMAC validation)
- Todos atualizam CredScore automaticamente no Hosted

## 11. Features page
- BDIT, Rules Engine, CredScore, Controle por Categoria, Human-in-Loop, Audit Log

## 12. Roadmap
- Q2 2026: Stripe + PayPal nativos
- Q2 2026: Visa TAP + CredScore embutido
- Q3 2026: Analytics + sugestoes por IA
- Q4 2026: Multi-agent governance + zero-knowledge proof

## 13. Footer
- GitHub, Docs, Roadmap, Security
- "PayJarvis e open-source sob licenca Apache 2.0 (c) 2026"
