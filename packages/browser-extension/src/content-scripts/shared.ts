/**
 * Utilitários compartilhados entre content scripts.
 */

import type { PaymentRequest, PaymentDecision, PayjarvisConfig } from "../types.js";

/**
 * Solicita aprovação de pagamento via background service worker.
 */
export async function requestApproval(
  request: PaymentRequest
): Promise<PaymentDecision> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "REQUEST_PAYMENT_APPROVAL", payload: request },
      (response: PaymentDecision) => resolve(response)
    );
  });
}

/**
 * Busca config da extensão.
 */
export async function getConfig(): Promise<PayjarvisConfig> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "GET_CONFIG" },
      (response: PayjarvisConfig) => resolve(response)
    );
  });
}

/**
 * Gera um session ID único para esta sessão de navegação.
 */
export function getSessionId(): string {
  let sessionId = sessionStorage.getItem("payjarvis_session_id");
  if (!sessionId) {
    sessionId = `ext_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem("payjarvis_session_id", sessionId);
  }
  return sessionId;
}

/**
 * Parseia um valor monetário de uma string.
 * Suporta formatos: $99.99, R$99,99, USD 99.99, etc.
 */
export function parseAmount(text: string): number | null {
  // Remover símbolos de moeda e espaços
  const cleaned = text
    .replace(/[A-Z]{3}\s*/g, "")
    .replace(/[R$€£¥₹\s]/g, "")
    .trim();

  // Detectar formato BR (1.234,56) vs US (1,234.56)
  const hasBrFormat = /\d+\.\d{3}/.test(cleaned) && cleaned.includes(",");

  if (hasBrFormat) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const val = parseFloat(normalized);
    return isNaN(val) ? null : val;
  }

  const normalized = cleaned.replace(/,/g, "");
  const val = parseFloat(normalized);
  return isNaN(val) ? null : val;
}

/**
 * Injeta um banner de status na página.
 */
export function showBanner(
  status: "approved" | "blocked" | "pending" | "error",
  message: string
): void {
  // Remover banner anterior se existir
  document.getElementById("payjarvis-banner")?.remove();

  const colors = {
    approved: { bg: "#dcfce7", border: "#16a34a", text: "#15803d" },
    blocked: { bg: "#fef2f2", border: "#dc2626", text: "#dc2626" },
    pending: { bg: "#fefce8", border: "#ca8a04", text: "#a16207" },
    error: { bg: "#fef2f2", border: "#dc2626", text: "#dc2626" },
  };

  const c = colors[status];

  const banner = document.createElement("div");
  banner.id = "payjarvis-banner";
  banner.setAttribute(
    "style",
    `position:fixed;top:0;left:0;right:0;z-index:999999;` +
    `padding:12px 20px;background:${c.bg};border-bottom:2px solid ${c.border};` +
    `color:${c.text};font-family:system-ui,sans-serif;font-size:14px;` +
    `display:flex;align-items:center;justify-content:space-between;` +
    `box-shadow:0 2px 8px rgba(0,0,0,0.1);`
  );

  const icon = status === "approved" ? "\u2705"
    : status === "blocked" ? "\u26D4"
    : status === "pending" ? "\u23F3"
    : "\u26A0\uFE0F";

  banner.innerHTML =
    `<span><strong>${icon} PayJarvis:</strong> ${escapeHtml(message)}</span>` +
    `<button id="payjarvis-banner-close" style="background:none;border:none;` +
    `cursor:pointer;font-size:18px;color:${c.text};padding:0 4px;">&times;</button>`;

  document.body.prepend(banner);

  document.getElementById("payjarvis-banner-close")?.addEventListener("click", () => {
    banner.remove();
  });

  // Auto-remover após 15s para approved/error
  if (status === "approved" || status === "error") {
    setTimeout(() => banner.remove(), 15000);
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Observa mudanças na URL (para SPAs).
 */
export function onUrlChange(callback: (url: string) => void): void {
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      callback(lastUrl);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
