/**
 * Expedia — Extrator de dados do checkout.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class ExpediaExtractor implements SiteExtractor {
  readonly site = "expedia";

  get category(): string {
    return "travel";
  }

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        // ─── Total ───────────────────────────────
        var totalSelectors = [
          '[data-stid="price-summary-total"] .uitk-text',
          '.trip-total .uitk-text',
          '[data-testid="trip-total"]',
          '.price-summary-total',
          '#price-summary .total'
        ];

        var totalText = '';
        for (var i = 0; i < totalSelectors.length; i++) {
          var el = document.querySelector(totalSelectors[i]);
          if (el && el.textContent && el.textContent.trim()) {
            totalText = el.textContent.trim();
            break;
          }
        }

        // ─── Detalhes da viagem ──────────────────
        var title = '';
        var h1 = document.querySelector('h1');
        if (h1 && h1.textContent) title = h1.textContent.trim();
        if (!title) {
          var hotelTitle = document.querySelector('[data-stid="content-hotel-title"]');
          if (hotelTitle && hotelTitle.textContent) title = hotelTitle.textContent.trim();
        }

        // ─── Detectar categoria ──────────────────
        var url = window.location.href.toLowerCase();
        var pageText = document.body.textContent.toLowerCase().substring(0, 5000);
        var category = 'travel';
        if (url.indexOf('hotel') >= 0 || url.indexOf('lodging') >= 0) category = 'accommodation';
        else if (url.indexOf('flight') >= 0 || pageText.indexOf('flight') >= 0) category = 'travel';
        else if (url.indexOf('car') >= 0 || url.indexOf('rental') >= 0) category = 'transport';

        // ─── Moeda ───────────────────────────────
        var currency = 'USD';
        if (totalText.indexOf('R$') >= 0) currency = 'BRL';
        else if (totalText.indexOf('€') >= 0) currency = 'EUR';
        else if (totalText.indexOf('£') >= 0) currency = 'GBP';

        return JSON.stringify({
          totalText: totalText,
          items: title ? [title] : [],
          currency: currency,
          merchantName: 'Expedia',
          category: category
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount(data.totalText as string ?? ""),
      currency: (data.currency as string) ?? "USD",
      items: (data.items as string[]) ?? [],
      merchantName: "Expedia",
      category: (data.category as string) ?? "travel",
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
