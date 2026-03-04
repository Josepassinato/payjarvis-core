/**
 * Generic — Extrator heurístico para qualquer site.
 *
 * Busca por padrões comuns de checkout quando nenhum
 * site específico é detectado.
 */

import type { SiteExtractor, ExtractedData, EvaluateFn } from "./types.js";

export class GenericExtractor implements SiteExtractor {
  readonly site = "generic";
  readonly category = "other";

  async extract(evaluate: EvaluateFn): Promise<ExtractedData> {
    const result = await evaluate(`
      (function() {
        // ─── Buscar valor total ──────────────────
        // Estratégia: procurar textos com "total" perto de valores monetários
        var allText = document.body.innerText || '';
        var totalText = '';

        // Regex para valores monetários
        var moneyRegex = /(?:USD|BRL|EUR|GBP|R\\$|\\$|€|£)\\s*[\\d.,]+|[\\d.,]+\\s*(?:USD|BRL|EUR|GBP)/gi;

        // Procurar perto de "total"
        var lines = allText.split('\\n');
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].toLowerCase();
          if (line.indexOf('total') >= 0 || line.indexOf('subtotal') >= 0) {
            var matches = lines[i].match(moneyRegex);
            if (matches && matches.length > 0) {
              totalText = matches[matches.length - 1];
              break;
            }
            // Verificar próxima linha
            if (i + 1 < lines.length) {
              matches = lines[i + 1].match(moneyRegex);
              if (matches && matches.length > 0) {
                totalText = matches[0];
                break;
              }
            }
          }
        }

        // Fallback: maior valor na página
        if (!totalText) {
          var allMatches = allText.match(moneyRegex);
          if (allMatches && allMatches.length > 0) {
            var maxVal = 0;
            var maxText = '';
            for (var j = 0; j < allMatches.length; j++) {
              var num = parseFloat(allMatches[j].replace(/[^\\d.,]/g, '').replace(',', '.'));
              if (num > maxVal) {
                maxVal = num;
                maxText = allMatches[j];
              }
            }
            totalText = maxText;
          }
        }

        // ─── Merchant name ───────────────────────
        var merchantName = document.title || window.location.hostname;

        // ─── Moeda ───────────────────────────────
        var currency = 'USD';
        if (totalText.indexOf('R$') >= 0) currency = 'BRL';
        else if (totalText.indexOf('€') >= 0) currency = 'EUR';
        else if (totalText.indexOf('£') >= 0) currency = 'GBP';

        return JSON.stringify({
          totalText: totalText,
          items: [],
          currency: currency,
          merchantName: merchantName
        });
      })()
    `);

    const data = this.parseResult(result);

    return {
      amount: this.parseAmount(data.totalText as string ?? ""),
      currency: (data.currency as string) ?? "USD",
      items: (data.items as string[]) ?? [],
      merchantName: (data.merchantName as string) ?? "Unknown",
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
