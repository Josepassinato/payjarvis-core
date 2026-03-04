/**
 * Booking.com — Extrator de dados do checkout.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class BookingExtractor implements SiteExtractor {
  readonly site = "booking";
  readonly category = "accommodation";

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        // ─── Total ───────────────────────────────
        var totalSelectors = [
          '.bp-overview-content__price-total',
          '[data-testid="price-and-discounts-total"]',
          '.bui-price-display__value',
          '.totalPrice',
          '.priceview-total-price'
        ];

        var totalText = '';
        for (var i = 0; i < totalSelectors.length; i++) {
          var el = document.querySelector(totalSelectors[i]);
          if (el && el.textContent && el.textContent.trim()) {
            totalText = el.textContent.trim();
            break;
          }
        }

        // ─── Nome da propriedade ─────────────────
        var propertyName = '';
        var nameSelectors = [
          '.hp__hotel-name',
          '[data-testid="header-hotel-name"]',
          'h1',
          '.bui-title'
        ];
        for (var j = 0; j < nameSelectors.length; j++) {
          var nameEl = document.querySelector(nameSelectors[j]);
          if (nameEl && nameEl.textContent && nameEl.textContent.trim()) {
            propertyName = nameEl.textContent.trim();
            break;
          }
        }

        // ─── Datas ───────────────────────────────
        var dates = '';
        var datesEl = document.querySelector('[data-testid="booking-dates"]');
        if (datesEl && datesEl.textContent) dates = datesEl.textContent.trim();

        // ─── Moeda ───────────────────────────────
        var currency = 'USD';
        if (totalText.indexOf('R$') >= 0) currency = 'BRL';
        else if (totalText.indexOf('€') >= 0) currency = 'EUR';
        else if (totalText.indexOf('£') >= 0) currency = 'GBP';

        var description = propertyName;
        if (dates) description += ' — ' + dates;

        return JSON.stringify({
          totalText: totalText,
          items: description ? [description] : [],
          currency: currency,
          merchantName: 'Booking.com'
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount(data.totalText as string ?? ""),
      currency: (data.currency as string) ?? "USD",
      items: (data.items as string[]) ?? [],
      merchantName: "Booking.com",
    };
  }

  private parseResult(result: unknown): Record<string, unknown> {
    const r = result as { result?: { value?: string } } | undefined;
    const raw = r?.result?.value ?? (typeof result === "string" ? result : "{}");
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private parseAmount(text: string): number | null {
    const cleaned = text.replace(/[A-Z]{3}\s*/g, "").replace(/[R$€£¥₹\s]/g, "").trim();
    if (/\d+\.\d{3}/.test(cleaned) && cleaned.includes(",")) {
      return parseFloat(cleaned.replace(/\./g, "").replace(",", ".")) || null;
    }
    return parseFloat(cleaned.replace(/,/g, "")) || null;
  }
}
