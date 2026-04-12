/**
 * Shopping Session Service — 2-Phase Architecture
 *
 * Manages per-user shopping state with clear phase transitions:
 *   Phase 1 (Discovery): Google Search only → numbered options
 *   Phase 2 (Purchase):  Marketplace APIs → checkout/link
 *
 * State machine: idle → discovery → selection → purchase → idle
 * Exception: idle → direct_store (user names a specific store)
 *
 * TTL: 5 minutes of inactivity → auto-reset to idle
 */

// ─── Interfaces ─────────────────────────────────────

export interface SearchResult {
  index: number;
  title: string;
  price: string | null;
  store: string;
  url: string;
  imageUrl: string | null;
  source: "google_search" | "marketplace";
}

export interface MarketplaceIntegration {
  name: string;
  hasAPI: boolean;
  apiType: "affiliate" | "checkout" | "redirect" | "browser";
  isActive: boolean;
  supportedRegions: string[];
}

export type SessionPhase = "idle" | "discovery" | "selection" | "purchase" | "direct_store";

export interface ShoppingSession {
  userId: string;
  phase: SessionPhase;
  searchQuery: string | null;
  searchResults: SearchResult[];
  searchResultsSortedBy: "price_asc" | "relevance" | null; // how results are ordered — index 1 = cheapest when "price_asc"
  selectedProduct: SearchResult | null;
  imageContext: { brand: string; model: string; category: string; color: string } | null;
  directStoreName: string | null;
  lastActivity: number; // Date.now()
}

// ─── Session Store (per-userId, in-memory) ──────────

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _sessions = new Map<string, ShoppingSession>();

function newSession(userId: string): ShoppingSession {
  return {
    userId,
    phase: "idle",
    searchQuery: null,
    searchResults: [],
    searchResultsSortedBy: null,
    selectedProduct: null,
    imageContext: null,
    directStoreName: null,
    lastActivity: Date.now(),
  };
}

export function getSession(userId: string): ShoppingSession {
  const session = _sessions.get(userId);
  if (!session) {
    const fresh = newSession(userId);
    _sessions.set(userId, fresh);
    return fresh;
  }
  // TTL check
  if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
    console.log(`[PHASE] Session expired for ${userId} (${Math.round((Date.now() - session.lastActivity) / 1000)}s idle). Resetting to idle.`);
    const fresh = newSession(userId);
    _sessions.set(userId, fresh);
    return fresh;
  }
  return session;
}

export function updateSession(userId: string, updates: Partial<ShoppingSession>): ShoppingSession {
  const session = getSession(userId);
  Object.assign(session, updates, { lastActivity: Date.now() });
  _sessions.set(userId, session);
  return session;
}

export function resetSession(userId: string): void {
  _sessions.set(userId, newSession(userId));
}

// ─── Phase Transitions ──────────────────────────────

export function transitionTo(userId: string, newPhase: SessionPhase, extra?: Partial<ShoppingSession>): ShoppingSession {
  const session = getSession(userId);
  const oldPhase = session.phase;
  console.log(`[PHASE] ${userId}: ${oldPhase} → ${newPhase}`);
  return updateSession(userId, { phase: newPhase, ...extra });
}

// ─── Purchase Intent Detection ──────────────────────

const PURCHASE_INTENT_RE = /\b(compra|comprar|buy|purchase|checkout|pega\s+esse|quero\s+esse|pode\s+comprar|adiciona\s+no\s+carrinho|add\s+to\s+cart|finaliza|manda\s+o\s+link|como\s+compro|how\s+(?:do\s+i\s+)?buy|pega\s+pra\s+mim|usa\s+meu\s+cart[aã]o|faz\s+o\s+checkout|executa\s+a\s+compra|quero\s+comprar|esse\s+a[ií]|(?:o|a)\s+(?:primeiro|segundo|terceiro|primeiro|1|2|3))\b/i;

const NON_PURCHASE_RE = /\b(me\s+conta\s+mais|tell\s+me\s+more|tem\s+outra\s+cor|another\s+color|qual\s+a\s+diferen[cç]a|what['']?s?\s+the\s+difference|[eé]\s+bom|is\s+it\s+good|review|avalia[cç][aã]o|compara|compare|especifica[cç][oõ]es|specs|detalhes|details)\b/i;

export function detectPurchaseIntent(message: string): boolean {
  if (NON_PURCHASE_RE.test(message)) return false;
  return PURCHASE_INTENT_RE.test(message);
}

// ─── Selection Detection ────────────────────────────

/**
 * Detects if user is selecting a product from the numbered list.
 * Returns the 1-based index or null.
 */
export function detectSelection(message: string, maxIndex: number): number | null {
  const trimmed = message.trim().toLowerCase();

  // Direct number: "1", "2", "3"
  const numMatch = trimmed.match(/^(\d+)$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= maxIndex) return n;
  }

  // "o primeiro", "o segundo", "o terceiro", "the first", "the second"
  const ordinals: Record<string, number> = {
    primeiro: 1, primeira: 1, first: 1, "1st": 1,
    segundo: 2, segunda: 2, second: 2, "2nd": 2,
    terceiro: 3, terceira: 3, third: 3, "3rd": 3,
    quarto: 4, quarta: 4, fourth: 4, "4th": 4,
    quinto: 5, quinta: 5, fifth: 5, "5th": 5,
  };
  for (const [word, idx] of Object.entries(ordinals)) {
    if (trimmed.includes(word) && idx <= maxIndex) return idx;
  }

  // "o da Amazon", "o do Mercado Livre" — match by store name
  // This is handled by the caller since it needs the results list

  return null;
}

/**
 * Detects if user selected a product by store name.
 * Returns the 1-based index or null.
 */
export function detectSelectionByStore(message: string, results: SearchResult[]): number | null {
  const lower = message.toLowerCase();
  for (const r of results) {
    if (r.store && lower.includes(r.store.toLowerCase())) {
      return r.index;
    }
  }
  return null;
}

// ─── Direct Store Detection ─────────────────────────

const STORE_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\b(?:na|no|in|on|from|at)\s+amazon\b/i, name: "amazon" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+walmart\b/i, name: "walmart" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+(?:mercado\s*livre|ml)\b/i, name: "mercadolivre" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+(?:ali\s*express)\b/i, name: "aliexpress" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+ebay\b/i, name: "ebay" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+(?:best\s*buy)\b/i, name: "bestbuy" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+target\b/i, name: "target" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+(?:macy'?s)\b/i, name: "macys" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+shopee\b/i, name: "shopee" },
  { pattern: /\b(?:na|no|in|on|from|at)\s+(?:magazine\s*luiza|magalu)\b/i, name: "magazineluiza" },
];

export function detectDirectStore(message: string): string | null {
  for (const { pattern, name } of STORE_PATTERNS) {
    if (pattern.test(message)) return name;
  }
  return null;
}

// ─── Marketplace Registry ───────────────────────────

const MARKETPLACE_REGISTRY: Record<string, MarketplaceIntegration> = {
  amazon: {
    name: "Amazon",
    hasAPI: true,
    apiType: "affiliate",
    isActive: true,
    supportedRegions: ["US", "BR", "UK", "DE", "FR", "ES", "IT", "JP", "CA", "IN"],
  },
  walmart: {
    name: "Walmart",
    hasAPI: true,
    apiType: "redirect",
    isActive: true,
    supportedRegions: ["US"],
  },
  mercadolivre: {
    name: "Mercado Livre",
    hasAPI: true,
    apiType: "affiliate",
    isActive: true,
    supportedRegions: ["BR", "AR", "MX", "CO", "CL"],
  },
  ebay: {
    name: "eBay",
    hasAPI: true,
    apiType: "redirect",
    isActive: true,
    supportedRegions: ["US", "UK", "DE", "AU"],
  },
  bestbuy: {
    name: "Best Buy",
    hasAPI: true,
    apiType: "browser",
    isActive: true,
    supportedRegions: ["US"],
  },
  target: {
    name: "Target",
    hasAPI: true,
    apiType: "browser",
    isActive: true,
    supportedRegions: ["US"],
  },
  macys: {
    name: "Macy's",
    hasAPI: true,
    apiType: "browser",
    isActive: true,
    supportedRegions: ["US"],
  },
  aliexpress: {
    name: "AliExpress",
    hasAPI: false,
    apiType: "redirect",
    isActive: false,
    supportedRegions: ["US", "BR", "EU"],
  },
  shopee: {
    name: "Shopee",
    hasAPI: false,
    apiType: "redirect",
    isActive: false,
    supportedRegions: ["BR"],
  },
  magazineluiza: {
    name: "Magazine Luiza",
    hasAPI: false,
    apiType: "redirect",
    isActive: false,
    supportedRegions: ["BR"],
  },
};

export function getMarketplace(storeName: string): MarketplaceIntegration | null {
  return MARKETPLACE_REGISTRY[storeName.toLowerCase()] || null;
}

export function hasActiveAPI(storeName: string): boolean {
  const mp = getMarketplace(storeName);
  return !!mp && mp.hasAPI && mp.isActive;
}

// ─── Format Results for User ────────────────────────

export function formatResultsForUser(results: SearchResult[], lang: "pt" | "en" | "es" = "en"): string {
  if (results.length === 0) {
    return lang === "pt" ? "Não encontrei resultados. Pode tentar descrever o produto de outra forma?"
      : lang === "es" ? "No encontré resultados. ¿Puedes describir el producto de otra forma?"
      : "No results found. Can you try describing the product differently?";
  }

  const header = lang === "pt" ? "Encontrei essas opções pra você! 🐕\n\n"
    : lang === "es" ? "¡Encontré estas opciones para ti! 🐕\n\n"
    : "Found these options for you! 🐕\n\n";

  const lines = results.map((r) => {
    const price = r.price || (lang === "pt" ? "Ver preço" : lang === "es" ? "Ver precio" : "See price");
    return `${r.index}. ${r.title} — ${price} (${r.store})\n   ${r.url}`;
  });

  const footer = lang === "pt" ? "\n\nQual te interessa? Me diz o número!"
    : lang === "es" ? "\n\n¿Cuál te interesa? ¡Dime el número!"
    : "\n\nWhich one interests you? Tell me the number!";

  return header + lines.join("\n\n") + footer;
}
