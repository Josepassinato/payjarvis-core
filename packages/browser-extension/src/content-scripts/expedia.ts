/**
 * PayJarvis Content Script — Expedia
 *
 * Detecta páginas de checkout na Expedia e solicita
 * aprovação do Payjarvis antes de confirmar a reserva.
 */

import {
  requestApproval,
  getConfig,
  getSessionId,
  parseAmount,
  showBanner,
  onUrlChange,
} from "./shared.js";

const MERCHANT_ID = "expedia";
const MERCHANT_NAME = "Expedia";

async function init(): Promise<void> {
  const config = await getConfig();
  if (!config.enabled || !config.botApiKey) return;

  checkPage();
  onUrlChange(() => checkPage());
}

function checkPage(): void {
  const url = location.href;

  if (
    url.includes("/checkout") ||
    url.includes("/TripDetails") ||
    url.includes("/payment")
  ) {
    setTimeout(() => interceptBooking(), 2000);
  }
}

function interceptBooking(): void {
  const bookBtn =
    document.querySelector<HTMLElement>(
      'button[data-stid="complete-booking-btn"], ' +
      'button[data-testid="complete-booking"], ' +
      '#complete-booking, ' +
      '.complete-booking button'
    );

  if (!bookBtn) return;
  if (bookBtn.dataset.payjarvisIntercepted === "true") return;
  bookBtn.dataset.payjarvisIntercepted = "true";

  const amount = extractTripTotal();
  const description = extractTripInfo();
  const category = detectCategory();

  bookBtn.addEventListener(
    "click",
    async (e) => {
      if (bookBtn.dataset.payjarvisApproved === "true") return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (amount === null) {
        showBanner("error", "Não foi possível detectar o valor.");
        return;
      }

      showBanner("pending", "Verificando autorização de pagamento...");

      const decision = await requestApproval({
        merchantId: MERCHANT_ID,
        merchantName: MERCHANT_NAME,
        amount,
        currency: "USD",
        category,
        description,
        sessionId: getSessionId(),
        url: location.href,
      });

      if (decision.status === "APPROVED") {
        showBanner("approved", decision.message);
        bookBtn.dataset.payjarvisApproved = "true";
        bookBtn.click();
      } else if (decision.status === "BLOCKED") {
        showBanner("blocked", decision.message);
      } else if (decision.status === "PENDING_HUMAN_APPROVAL") {
        showBanner("pending", decision.message);
      } else {
        showBanner("error", decision.message);
      }
    },
    { capture: true }
  );
}

function extractTripTotal(): number | null {
  const selectors = [
    '[data-stid="price-summary-total"] .uitk-text',
    ".trip-total .uitk-text",
    '[data-testid="trip-total"]',
    ".price-summary-total",
    "#price-summary .total",
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

function extractTripInfo(): string {
  // Tentar extrair nome do hotel/voo/carro
  const title =
    document.querySelector("h1")?.textContent?.trim() ??
    document.querySelector('[data-stid="content-hotel-title"]')?.textContent?.trim() ??
    document.querySelector(".trip-header")?.textContent?.trim();

  return title ?? "Expedia booking";
}

function detectCategory(): string {
  const url = location.href.toLowerCase();
  const pageText = document.body.textContent?.toLowerCase() ?? "";

  if (url.includes("flight") || pageText.includes("flight")) return "travel";
  if (url.includes("hotel") || url.includes("lodging")) return "accommodation";
  if (url.includes("car") || url.includes("rental")) return "transport";
  if (url.includes("cruise")) return "travel";
  if (url.includes("activity") || url.includes("things-to-do")) return "travel";

  return "travel";
}

init();
