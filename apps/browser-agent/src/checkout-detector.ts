/**
 * Checkout Detector — Identifica se uma URL é página de checkout.
 *
 * Suporta Amazon, Expedia, Hotels.com, Booking.com e
 * detecção genérica para qualquer site.
 */

export interface CheckoutMatch {
  site: string;
  stage: "cart" | "payment" | "confirm";
  confidence: "high" | "medium" | "low";
}

interface UrlPattern {
  pattern: RegExp;
  stage: CheckoutMatch["stage"];
  confidence: CheckoutMatch["confidence"];
}

interface SiteConfig {
  name: string;
  hostPatterns: RegExp[];
  urlPatterns: UrlPattern[];
}

const SITES: SiteConfig[] = [
  // ─── Amazon ──────────────────────────────
  {
    name: "amazon",
    hostPatterns: [/\.amazon\.(com|com\.br|co\.uk|de|fr|es|it|co\.jp|ca|in)$/],
    urlPatterns: [
      {
        pattern: /\/checkout\/confirm-order/i,
        stage: "confirm",
        confidence: "high",
      },
      {
        pattern: /\/checkout\/payment-plan/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/gp\/buy\/spc\/handlers\/display/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/gp\/buy\//i,
        stage: "payment",
        confidence: "medium",
      },
      {
        pattern: /\/checkout\/address/i,
        stage: "payment",
        confidence: "medium",
      },
      {
        pattern: /\/checkout\/begin/i,
        stage: "cart",
        confidence: "high",
      },
      {
        pattern: /placeYourOrder/i,
        stage: "confirm",
        confidence: "high",
      },
    ],
  },

  // ─── Expedia ─────────────────────────────
  {
    name: "expedia",
    hostPatterns: [/\.expedia\.(com|com\.br|co\.uk|de|fr|es|it)$/],
    urlPatterns: [
      {
        pattern: /\/checkout\/payment/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/checkout\/review/i,
        stage: "confirm",
        confidence: "high",
      },
      {
        pattern: /\/book\/flights/i,
        stage: "payment",
        confidence: "medium",
      },
      {
        pattern: /\/book\/hotels/i,
        stage: "payment",
        confidence: "medium",
      },
      {
        pattern: /\/checkout/i,
        stage: "payment",
        confidence: "medium",
      },
    ],
  },

  // ─── Hotels.com ──────────────────────────
  {
    name: "hotels",
    hostPatterns: [/\.hotels\.com$/],
    urlPatterns: [
      {
        pattern: /\/payment/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/checkout\//i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/book\//i,
        stage: "payment",
        confidence: "medium",
      },
    ],
  },

  // ─── Booking.com ─────────────────────────
  {
    name: "booking",
    hostPatterns: [/\.booking\.com$/],
    urlPatterns: [
      {
        pattern: /\/checkout\.html/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/book\.html/i,
        stage: "payment",
        confidence: "high",
      },
      {
        pattern: /\/booking\//i,
        stage: "payment",
        confidence: "medium",
      },
    ],
  },
];

// Padrões genéricos para qualquer site
const GENERIC_PATTERNS: UrlPattern[] = [
  {
    pattern: /\/checkout\/payment/i,
    stage: "payment",
    confidence: "medium",
  },
  {
    pattern: /\/checkout\/confirm/i,
    stage: "confirm",
    confidence: "medium",
  },
  {
    pattern: /\/checkout/i,
    stage: "payment",
    confidence: "low",
  },
  {
    pattern: /\/payment/i,
    stage: "payment",
    confidence: "low",
  },
  {
    pattern: /\/(comprar|finalizar|pagamento)/i,
    stage: "payment",
    confidence: "low",
  },
  {
    pattern: /\/pay\b/i,
    stage: "payment",
    confidence: "low",
  },
];

export class CheckoutDetector {
  /**
   * Detecta se uma URL é página de checkout.
   * Retorna null se não for checkout.
   */
  detect(url: string): CheckoutMatch | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const hostname = parsed.hostname;
    const pathname = parsed.pathname + parsed.search;

    // Verificar sites conhecidos primeiro
    for (const site of SITES) {
      const hostMatch = site.hostPatterns.some((p) => p.test(hostname));
      if (!hostMatch) continue;

      // Testar padrões de URL do mais específico ao mais genérico
      for (const urlPattern of site.urlPatterns) {
        if (urlPattern.pattern.test(pathname)) {
          return {
            site: site.name,
            stage: urlPattern.stage,
            confidence: urlPattern.confidence,
          };
        }
      }

      // Host conhecido mas URL não é checkout
      return null;
    }

    // Fallback: detecção genérica para sites desconhecidos
    for (const pattern of GENERIC_PATTERNS) {
      if (pattern.pattern.test(pathname)) {
        return {
          site: "generic",
          stage: pattern.stage,
          confidence: pattern.confidence,
        };
      }
    }

    return null;
  }
}
