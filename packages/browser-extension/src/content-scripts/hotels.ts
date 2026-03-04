/**
 * PayJarvis Content Script — Hotels.com
 *
 * Detecta páginas de booking no Hotels.com e solicita
 * aprovação do Payjarvis antes de confirmar reserva.
 */

import {
  requestApproval,
  getConfig,
  getSessionId,
  parseAmount,
  showBanner,
  onUrlChange,
} from "./shared.js";

const MERCHANT_ID = "hotels_com";
const MERCHANT_NAME = "Hotels.com";

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
    url.includes("/book") ||
    url.includes("/payment")
  ) {
    // Esperar a página carregar completamente
    setTimeout(() => interceptBooking(), 2000);
  }
}

function interceptBooking(): void {
  // Encontrar botão de confirmar reserva
  const bookBtn =
    document.querySelector<HTMLElement>(
      '[data-stid="submit-payment-button"], ' +
      'button[type="submit"][data-testid*="book"], ' +
      '.complete-booking-button, ' +
      'button[data-stid="book-button"]'
    );

  if (!bookBtn) return;
  if (bookBtn.dataset.payjarvisIntercepted === "true") return;
  bookBtn.dataset.payjarvisIntercepted = "true";

  const amount = extractBookingTotal();
  const description = extractHotelInfo();

  bookBtn.addEventListener(
    "click",
    async (e) => {
      if (bookBtn.dataset.payjarvisApproved === "true") return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (amount === null) {
        showBanner("error", "Não foi possível detectar o valor da reserva.");
        return;
      }

      showBanner("pending", "Verificando autorização de pagamento...");

      const decision = await requestApproval({
        merchantId: MERCHANT_ID,
        merchantName: MERCHANT_NAME,
        amount,
        currency: "USD",
        category: "accommodation",
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

function extractBookingTotal(): number | null {
  const selectors = [
    '[data-stid="price-summary-total"] span',
    ".trip-total .price",
    ".price-summary-total",
    '[data-testid="price-summary-total"]',
    ".total-price",
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

function extractHotelInfo(): string {
  const hotelName =
    document.querySelector("h1")?.textContent?.trim() ??
    document.querySelector('[data-stid="content-hotel-title"]')?.textContent?.trim();

  const dates =
    document.querySelector('[data-stid="content-hotel-dates"]')?.textContent?.trim() ??
    document.querySelector(".date-range")?.textContent?.trim();

  if (hotelName && dates) {
    return `${hotelName} — ${dates}`;
  }
  return hotelName ?? "Hotels.com booking";
}

init();
