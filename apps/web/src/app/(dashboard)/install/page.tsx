"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

type MerchantTab = "HTML" | "WooCommerce" | "Shopify" | "API";
type BotTab = "openclaw" | "api" | "coming";

export default function InstallPage() {
  const { t } = useTranslation();
  const merchantTabs: MerchantTab[] = ["HTML", "WooCommerce", "Shopify", "API"];
  const [activeTab, setActiveTab] = useState<MerchantTab>("HTML");
  const [activeBotTab, setActiveBotTab] = useState<BotTab>("openclaw");
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const merchantId = "YOUR_MERCHANT_ID";

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedBlock(id);
    setTimeout(() => setCopiedBlock(null), 2000);
  };

  const htmlCode = `<!-- PayJarvis Bot Verification -->
<script
  src="https://api.payjarvis.com/adapter.js"
  data-merchant="${merchantId}"
  async
></script>`;

  const curlVerify = `curl -X GET https://api.payjarvis.com/v1/verify \\
  -H "X-Bdit-Token: \${BDIT_TOKEN}" \\
  -H "X-Merchant-Id: ${merchantId}"`;

  const jsVerify = `// Node.js — verify BDIT token
const res = await fetch('https://api.payjarvis.com/v1/verify', {
  headers: {
    'X-Bdit-Token': token,
    'X-Merchant-Id': '${merchantId}',
  },
});
const result = await res.json();

if (result.verified) {
  console.log('Bot verified:', result.bot);
  console.log('Authorization:', result.authorization);
  // Allow checkout
} else {
  console.log('Invalid token:', result.error);
  // Block checkout
}`;

  const sdkInstall = `npm install @payjarvis/merchant-sdk`;

  const sdkCode = `import { PayjarvisVerifier } from '@payjarvis/merchant-sdk';

const verifier = new PayjarvisVerifier({
  merchantId: '${merchantId}',
  jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json',
});

// At checkout:
const result = await verifier.verify(token);
if (result.valid) {
  // Bot authorized — allow checkout
}`;

  const requestPaymentSnippet = `import { PayJarvis } from "@payjarvis/agent-sdk";

const pj = new PayJarvis({ apiKey: "pj_bot_...", botId: "..." });

const decision = await pj.requestPayment({
  merchantName: "Amazon",
  amount: 29.99,
  currency: "USD",
  category: "shopping",
});

if (decision.approved) {
  // BDIT token em decision.bditToken
  // Apresente ao merchant no checkout
}`;

  const browserAgentConnect = `curl -X POST https://www.payjarvis.com/api/browser-agent/connect \\
  -H "Content-Type: application/json" \\
  -d '{
    "botApiKey": "pj_bot_...",
    "botId": "YOUR_BOT_ID"
  }'`;

  const browserAgentStatus = `curl https://www.payjarvis.com/api/browser-agent/status`;

  const openclawSnippet = `# 1. Start Chrome with CDP
google-chrome-stable --headless=new --remote-debugging-port=18800 --no-sandbox

# 2. Configure your OpenClaw / ClawdBot agent
#    Set the following environment variables:
export PAYJARVIS_API_KEY="pj_bot_..."
export PAYJARVIS_BOT_ID="YOUR_BOT_ID"
export CDP_URL="http://localhost:18800"

# 3. Connect to PayJarvis Browser Agent
curl -X POST https://www.payjarvis.com/api/browser-agent/connect \\
  -H "Content-Type: application/json" \\
  -d '{
    "botApiKey": "'$PAYJARVIS_API_KEY'",
    "botId": "'$PAYJARVIS_BOT_ID'"
  }'`;

  const apiGenericCurl = `# cURL
curl -X POST https://api.payjarvis.com/v1/request-payment \\
  -H "Authorization: Bearer pj_bot_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "botId": "YOUR_BOT_ID",
    "merchantName": "Amazon",
    "amount": 29.99,
    "currency": "USD",
    "category": "shopping"
  }'`;

  const apiGenericPython = `# Python
import requests

resp = requests.post(
    "https://api.payjarvis.com/v1/request-payment",
    headers={"Authorization": "Bearer pj_bot_..."},
    json={
        "botId": "YOUR_BOT_ID",
        "merchantName": "Amazon",
        "amount": 29.99,
        "currency": "USD",
        "category": "shopping",
    },
)
decision = resp.json()
if decision["approved"]:
    bdit_token = decision["bditToken"]`;

  const apiGenericNode = `// Node.js
const resp = await fetch("https://api.payjarvis.com/v1/request-payment", {
  method: "POST",
  headers: {
    "Authorization": "Bearer pj_bot_...",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    botId: "YOUR_BOT_ID",
    merchantName: "Amazon",
    amount: 29.99,
    currency: "USD",
    category: "shopping",
  }),
});
const decision = await resp.json();
if (decision.approved) {
  // Use decision.bditToken at checkout
}`;

  const CopyButton = ({ text, id }: { text: string; id: string }) => (
    <button
      onClick={() => handleCopy(text, id)}
      className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
        copiedBlock === id
          ? "bg-approved/20 text-approved"
          : "bg-gray-100 text-gray-400 hover:text-gray-900"
      }`}
    >
      {copiedBlock === id ? t("common.copied") : t("common.copy")}
    </button>
  );

  const CodeBlock = ({ code, id }: { code: string; id: string }) => (
    <div className="relative">
      <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
        {code}
      </pre>
      <CopyButton text={code} id={id} />
    </div>
  );

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">{t("install.title")}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {t("install.subtitle")}
        </p>
      </div>

      {/* ─── SECTION: Bot Integration Guide ─── */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Bot Integration Guide</h3>

        {/* Bot type tabs */}
        <div className="flex flex-wrap gap-1 mb-6 bg-white border border-gray-200 rounded-lg p-1">
          {([
            { key: "openclaw" as BotTab, label: "OpenClaw / ClawdBot" },
            { key: "api" as BotTab, label: "API (curl / Python / Node)" },
            { key: "coming" as BotTab, label: "Coming Soon" },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveBotTab(tab.key)}
              className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${
                activeBotTab === tab.key
                  ? "bg-brand-600 text-gray-900 font-medium"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* OpenClaw / ClawdBot */}
        {activeBotTab === "openclaw" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">OpenClaw / ClawdBot Setup</h4>
              <p className="text-xs text-gray-500 mb-4">
                Connect your OpenClaw or ClawdBot agent to PayJarvis for autonomous purchases.
              </p>
              <CodeBlock code={openclawSnippet} id="openclaw" />
            </div>
          </div>
        )}

        {/* API genérica */}
        {activeBotTab === "api" && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">cURL</h4>
              <CodeBlock code={apiGenericCurl} id="api-curl" />
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">Python</h4>
              <CodeBlock code={apiGenericPython} id="api-python" />
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-gray-300 mb-3">Node.js</h4>
              <CodeBlock code={apiGenericNode} id="api-node" />
            </div>
          </div>
        )}

        {/* Coming Soon */}
        {activeBotTab === "coming" && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-3">Coming Soon</h4>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs bg-pending/20 text-pending px-2 py-0.5 rounded font-medium">Soon</span>
                <span>Perplexity</span>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <span className="text-xs bg-pending/20 text-pending px-2 py-0.5 rounded font-medium">Soon</span>
                <span>GPT Actions (OpenAI)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── SECTION: Connect your bot to browser agent ─── */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Connect your bot to browser agent</h3>
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">1. Start Chrome with CDP</h4>
            <p className="text-xs text-gray-500 mb-3">
              Your bot needs Chrome running with the Chrome DevTools Protocol enabled.
            </p>
            <CodeBlock
              code="google-chrome-stable --headless=new --remote-debugging-port=18800 --no-sandbox"
              id="cdp-chrome"
            />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">2. Connect to PayJarvis Browser Agent</h4>
            <p className="text-xs text-gray-500 mb-3">
              Register your bot with the browser agent endpoint.
            </p>
            <CodeBlock code={browserAgentConnect} id="browser-connect" />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h4 className="text-sm font-semibold text-gray-300 mb-2">3. Check status</h4>
            <p className="text-xs text-gray-500 mb-3">
              Verify that your bot is connected and healthy.
            </p>
            <CodeBlock code={browserAgentStatus} id="browser-status" />
          </div>
        </div>
      </div>

      {/* ─── SECTION: request-payment example ─── */}
      <div className="mb-10">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">SDK: requestPayment example</h3>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-xs text-gray-500 mb-3">
            Full example using the <code className="text-brand-400">@payjarvis/agent-sdk</code> to request a payment and receive a BDIT token.
          </p>
          <CodeBlock code={requestPaymentSnippet} id="request-payment" />
        </div>
      </div>

      {/* ─── SECTION: Merchant Integration ─── */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t("install.title")}</h3>
        <p className="text-sm text-gray-500 mb-4">
          {t("install.subtitle")}
        </p>
      </div>

      {/* Merchant Tabs */}
      <div className="flex flex-wrap gap-1 mb-6 bg-white border border-gray-200 rounded-lg p-1">
        {merchantTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${
              activeTab === tab
                ? "bg-brand-600 text-gray-900 font-medium"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab === "API" ? t("install.apiTab") : tab}
          </button>
        ))}
      </div>

      {/* HTML Tab */}
      {activeTab === "HTML" && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              {t("install.htmlTitle")}
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              {t("install.htmlDesc")}
            </p>
            <CodeBlock code={htmlCode} id="html" />
            <p className="text-xs text-gray-600 mt-3">
              {t("install.htmlReplace")}
            </p>
          </div>
        </div>
      )}

      {/* WooCommerce Tab */}
      {activeTab === "WooCommerce" && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("install.wooTitle")}</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <button className="px-4 py-2.5 bg-brand-600 text-gray-900 text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors">
                  {t("install.wooDownload")}
                </button>
                <span className="text-xs text-gray-500">{t("install.wooVersion")}</span>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  {t("install.wooInstructions")}
                </h4>
                <ol className="space-y-2 text-sm text-gray-300">
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">1.</span>{t("install.woo1")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">2.</span>{t("install.woo2")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">3.</span>{t("install.woo3")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">4.</span>{t("install.woo4")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">5.</span>{t("install.woo5")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">6.</span>{t("install.woo6")}</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shopify Tab */}
      {activeTab === "Shopify" && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("install.shopifyTitle")}</h3>
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                {t("install.shopifyDesc")}
              </p>

              <div className="border-t border-gray-200 pt-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  {t("install.shopifyHow")}
                </h4>
                <ol className="space-y-2 text-sm text-gray-300">
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">1.</span>{t("install.shopify1")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">2.</span>{t("install.shopify2")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">3.</span>{t("install.shopify3")}</li>
                  <li className="flex gap-2"><span className="text-brand-400 font-mono">4.</span>{t("install.shopify4")}</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Tab */}
      {activeTab === "API" && (
        <div className="space-y-6">
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("install.sdkTitle")}</h3>
            <div className="relative mb-4">
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-xs text-green-400 font-mono">
                {sdkInstall}
              </pre>
              <CopyButton text={sdkInstall} id="sdk-install" />
            </div>
            <CodeBlock code={sdkCode} id="sdk-code" />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("install.curlTitle")}</h3>
            <CodeBlock code={curlVerify} id="curl" />
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t("install.jsTitle")}</h3>
            <CodeBlock code={jsVerify} id="js" />
          </div>
        </div>
      )}
    </div>
  );
}
