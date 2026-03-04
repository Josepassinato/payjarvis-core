/**
 * Amazon — Extrator de dados do checkout.
 *
 * Usa CDP Runtime.evaluate para ler valores da página.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class AmazonExtractor implements SiteExtractor {
  readonly site = "amazon";
  readonly category = "shopping";

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        // ─── Total do pedido ─────────────────────
        var totalSelectors = [
          '#subtotals-marketplace-table .grand-total-price',
          '.order-summary .grand-total-price',
          '#bottomSubmitOrderButtonId-announce',
          'span[data-testid="order-total"]',
          '.grand-total-price',
          '#subtotals-marketplace-table td.a-text-right .a-color-price',
          '.order-summary-line-item-amount .a-color-price'
        ];

        var totalText = '';
        for (var i = 0; i < totalSelectors.length; i++) {
          var el = document.querySelector(totalSelectors[i]);
          if (el && el.textContent && el.textContent.trim()) {
            totalText = el.textContent.trim();
            break;
          }
        }

        // ─── Itens do carrinho ───────────────────
        var items = [];
        var itemEls = document.querySelectorAll(
          '.item-title, ' +
          '.shipping-group-item-title, ' +
          '.a-truncate-cut, ' +
          '.shipment .a-row .a-size-base'
        );
        for (var j = 0; j < itemEls.length && j < 10; j++) {
          var text = itemEls[j].textContent;
          if (text && text.trim().length > 3) {
            items.push(text.trim().substring(0, 100));
          }
        }

        // ─── Moeda ───────────────────────────────
        var currency = 'USD';
        if (totalText.indexOf('R$') >= 0) currency = 'BRL';
        else if (totalText.indexOf('EUR') >= 0 || totalText.indexOf('€') >= 0) currency = 'EUR';
        else if (totalText.indexOf('GBP') >= 0 || totalText.indexOf('£') >= 0) currency = 'GBP';

        return JSON.stringify({
          totalText: totalText,
          items: items,
          currency: currency,
          merchantName: 'Amazon'
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount((data.totalText as string) ?? ""),
      currency: (data.currency as string) ?? "USD",
      items: (data.items as string[]) ?? [],
      merchantName: (data.merchantName as string) ?? "Amazon",
    };
  }

  private parseResult(result: unknown): Record<string, unknown> {
    if (typeof result === "string") {
      try {
        return JSON.parse(result) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    // CDP retorna { result: { type, value } }
    const r = result as { result?: { value?: string } } | undefined;
    if (r?.result?.value) {
      try {
        return JSON.parse(r.result.value) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return {};
  }

  private parseAmount(text: string): number | null {
    const cleaned = text
      .replace(/[A-Z]{3}\s*/g, "")
      .replace(/[R$€£¥₹\s]/g, "")
      .trim();

    // Formato BR: 1.234,56
    if (/\d+\.\d{3}/.test(cleaned) && cleaned.includes(",")) {
      const normalized = cleaned.replace(/\./g, "").replace(",", ".");
      const val = parseFloat(normalized);
      return isNaN(val) ? null : val;
    }

    const normalized = cleaned.replace(/,/g, "");
    const val = parseFloat(normalized);
    return isNaN(val) ? null : val;
  }
}
