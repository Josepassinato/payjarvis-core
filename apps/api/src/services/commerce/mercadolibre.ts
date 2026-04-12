/**
 * Commerce Service: Mercado Libre (Products LATAM)
 *
 * Busca pública — NÃO precisa de auth!
 * Base: https://api.mercadolibre.com
 * Sites: MLB (Brasil), MLA (Argentina), MLM (México), MLC (Chile), MCO (Colômbia)
 *
 * Search priority:
 *   1. Gemini Grounding (Google Search) — bypasses datacenter IP blocks
 *   2. Direct ML API — may work from non-datacenter IPs
 *   3. Future: Playwright scraper for stores without API
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const MELI_BASE = "https://api.mercadolibre.com";

const MELI_SITES: Record<string, string> = {
  'brasil': 'MLB', 'brazil': 'MLB', 'br': 'MLB',
  'argentina': 'MLA', 'ar': 'MLA',
  'mexico': 'MLM', 'méxico': 'MLM', 'mx': 'MLM',
  'chile': 'MLC', 'cl': 'MLC',
  'colombia': 'MCO', 'co': 'MCO',
  'uruguai': 'MLU', 'uruguay': 'MLU', 'uy': 'MLU',
  'peru': 'MPE', 'pe': 'MPE',
};

function resolveSiteId(country: string): string {
  const lower = country.trim().toLowerCase();
  return MELI_SITES[lower] || 'MLB';
}

// ─── Interfaces ──────────────────────────────────────

export interface MeliSearchParams {
  query: string;
  siteId?: string;       // MLB, MLA, MLM, etc.
  country?: string;      // "brasil", "argentina" — resolved to siteId
  category?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: string;         // "relevance", "price_asc", "price_desc"
  limit?: number;        // max 50, default 10
}

export interface MeliProduct {
  id: string;
  title: string;
  price: number;
  currency: string;
  thumbnail: string;
  permalink: string;
  condition: string;
  freeShipping: boolean;
  sellerName: string;
  sellerReputation: string;
  availableQuantity: number;
  rating: number | null;
  reviewCount: number | null;
}

// ─── Primary: Gemini Grounding (bypasses datacenter IP blocks) ────

async function searchMeliViaGemini(query: string, limit: number): Promise<MeliProduct[]> {
  if (!GEMINI_API_KEY) return [];

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} } as any],
  });

  const prompt = `Search Mercado Livre Brazil (mercadolivre.com.br) for "${query}". Return a JSON array with max ${limit} products currently for sale. Format: [{"title":"exact product title","price":299.90,"currency":"BRL","url":"https://www.mercadolivre.com.br/...","seller":"seller name","freeShipping":true,"condition":"Novo"}]. ONLY the JSON array, nothing else. Use real current listings.`;

  const result = await model.generateContent(prompt);
  let text: string;
  try {
    text = result.response.text();
  } catch {
    // Gemini may throw when grounding metadata is present but text is empty
    console.warn("[MELI] Gemini text() threw, checking candidates directly");
    text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  if (!text) {
    console.warn("[MELI] Gemini returned empty text");
    return [];
  }

  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn("[MELI] No JSON array found in Gemini response:", text.substring(0, 200));
    return [];
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn("[MELI] JSON parse failed:", (e as Error).message);
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.slice(0, limit).map((p: any) => {
    // Gemini SDK returns grounding redirect URLs (vertexaisearch.cloud.google.com/...)
    // Build direct ML search URL from product title instead
    let permalink = p.url || "";
    if (permalink.includes("vertexaisearch.cloud.google.com") || permalink.includes("google.com") || !permalink.includes("mercadolivre")) {
      const slug = (p.title || query).toLowerCase().replace(/[^a-z0-9]+/g, "-").substring(0, 80);
      permalink = `https://lista.mercadolivre.com.br/${encodeURIComponent(p.title || query)}`;
    }
    return {
    id: "",
    title: p.title || query,
    price: typeof p.price === "number" ? p.price : 0,
    currency: p.currency || "BRL",
    thumbnail: "",
    permalink,
    condition: p.condition || "N/A",
    freeShipping: p.freeShipping ?? false,
    sellerName: p.seller || "Vendedor",
    sellerReputation: "N/A",
    availableQuantity: 0,
    rating: null,
    reviewCount: null,
  };
  });
}

export async function searchMeliProducts(params: MeliSearchParams): Promise<{
  source: string;
  mock: boolean;
  results: MeliProduct[];
  error?: string;
}> {
  const limit = params.limit ?? 10;

  // Primary: Gemini Grounding (bypasses datacenter IP blocks via Google Search)
  try {
    console.log(`[MELI] Gemini grounding: q="${params.query}" limit=${limit}`);
    const geminiResults = await Promise.race([
      searchMeliViaGemini(params.query, limit),
      new Promise<MeliProduct[]>((resolve) => setTimeout(() => resolve([]), 12000)),
    ]);
    if (geminiResults.length > 0) {
      console.log(`[MELI] Gemini OK: ${geminiResults.length} products for "${params.query}"`);
      return { source: "mercadolibre_gemini", mock: false, results: geminiResults };
    }
    console.warn("[MELI] Gemini returned 0 results, trying direct API...");
  } catch (err) {
    console.error("[MELI] Gemini grounding error:", err instanceof Error ? err.message : err);
  }

  // Fallback: direct ML API (may work from non-datacenter IPs)
  const siteId = params.siteId || resolveSiteId(params.country || 'brasil');
  try {
    const query: Record<string, string> = {
      q: params.query,
      limit: String(limit),
    };
    if (params.category) query.category = params.category;
    if (params.sort) {
      const sortMap: Record<string, string> = {
        'relevance': 'relevance',
        'price_asc': 'price_asc',
        'price_desc': 'price_desc',
      };
      query.sort = sortMap[params.sort] || 'relevance';
    }
    if (params.priceMin || params.priceMax) {
      const min = params.priceMin ?? 0;
      const max = params.priceMax ?? '';
      query.price = `${min}-${max}`;
    }

    const qs = new URLSearchParams(query).toString();
    const url = `${MELI_BASE}/sites/${siteId}/search?${qs}`;
    console.log(`[MELI] Fallback: GET /sites/${siteId}/search q=${params.query}`);

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.message || data.error || `HTTP ${res.status}`);
    }

    const results: MeliProduct[] = (data.results || []).slice(0, limit).map((item: any) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      currency: item.currency_id || 'BRL',
      thumbnail: item.thumbnail || '',
      permalink: item.permalink || '',
      condition: item.condition === 'new' ? 'Novo' : item.condition === 'used' ? 'Usado' : item.condition || 'N/A',
      freeShipping: item.shipping?.free_shipping || false,
      sellerName: item.seller?.nickname || 'Vendedor',
      sellerReputation: item.seller?.seller_reputation?.level_id || 'N/A',
      availableQuantity: item.available_quantity || 0,
      rating: null,
      reviewCount: null,
    }));

    return { source: "mercadolibre", mock: false, results };
  } catch (err) {
    console.error("[MELI] All methods failed:", err instanceof Error ? err.message : err);
    return {
      source: "mercadolibre",
      mock: false,
      results: [],
      error: err instanceof Error ? err.message : "Mercado Libre search failed",
    };
  }
}

// ─── Product Details ─────────────────────────────────

export async function getMeliProduct(itemId: string): Promise<{
  source: string;
  product: any | null;
  error?: string;
}> {
  try {
    console.log(`[MELI] GET /items/${itemId}`);
    const res = await fetch(`${MELI_BASE}/items/${itemId}`);
    const data = await res.json() as any;

    if (!res.ok) {
      throw new Error(data.message || "Item not found");
    }

    return { source: "mercadolibre", product: data };
  } catch (err) {
    return {
      source: "mercadolibre",
      product: null,
      error: err instanceof Error ? err.message : "Failed to get product details",
    };
  }
}

// ─── Format for Telegram ─────────────────────────────

export function formatMeliResults(results: MeliProduct[]): string {
  if (results.length === 0) {
    return "Não encontrei produtos com esses critérios no Mercado Livre.";
  }

  const formatPrice = (price: number, currency: string) => {
    if (currency === 'BRL') return `R$ ${price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (currency === 'ARS') return `ARS $${price.toLocaleString('es-AR')}`;
    if (currency === 'MXN') return `MX$${price.toLocaleString('es-MX')}`;
    return `${currency} ${price.toFixed(2)}`;
  };

  const items = results.slice(0, 5).map((p, i) => {
    const parts = [
      `${i + 1}. 🛒 ${p.title}`,
      `   💰 ${formatPrice(p.price, p.currency)}`,
      `   📦 ${p.condition}${p.freeShipping ? ' · 🚚 Frete grátis' : ''}`,
      `   🏪 ${p.sellerName}`,
    ];
    return parts.join("\n");
  });

  return items.join("\n\n") + "\n\nQuer mais detalhes de algum? Me diga o número.";
}
