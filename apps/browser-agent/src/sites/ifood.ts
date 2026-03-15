/**
 * iFood — Extrator de dados de pedido para ifood.com.br
 *
 * Layer 4: iFood não tem API pública para pedidos consumer.
 * Este extrator detecta checkout/confirmação no site/webapp do iFood
 * e extrai dados da transação para o PayJarvis Rules Engine.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class IFoodExtractor implements SiteExtractor {
  readonly site = "ifood";
  readonly category = "delivery";

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        var body = document.body.innerText || '';
        var totalText = '';
        var items = [];
        var merchantName = '';

        // ─── Detectar nome do restaurante ───────────
        // iFood mostra o nome do restaurante no header do pedido
        var restaurantEl = document.querySelector('[class*="restaurant-name"]') ||
                           document.querySelector('[data-testid="restaurant-name"]') ||
                           document.querySelector('h1[class*="merchant"]') ||
                           document.querySelector('[class*="store-name"]');
        if (restaurantEl) {
          merchantName = restaurantEl.textContent.trim();
        }

        // Fallback: procurar no título da página
        if (!merchantName) {
          var title = document.title || '';
          // iFood titles: "Restaurante X - iFood" ou "Pedido - iFood"
          if (title.indexOf(' - iFood') >= 0) {
            merchantName = title.split(' - iFood')[0].trim();
          } else {
            merchantName = 'iFood';
          }
        }

        // ─── Detectar valor total ───────────────────
        // iFood usa R$ (BRL) — procurar "Total" perto de R$ X,XX
        var moneyRegex = /R\\$\\s*[\\d.,]+/gi;
        var lines = body.split('\\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].toLowerCase();
          if (line.indexOf('total') >= 0 && line.indexOf('subtotal') < 0) {
            var matches = lines[i].match(moneyRegex);
            if (matches && matches.length > 0) {
              totalText = matches[matches.length - 1];
              break;
            }
            if (i + 1 < lines.length) {
              matches = lines[i + 1].match(moneyRegex);
              if (matches && matches.length > 0) {
                totalText = matches[0];
                break;
              }
            }
          }
        }

        // Fallback: maior valor R$ na página
        if (!totalText) {
          var allMatches = body.match(moneyRegex);
          if (allMatches && allMatches.length > 0) {
            var maxVal = 0;
            var maxText = '';
            for (var j = 0; j < allMatches.length; j++) {
              var num = parseFloat(allMatches[j].replace('R$', '').replace(/\\s/g, '').replace('.', '').replace(',', '.'));
              if (num > maxVal) {
                maxVal = num;
                maxText = allMatches[j];
              }
            }
            totalText = maxText;
          }
        }

        // ─── Detectar itens do pedido ───────────────
        var itemEls = document.querySelectorAll('[class*="item-name"], [class*="cart-item"], [data-testid*="item"]');
        for (var k = 0; k < itemEls.length && k < 20; k++) {
          var txt = itemEls[k].textContent.trim();
          if (txt && txt.length > 1 && txt.length < 120) {
            items.push(txt);
          }
        }

        return JSON.stringify({
          totalText: totalText,
          items: items,
          currency: 'BRL',
          merchantName: merchantName
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount((data.totalText as string) ?? ""),
      currency: "BRL",
      items: (data.items as string[]) ?? [],
      merchantName: (data.merchantName as string) ?? "iFood",
      category: "delivery",
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
    // BRL format: R$ 45,90 or R$ 1.245,90
    const cleaned = text.replace(/R\$\s*/g, "").trim();
    if (!cleaned) return null;
    // Brazilian format: dot = thousands, comma = decimal
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    return parseFloat(normalized) || null;
  }
}
