/**
 * PayJarvis Content Script — Amazon
 *
 * Detecta páginas de checkout na Amazon e solicita
 * aprovação do Payjarvis antes de permitir o "Place Order".
 */

import {
  requestApproval,
  getConfig,
  getSessionId,
  parseAmount,
  showBanner,
  onUrlChange,
} from "./shared.js";

const MERCHANT_ID = "amazon";
const MERCHANT_NAME = "Amazon";

async function init(): Promise<void> {
  const config = await getConfig();
  if (!config.enabled || !config.botApiKey) return;

  checkPage();
  onUrlChange(() => checkPage());
}

function checkPage(): void {
  const url = location.href;

  // Detectar páginas de checkout
  if (
    url.includes("/gp/buy/") ||
    url.includes("/checkout/") ||
    url.includes("/gp/cart/") ||
    url.includes("placeYourOrder")
  ) {
    interceptCheckout();
  }
}

function interceptCheckout(): void {
  // Encontrar o botão "Place your order"
  const placeOrderBtn =
    document.getElementById("submitOrderButtonId") ??
    document.getElementById("placeYourOrder") ??
    document.querySelector<HTMLElement>(
      '[name="placeYourOrder1"], .place-your-order-button, #turbo-checkout-place-order-button'
    );

  if (!placeOrderBtn) return;

  // Verificar se já interceptamos
  if (placeOrderBtn.dataset.payjarvisIntercepted === "true") return;
  placeOrderBtn.dataset.payjarvisIntercepted = "true";

  // Extrair valor total
  const amount = extractOrderTotal();

  if (amount === null) {
    // Sem valor detectado, não interceptar
    return;
  }

  // Extrair descrição dos itens
  const description = extractItemDescription();

  // Interceptar click no botão
  placeOrderBtn.addEventListener(
    "click",
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      showBanner("pending", "Verificando autorização de pagamento...");

      const decision = await requestApproval({
        merchantId: MERCHANT_ID,
        merchantName: MERCHANT_NAME,
        amount,
        currency: "USD",
        category: "shopping",
        description,
        sessionId: getSessionId(),
        url: location.href,
      });

      if (decision.status === "APPROVED") {
        showBanner("approved", decision.message);
        // Re-clicar sem interceptação
        placeOrderBtn.dataset.payjarvisApproved = "true";
        placeOrderBtn.click();
      } else if (decision.status === "BLOCKED") {
        showBanner("blocked", decision.message);
      } else if (decision.status === "PENDING_HUMAN_APPROVAL") {
        showBanner("pending", decision.message);
      } else {
        showBanner("error", decision.message);
      }
    },
    { capture: true, once: false }
  );

  // Permitir re-click após aprovação
  placeOrderBtn.addEventListener(
    "click",
    (e) => {
      if (placeOrderBtn.dataset.payjarvisApproved !== "true") {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    { capture: true }
  );
}

function extractOrderTotal(): number | null {
  // Seletores conhecidos do Amazon checkout
  const selectors = [
    "#subtotals-marketplace-table .grand-total-price",
    ".order-summary .grand-total-price",
    "#bottomSubmitOrderButtonId-announce .a-color-price",
    ".grand-total-price",
    "#subtotals-marketplace-table td.a-text-right.a-nowrap .a-color-price",
    ".order-summary-line-item-amount .a-color-price",
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent) {
      const amount = parseAmount(el.textContent);
      if (amount !== null && amount > 0) return amount;
    }
  }

  return null;
}

function extractItemDescription(): string {
  const items: string[] = [];
  const itemEls = document.querySelectorAll(
    ".item-title, .shipping-group-item-title, .a-truncate-cut"
  );

  for (const el of itemEls) {
    const text = el.textContent?.trim();
    if (text && text.length > 3) {
      items.push(text.slice(0, 80));
    }
  }

  if (items.length === 0) return "Amazon purchase";
  if (items.length === 1) return items[0];
  return `${items[0]} + ${items.length - 1} more items`;
}

// Iniciar
init();
