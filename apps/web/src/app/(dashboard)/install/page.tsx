"use client";

import { useState } from "react";

const tabs = ["HTML", "WooCommerce", "Shopify", "API Direta"] as const;
type Tab = (typeof tabs)[number];

export default function InstallPage() {
  const [activeTab, setActiveTab] = useState<Tab>("HTML");
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

  const jsVerify = `// Node.js — verificar BDIT token
const res = await fetch('https://api.payjarvis.com/v1/verify', {
  headers: {
    'X-Bdit-Token': token,
    'X-Merchant-Id': '${merchantId}',
  },
});
const result = await res.json();

if (result.verified) {
  console.log('Bot verificado:', result.bot);
  console.log('Autorização:', result.authorization);
  // Liberar checkout
} else {
  console.log('Token inválido:', result.error);
  // Bloquear checkout
}`;

  const sdkInstall = `npm install @payjarvis/merchant-sdk`;

  const sdkCode = `import { PayjarvisVerifier } from '@payjarvis/merchant-sdk';

const verifier = new PayjarvisVerifier({
  merchantId: '${merchantId}',
  jwksUrl: 'https://api.payjarvis.com/.well-known/jwks.json',
});

// No checkout:
const result = await verifier.verify(token);
if (result.valid) {
  // Bot autorizado — liberar checkout
}`;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white">Instalar PayJarvis</h2>
        <p className="text-sm text-gray-500 mt-1">
          Integre a verificação de bots no seu e-commerce
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-card border border-surface-border rounded-lg p-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-2 text-sm rounded-md transition-colors ${
              activeTab === tab
                ? "bg-brand-600 text-white font-medium"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* HTML Tab */}
      {activeTab === "HTML" && (
        <div className="space-y-6">
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">
              Adicione a tag script ao seu checkout
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Cole antes do &lt;/body&gt; na página de checkout. O script detecta
              automaticamente tokens BDIT e verifica a identidade do bot.
            </p>
            <div className="relative">
              <pre className="bg-surface border border-surface-border rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
                {htmlCode}
              </pre>
              <button
                onClick={() => handleCopy(htmlCode, "html")}
                className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
                  copiedBlock === "html"
                    ? "bg-approved/20 text-approved"
                    : "bg-surface-hover text-gray-400 hover:text-white"
                }`}
              >
                {copiedBlock === "html" ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Substitua <code className="text-brand-400">YOUR_MERCHANT_ID</code> pelo
              seu ID de merchant.
            </p>
          </div>
        </div>
      )}

      {/* WooCommerce Tab */}
      {activeTab === "WooCommerce" && (
        <div className="space-y-6">
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Plugin WooCommerce</h3>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <button className="px-4 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-500 transition-colors">
                  Baixar Plugin (.zip)
                </button>
                <span className="text-xs text-gray-500">v1.0.0 — WordPress 6.0+</span>
              </div>

              <div className="border-t border-surface-border pt-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Instruções de instalação
                </h4>
                <ol className="space-y-2 text-sm text-gray-300">
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">1.</span>
                    Faça o download do plugin .zip acima
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">2.</span>
                    No WordPress, vá em Plugins &gt; Adicionar Novo &gt; Enviar Plugin
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">3.</span>
                    Faça upload do .zip e clique em Instalar Agora
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">4.</span>
                    Ative o plugin
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">5.</span>
                    Vá em WooCommerce &gt; Settings &gt; PayJarvis
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">6.</span>
                    Configure seu Merchant ID e API Key
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shopify Tab */}
      {activeTab === "Shopify" && (
        <div className="space-y-6">
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Shopify Extension</h3>
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                O app PayJarvis para Shopify adiciona verificação de bot automaticamente
                no checkout.
              </p>

              <div className="border-t border-surface-border pt-4">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Como instalar
                </h4>
                <ol className="space-y-2 text-sm text-gray-300">
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">1.</span>
                    Acesse a Shopify App Store e busque &quot;PayJarvis&quot;
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">2.</span>
                    Clique em Instalar e autorize o acesso
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">3.</span>
                    Configure seu Merchant ID nas configurações do app
                  </li>
                  <li className="flex gap-2">
                    <span className="text-brand-400 font-mono">4.</span>
                    A verificação de bots será ativada automaticamente no checkout
                  </li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Direta Tab */}
      {activeTab === "API Direta" && (
        <div className="space-y-6">
          {/* SDK Install */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">SDK (recomendado)</h3>
            <div className="relative mb-4">
              <pre className="bg-surface border border-surface-border rounded-lg p-4 text-xs text-green-400 font-mono">
                {sdkInstall}
              </pre>
              <button
                onClick={() => handleCopy(sdkInstall, "sdk-install")}
                className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
                  copiedBlock === "sdk-install"
                    ? "bg-approved/20 text-approved"
                    : "bg-surface-hover text-gray-400 hover:text-white"
                }`}
              >
                {copiedBlock === "sdk-install" ? "Copiado!" : "Copiar"}
              </button>
            </div>
            <div className="relative">
              <pre className="bg-surface border border-surface-border rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
                {sdkCode}
              </pre>
              <button
                onClick={() => handleCopy(sdkCode, "sdk-code")}
                className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
                  copiedBlock === "sdk-code"
                    ? "bg-approved/20 text-approved"
                    : "bg-surface-hover text-gray-400 hover:text-white"
                }`}
              >
                {copiedBlock === "sdk-code" ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>

          {/* cURL */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">cURL</h3>
            <div className="relative">
              <pre className="bg-surface border border-surface-border rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
                {curlVerify}
              </pre>
              <button
                onClick={() => handleCopy(curlVerify, "curl")}
                className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
                  copiedBlock === "curl"
                    ? "bg-approved/20 text-approved"
                    : "bg-surface-hover text-gray-400 hover:text-white"
                }`}
              >
                {copiedBlock === "curl" ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>

          {/* JavaScript */}
          <div className="bg-surface-card border border-surface-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">JavaScript / Node.js</h3>
            <div className="relative">
              <pre className="bg-surface border border-surface-border rounded-lg p-4 text-xs text-green-400 font-mono overflow-x-auto">
                {jsVerify}
              </pre>
              <button
                onClick={() => handleCopy(jsVerify, "js")}
                className={`absolute top-2 right-2 px-2 py-1 text-xs rounded transition-colors ${
                  copiedBlock === "js"
                    ? "bg-approved/20 text-approved"
                    : "bg-surface-hover text-gray-400 hover:text-white"
                }`}
              >
                {copiedBlock === "js" ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
