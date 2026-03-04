/**
 * Hotels.com — Extrator de dados do checkout.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class HotelsExtractor implements SiteExtractor {
  readonly site = "hotels";
  readonly category = "accommodation";

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        // ─── Total ───────────────────────────────
        var totalSelectors = [
          '[data-stid="price-summary-total"] span',
          '.trip-total .price',
          '.price-summary-total',
          '[data-testid="price-summary-total"]',
          '.total-price'
        ];

        var totalText = '';
        for (var i = 0; i < totalSelectors.length; i++) {
          var el = document.querySelector(totalSelectors[i]);
          if (el && el.textContent && el.textContent.trim()) {
            totalText = el.textContent.trim();
            break;
          }
        }

        // ─── Nome do hotel ───────────────────────
        var hotelName = '';
        var h1 = document.querySelector('h1');
        if (h1 && h1.textContent) hotelName = h1.textContent.trim();
        if (!hotelName) {
          var title = document.querySelector('[data-stid="content-hotel-title"]');
          if (title && title.textContent) hotelName = title.textContent.trim();
        }

        // ─── Datas ───────────────────────────────
        var dates = '';
        var datesEl = document.querySelector('[data-stid="content-hotel-dates"]');
        if (datesEl && datesEl.textContent) dates = datesEl.textContent.trim();
        if (!dates) {
          var dateRange = document.querySelector('.date-range');
          if (dateRange && dateRange.textContent) dates = dateRange.textContent.trim();
        }

        // ─── Moeda ───────────────────────────────
        var currency = 'USD';
        if (totalText.indexOf('R$') >= 0) currency = 'BRL';
        else if (totalText.indexOf('€') >= 0) currency = 'EUR';
        else if (totalText.indexOf('£') >= 0) currency = 'GBP';

        var description = hotelName;
        if (dates) description += ' — ' + dates;

        return JSON.stringify({
          totalText: totalText,
          items: description ? [description] : [],
          currency: currency,
          merchantName: 'Hotels.com'
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount(data.totalText as string ?? ""),
      currency: (data.currency as string) ?? "USD",
      items: (data.items as string[]) ?? [],
      merchantName: "Hotels.com",
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
