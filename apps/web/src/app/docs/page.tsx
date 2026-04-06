"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

const tabs = ["quickstart", "auth", "sdk", "api", "webhooks"] as const;
type Tab = (typeof tabs)[number];

const tabIcons: Record<Tab, string> = {
  quickstart: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z",
  auth: "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z",
  sdk: "M14.25 9.75L16.5 12l-2.25 2.25m-4.5 0L7.5 12l2.25-2.25M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z",
  api: "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418",
  webhooks: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
};

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="group relative">
      <div className="flex items-center justify-between rounded-t-lg bg-gray-800 px-4 py-2">
        <span className="text-xs text-gray-400">{lang}</span>
        <button
          onClick={handleCopy}
          className="text-xs text-gray-400 transition-colors hover:text-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-b-lg bg-gray-900 p-4 text-sm leading-relaxed text-green-400">
        {code}
      </pre>
    </div>
  );
}

function QuickStartSection({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-xl font-bold">{t("docs.qs.overviewTitle")}</h3>
        <p className="text-gray-400 leading-relaxed">{t("docs.qs.overviewDesc")}</p>
      </div>

      <div className="space-y-6">
        {[
          {
            step: "1",
            title: t("docs.qs.step1Title"),
            desc: t("docs.qs.step1Desc"),
            code: `npm install @payjarvis/agent-sdk`,
          },
          {
            step: "2",
            title: t("docs.qs.step2Title"),
            desc: t("docs.qs.step2Desc"),
            code: `import { PayJarvis } from '@payjarvis/agent-sdk'

const pj = new PayJarvis({
  apiKey: 'pj_bot_xxxxxxxxxxxxxxxx',
  botId:  'bot_xxxxxxxxxxxxxxxx',
})`,
          },
          {
            step: "3",
            title: t("docs.qs.step3Title"),
            desc: t("docs.qs.step3Desc"),
            code: `// Request a payment decision before checkout
const decision = await pj.requestPayment({
  amount: 49.99,
  currency: 'USD',
  category: 'shopping',
  merchantName: 'Amazon',
  description: 'Wireless headphones',
})

if (decision.approved) {
  // Proceed with purchase
  console.log('Transaction approved:', decision.transactionId)
} else if (decision.pending) {
  // Human approval required — poll or use SSE
  const status = await pj.waitForApproval(decision.approvalId)
} else {
  // Blocked by policy
  console.log('Blocked:', decision.reason)
}`,
          },
          {
            step: "4",
            title: t("docs.qs.step4Title"),
            desc: t("docs.qs.step4Desc"),
            code: `// Get your bot's trust score and reputation
const rep = await pj.getReputation()
console.log('Trust Score:', rep.trustScore)  // 0-1000
console.log('Success rate:', rep.successRate) // 0-100%`,
          },
        ].map((item) => (
          <div
            key={item.step}
            className="flex gap-6 rounded-xl border border-gray-200 bg-white p-6"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">
              {item.step}
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-lg font-semibold">{item.title}</h4>
              <p className="mt-1 text-sm text-gray-400">{item.desc}</p>
              <div className="mt-3">
                <CodeBlock code={item.code} lang={item.step === "1" ? "bash" : "typescript"} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AuthSection({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-xl font-bold">{t("docs.auth.title")}</h3>
        <p className="text-gray-400 leading-relaxed">{t("docs.auth.desc")}</p>
      </div>

      {/* Auth methods */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            title: t("docs.auth.botKeyTitle"),
            desc: t("docs.auth.botKeyDesc"),
            badge: "pj_bot_*",
            color: "brand",
          },
          {
            title: t("docs.auth.clerkTitle"),
            desc: t("docs.auth.clerkDesc"),
            badge: "Bearer JWT",
            color: "purple",
          },
          {
            title: t("docs.auth.bditTitle"),
            desc: t("docs.auth.bditDesc"),
            badge: "RS256 JWT",
            color: "blue",
          },
          {
            title: t("docs.auth.hmacTitle"),
            desc: t("docs.auth.hmacDesc"),
            badge: "HMAC-SHA256",
            color: "orange",
          },
        ].map((m) => (
          <div key={m.title} className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-full bg-${m.color === "brand" ? "brand-600/20" : m.color === "purple" ? "purple-600/20" : m.color === "blue" ? "blue-600/20" : "orange-600/20"} px-3 py-0.5 text-xs font-mono font-medium text-${m.color === "brand" ? "brand-400" : m.color === "purple" ? "purple-400" : m.color === "blue" ? "blue-400" : "orange-400"}`}>
                {m.badge}
              </span>
            </div>
            <h4 className="font-semibold">{m.title}</h4>
            <p className="mt-1 text-sm text-gray-400">{m.desc}</p>
          </div>
        ))}
      </div>

      <div>
        <h4 className="mb-3 font-semibold">{t("docs.auth.exampleTitle")}</h4>
        <CodeBlock
          lang="typescript"
          code={`// Bot API Key authentication (most common for SDK)
const pj = new PayJarvis({
  apiKey: process.env.PAYJARVIS_API_KEY, // pj_bot_xxxx
  botId:  process.env.PAYJARVIS_BOT_ID,
})

// Or use raw HTTP with the header
fetch('https://www.payjarvis.com/api/bots/BOT_ID/request-payment', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer pj_bot_xxxxxxxxxxxxxxxx',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: 29.99,
    currency: 'USD',
    category: 'shopping',
    merchantName: 'Target',
  }),
})`}
        />
      </div>

      <div className="rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6">
        <div className="flex items-start gap-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div>
            <h4 className="font-semibold text-yellow-400">{t("docs.auth.securityTitle")}</h4>
            <p className="mt-1 text-sm text-gray-400">{t("docs.auth.securityDesc")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SdkSection({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-xl font-bold">{t("docs.sdk.title")}</h3>
        <p className="text-gray-400 leading-relaxed">{t("docs.sdk.desc")}</p>
      </div>

      {/* SDK packages */}
      <div className="space-y-6">
        {[
          {
            name: "@payjarvis/agent-sdk",
            desc: t("docs.sdk.agentDesc"),
            install: "npm install @payjarvis/agent-sdk",
            code: `import { PayJarvis } from '@payjarvis/agent-sdk'

const pj = new PayJarvis({
  apiKey: 'pj_bot_xxxx',
  botId: 'bot_xxxx',
})

// Payment decision
const decision = await pj.requestPayment({
  amount: 99.99,
  currency: 'USD',
  category: 'electronics',
  merchantName: 'Best Buy',
})

// Get bot limits
const limits = await pj.getLimits()

// Trust score
const rep = await pj.getReputation()

// Listen for approvals (SSE)
pj.onApproval((event) => {
  console.log(event.status) // 'APPROVED' | 'REJECTED'
})`,
          },
          {
            name: "@payjarvis/verify-sdk",
            desc: t("docs.sdk.verifyDesc"),
            install: "npm install @payjarvis/verify-sdk",
            code: `import { verifyBdit } from '@payjarvis/verify-sdk'

// Verify a BDIT token at checkout (merchant-side)
const result = await verifyBdit({
  token: req.headers['x-bdit-token'],
  merchantId: 'your-merchant-id',
})

if (result.verified) {
  // Bot is certified — trust score: result.trustScore
  // Owner: result.ownerId
  // Allow checkout
}`,
          },
          {
            name: "@payjarvis/merchant-sdk",
            desc: t("docs.sdk.merchantDesc"),
            install: "npm install @payjarvis/merchant-sdk",
            code: `import { PayJarvisMerchant } from '@payjarvis/merchant-sdk'

const merchant = new PayJarvisMerchant({
  merchantKey: 'your-merchant-key',
  webhookSecret: 'whsec_xxxx',
})

// Verify incoming bot at checkout
const verification = await merchant.verifyBot(req)

// Confirm a purchase was completed
await merchant.confirmPurchase({
  jti: verification.jti,
  amount: 149.99,
  orderId: 'ORD-12345',
})`,
          },
        ].map((sdk) => (
          <div key={sdk.name} className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-2 flex items-center gap-3">
              <span className="rounded-lg bg-brand-600/20 px-3 py-1 text-sm font-mono font-semibold text-brand-400">
                {sdk.name}
              </span>
            </div>
            <p className="mb-4 text-sm text-gray-400">{sdk.desc}</p>
            <div className="space-y-3">
              <CodeBlock code={sdk.install} lang="bash" />
              <CodeBlock code={sdk.code} lang="typescript" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApiSection({ t }: { t: (k: string) => string }) {
  const groups = [
    {
      title: t("docs.api.botsTitle"),
      routes: [
        { method: "POST", path: "/api/bots", desc: t("docs.api.createBot"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/bots", desc: t("docs.api.listBots"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/bots/:botId", desc: t("docs.api.getBot"), auth: "Clerk JWT" },
        { method: "PATCH", path: "/api/bots/:botId", desc: t("docs.api.updateBot"), auth: "Clerk JWT" },
        { method: "PATCH", path: "/api/bots/:botId/status", desc: t("docs.api.botStatus"), auth: "Clerk JWT" },
        { method: "DELETE", path: "/api/bots/:botId", desc: t("docs.api.deleteBot"), auth: "Clerk JWT" },
      ],
    },
    {
      title: t("docs.api.paymentsTitle"),
      routes: [
        { method: "POST", path: "/api/bots/:botId/request-payment", desc: t("docs.api.requestPayment"), auth: "Bot API Key" },
        { method: "GET", path: "/api/transactions", desc: t("docs.api.listTx"), auth: "Clerk JWT" },
        { method: "POST", path: "/api/transactions/export/pdf", desc: t("docs.api.exportPdf"), auth: "Clerk JWT" },
      ],
    },
    {
      title: t("docs.api.approvalsTitle"),
      routes: [
        { method: "GET", path: "/api/approvals", desc: t("docs.api.listApprovals"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/approvals/stream", desc: t("docs.api.sseApprovals"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/approvals/stream/bot", desc: t("docs.api.sseBotApprovals"), auth: "Bot API Key" },
        { method: "POST", path: "/api/approvals/:id/respond", desc: t("docs.api.respondApproval"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/approvals/:id/status", desc: t("docs.api.approvalStatus"), auth: "Bot API Key" },
      ],
    },
    {
      title: t("docs.api.identityTitle"),
      routes: [
        { method: "GET", path: "/v1/agents/:agentId/verify", desc: t("docs.api.verifyAgent"), auth: "None" },
        { method: "POST", path: "/api/agents/:agentId/token", desc: t("docs.api.issueAit"), auth: "Clerk JWT" },
        { method: "GET", path: "/.well-known/jwks.json", desc: t("docs.api.jwks"), auth: "None" },
        { method: "GET", path: "/api/bdit/status/:jti", desc: t("docs.api.bditStatus"), auth: "None" },
      ],
    },
    {
      title: t("docs.api.governanceTitle"),
      routes: [
        { method: "GET", path: "/api/core/policy/:botId", desc: t("docs.api.getPolicy"), auth: "Clerk JWT" },
        { method: "PUT", path: "/api/core/policy/:botId", desc: t("docs.api.updatePolicy"), auth: "Clerk JWT" },
        { method: "GET", path: "/api/core/audit/:botId", desc: t("docs.api.auditLog"), auth: "Clerk JWT" },
        { method: "POST", path: "/api/core/execute", desc: t("docs.api.executeAction"), auth: "Clerk JWT" },
      ],
    },
    {
      title: t("docs.api.commerceTitle"),
      routes: [
        { method: "POST", path: "/api/commerce/flights/search", desc: t("docs.api.searchFlights"), auth: "Any" },
        { method: "POST", path: "/api/commerce/hotels/search", desc: t("docs.api.searchHotels"), auth: "Any" },
        { method: "POST", path: "/api/commerce/restaurants/search", desc: t("docs.api.searchRestaurants"), auth: "Any" },
        { method: "POST", path: "/api/commerce/products/search", desc: t("docs.api.searchProducts"), auth: "Any" },
        { method: "POST", path: "/api/retail/search", desc: t("docs.api.retailSearch"), auth: "Any" },
        { method: "POST", path: "/api/retail/compare", desc: t("docs.api.retailCompare"), auth: "Any" },
      ],
    },
  ];

  const methodColors: Record<string, string> = {
    GET: "bg-green-600/20 text-green-400",
    POST: "bg-blue-600/20 text-blue-400",
    PUT: "bg-yellow-600/20 text-yellow-400",
    PATCH: "bg-orange-600/20 text-orange-400",
    DELETE: "bg-red-600/20 text-red-400",
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-2 text-xl font-bold">{t("docs.api.title")}</h3>
        <p className="text-gray-400 leading-relaxed">{t("docs.api.desc")}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="rounded bg-brand-600/20 px-2 py-0.5 text-xs font-mono text-brand-400">
            Base URL
          </span>
          <code className="text-sm text-gray-300">https://www.payjarvis.com</code>
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.title}>
          <h4 className="mb-3 text-lg font-semibold">{group.title}</h4>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-500 w-20">{t("docs.api.method")}</th>
                  <th className="px-4 py-3 font-medium text-gray-500">{t("docs.api.endpoint")}</th>
                  <th className="hidden px-4 py-3 font-medium text-gray-500 sm:table-cell">{t("docs.api.description")}</th>
                  <th className="hidden px-4 py-3 font-medium text-gray-500 md:table-cell">{t("docs.api.authCol")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {group.routes.map((r, i) => (
                  <tr key={i} className="bg-white hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-bold ${methodColors[r.method] || ""}`}>
                        {r.method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{r.path}</td>
                    <td className="hidden px-4 py-2.5 text-gray-500 sm:table-cell">{r.desc}</td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{r.auth}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-6">
        <p className="text-sm text-gray-400">
          {t("docs.api.fullRef")}
        </p>
      </div>
    </div>
  );
}

function WebhooksSection({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-4 text-xl font-bold">{t("docs.wh.title")}</h3>
        <p className="text-gray-400 leading-relaxed">{t("docs.wh.desc")}</p>
      </div>

      <div>
        <h4 className="mb-3 font-semibold">{t("docs.wh.eventsTitle")}</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { event: "payment.approved", desc: t("docs.wh.paymentApproved") },
            { event: "payment.blocked", desc: t("docs.wh.paymentBlocked") },
            { event: "payment.pending", desc: t("docs.wh.paymentPending") },
            { event: "approval.responded", desc: t("docs.wh.approvalResponded") },
            { event: "bot.status_changed", desc: t("docs.wh.botStatusChanged") },
            { event: "trust_score.updated", desc: t("docs.wh.trustUpdated") },
          ].map((e) => (
            <div key={e.event} className="rounded-lg border border-gray-200 bg-white p-4">
              <code className="text-sm font-semibold text-brand-400">{e.event}</code>
              <p className="mt-1 text-xs text-gray-400">{e.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-3 font-semibold">{t("docs.wh.verifyTitle")}</h4>
        <CodeBlock
          lang="typescript"
          code={`import crypto from 'crypto'

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  )
}

// In your webhook handler:
app.post('/webhook/payjarvis', (req, res) => {
  const sig = req.headers['x-payjarvis-signature'] as string
  const valid = verifyWebhook(JSON.stringify(req.body), sig, WEBHOOK_SECRET)

  if (!valid) return res.status(401).send('Invalid signature')

  const { event, data } = req.body

  switch (event) {
    case 'payment.approved':
      console.log('Payment approved:', data.transactionId)
      break
    case 'payment.blocked':
      console.log('Payment blocked:', data.reason)
      break
    case 'approval.responded':
      console.log('Human decision:', data.status)
      break
  }

  res.status(200).send('OK')
})`}
        />
      </div>

      <div>
        <h4 className="mb-3 font-semibold">{t("docs.wh.payloadTitle")}</h4>
        <CodeBlock
          lang="json"
          code={`{
  "event": "payment.approved",
  "timestamp": "2026-04-03T14:30:00Z",
  "data": {
    "transactionId": "txn_abc123",
    "botId": "bot_xyz789",
    "amount": 49.99,
    "currency": "USD",
    "merchantName": "Amazon",
    "category": "shopping",
    "decision": "APPROVED",
    "trustScore": 850,
    "layer": 1
  }
}`}
        />
      </div>
    </div>
  );
}

export default function DocsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("quickstart");

  const sections: Record<Tab, React.ReactNode> = {
    quickstart: <QuickStartSection t={t} />,
    auth: <AuthSection t={t} />,
    sdk: <SdkSection t={t} />,
    api: <ApiSection t={t} />,
    webhooks: <WebhooksSection t={t} />,
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-6 py-20 text-center">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-600/20 via-transparent to-blue-600/10" />
        <div className="relative mx-auto max-w-3xl">
          <div className="mb-4 inline-block rounded-full bg-brand-600/20 px-4 py-1 text-sm text-brand-400">
            {t("docs.badge")}
          </div>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
            {t("docs.title")}{" "}
            <span className="text-brand-400">{t("docs.titleHighlight")}</span>
          </h1>
          <p className="mt-6 text-lg text-gray-400">
            {t("docs.subtitle")}
          </p>
        </div>
      </section>

      {/* Tab navigation */}
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                activeTab === tab
                  ? "bg-white text-brand-400 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={tabIcons[tab]} />
              </svg>
              {t(`docs.tab.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        {sections[activeTab]}
      </section>

      {/* Help CTA */}
      <section className="mx-auto max-w-3xl px-6 pb-16">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h3 className="text-xl font-bold">{t("docs.helpTitle")}</h3>
          <p className="mt-2 text-gray-400">{t("docs.helpDesc")}</p>
          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="mailto:dev@payjarvis.com"
              className="rounded-lg bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-500"
            >
              {t("docs.helpEmail")}
            </a>
            <a
              href="/partners"
              className="rounded-lg border border-gray-200 px-6 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
            >
              {t("docs.helpPartners")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
