/**
 * Unified Product Search Service — Single entry point for ALL product searches.
 *
 * PARALLEL search across multiple sources with Redis caching:
 *   1. SerpAPI Google Shopping — fast, structured, 100+ stores ($50/mo or free tier)
 *   2. Mercado Livre API (Brazil) — free, instant, 99% reliable
 *   3. Apify Amazon Scraper — paid but reliable, structured data
 *   4. Google Search Grounding (Gemini) — free, returns links + prices
 *   5. Browser Agent /navigate — last resort, slow
 *
 * All sources run in PARALLEL. First results win, others supplement.
 * Redis cache: 1 hour TTL. User NEVER receives "error" or "not found".
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";

// ─── Unified Result Interface ────────────────────────
export interface UnifiedProduct {
  title: string;
  price: number | null;
  currency: string;
  url: string;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  store: string;
  asin?: string;
  condition?: string;
  freeShipping?: boolean;
  isApproximate?: boolean;
}

export interface UnifiedSearchResult {
  products: UnifiedProduct[];
  method: string;
  methodsAttempted: string[];
  query: string;
  store?: string;
  totalResults: number;
  fromCache?: boolean;
}

export interface SearchOptions {
  query: string;
  store?: string;
  country?: string;
  zipCode?: string;
  maxResults?: number;
  userId?: string;
}

// ─── Config ──────────────────────────────────────────
const TIMEOUT = {
  serpapi: 6000,
  mercadoLivre: 6000,
  apify: 15000,
  grounding: 22000,
  browserAgent: 20000,
} as const;

const PARALLEL_TIMEOUT = 25000; // Global timeout: return whatever we have after 25s
const CACHE_TTL = 3600;         // 1 hour

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";

// ─── Main Entry Point (PARALLEL) ─────────────────────

export async function unifiedProductSearch(opts: SearchOptions): Promise<UnifiedSearchResult> {
  const { query, store, country = "US", zipCode, maxResults = 5, userId } = opts;
  const isBrazil = country === "BR" || country === "brasil" || country === "Brazil";
  const storeQuery = store ? `${query} ${store}` : query;

  console.log(`[UNIFIED-SEARCH] query="${query}" store="${store || "any"}" country="${country}"`);

  // ─── Check Redis cache first ───────────────────────
  const cacheKey = `search:products:${query.toLowerCase().trim()}:${store || "any"}:${country}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as UnifiedSearchResult;
      if (parsed.products && parsed.products.length > 0) {
        console.log(`[UNIFIED-SEARCH] CACHE HIT "${query}" (method=${parsed.method}, ${parsed.products.length} products)`);
        return { ...parsed, methodsAttempted: ["cache"], fromCache: true };
      }
    }
  } catch { /* corrupted cache, proceed */ }

  // ─── Build sources array ───────────────────────────
  type Source = { name: string; fn: () => Promise<UnifiedProduct[]>; priority: number };
  const sources: Source[] = [];

  // SerpAPI Google Shopping — fastest, covers 100+ stores
  if (SERPAPI_KEY) {
    sources.push({ name: "serpapi", fn: () => withTimeout(searchSerpApi(storeQuery, country, maxResults), TIMEOUT.serpapi), priority: 1 });
  }

  // SerpAPI Walmart — dedicated engine for Walmart
  const isWalmart = store && store.toLowerCase().includes("walmart");
  if (SERPAPI_KEY && isWalmart) {
    sources.push({ name: "serpapi_walmart", fn: () => withTimeout(searchSerpApiWalmart(query, maxResults), TIMEOUT.serpapi), priority: 1 });
  }

  // SerpAPI eBay — dedicated engine for eBay
  const isEbay = store && store.toLowerCase().includes("ebay");
  if (SERPAPI_KEY && isEbay) {
    sources.push({ name: "serpapi_ebay", fn: () => withTimeout(searchSerpApiEbay(query, maxResults), TIMEOUT.serpapi), priority: 1 });
  }

  // Mercado Livre — Brazil only, free
  if (isBrazil) {
    sources.push({ name: "mercadolivre", fn: () => withTimeout(searchMercadoLivre(query, maxResults), TIMEOUT.mercadoLivre), priority: 1 });
  }

  // Apify — Amazon, paid but reliable
  sources.push({ name: "apify", fn: () => withTimeout(searchApify(query, country, maxResults, userId), TIMEOUT.apify), priority: 3 });

  // Google Search Grounding — free, works well for specific stores
  if (GEMINI_API_KEY) {
    sources.push({ name: "grounding", fn: () => withTimeout(searchGeminiGrounding(storeQuery, maxResults), TIMEOUT.grounding), priority: 2 });
  }

  // Browser Agent — last resort, slow
  if (store) {
    sources.push({ name: "browser", fn: () => withTimeout(searchBrowserAgent(query, store, maxResults), TIMEOUT.browserAgent), priority: 5 });
  }

  // ─── Run ALL sources in parallel ───────────────────
  const methodsAttempted: string[] = [];

  const parallelResults = await withTimeout(
    Promise.allSettled(sources.map(s => s.fn())),
    PARALLEL_TIMEOUT,
  ).catch(() => {
    // If global timeout, return whatever settled so far
    console.log(`[UNIFIED-SEARCH] Global timeout (${PARALLEL_TIMEOUT}ms) — using partial results`);
    return sources.map(() => ({ status: "rejected" as const, reason: new Error("Global timeout") }));
  });

  // ─── Collect successful results ────────────────────
  const successfulSources: Array<{ name: string; products: UnifiedProduct[]; priority: number }> = [];

  parallelResults.forEach((result, i) => {
    methodsAttempted.push(sources[i].name);
    if (result.status === "fulfilled" && result.value.length > 0) {
      console.log(`[UNIFIED-SEARCH] ✓ ${sources[i].name} returned ${result.value.length} results`);
      successfulSources.push({ name: sources[i].name, products: result.value, priority: sources[i].priority });
    } else {
      const reason = result.status === "rejected" ? (result.reason as Error).message : "0 results";
      console.log(`[UNIFIED-SEARCH] ✗ ${sources[i].name}: ${reason}`);
    }
  });

  // ─── Merge and deduplicate ─────────────────────────
  if (successfulSources.length > 0) {
    successfulSources.sort((a, b) => a.priority - b.priority);
    const primarySource = successfulSources[0];
    const allProducts: UnifiedProduct[] = [...primarySource.products];

    // Add unique products from secondary sources
    const seenTitles = new Set(allProducts.map(p => p.title.toLowerCase().substring(0, 40)));
    for (const source of successfulSources.slice(1)) {
      for (const product of source.products) {
        const titleKey = product.title.toLowerCase().substring(0, 40);
        if (!seenTitles.has(titleKey)) {
          seenTitles.add(titleKey);
          allProducts.push(product);
        }
      }
    }

    // Sort by price (nulls last), cap at maxResults
    const finalProducts = allProducts
      .sort((a, b) => {
        if (a.price === null) return 1;
        if (b.price === null) return -1;
        return a.price - b.price;
      })
      .slice(0, maxResults);

    const searchResult: UnifiedSearchResult = {
      products: finalProducts,
      method: primarySource.name,
      methodsAttempted,
      query,
      store,
      totalResults: finalProducts.length,
    };

    // Cache successful results
    redisSet(cacheKey, JSON.stringify(searchResult), CACHE_TTL).catch(() => {});

    return searchResult;
  }

  // ─── ALL FAILED — return Google Shopping link ──────
  console.log(`[UNIFIED-SEARCH] ALL methods failed for "${query}". Returning Google fallback.`);
  methodsAttempted.push("google_fallback");
  const googleQuery = store ? `${query} ${store} buy price` : `${query} buy best price`;
  return {
    products: [{
      title: query,
      price: null,
      currency: "USD",
      url: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(googleQuery)}`,
      imageUrl: null,
      rating: null,
      reviewCount: null,
      store: "Google Shopping",
      isApproximate: true,
    }],
    method: "google_fallback",
    methodsAttempted,
    query,
    store,
    totalResults: 1,
  };
}

// ─── Method: SerpAPI Google Shopping ─────────────────

async function searchSerpApi(query: string, country: string, maxResults: number): Promise<UnifiedProduct[]> {
  if (!SERPAPI_KEY) return [];

  const params = new URLSearchParams({
    engine: "google_shopping",
    q: query,
    api_key: SERPAPI_KEY,
    gl: country.toLowerCase(),
    num: String(maxResults),
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT.serpapi),
  });

  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json() as any;
  const results = data.shopping_results || [];

  return results.slice(0, maxResults).map((item: any) => ({
    title: item.title || "",
    price: item.extracted_price || null,
    currency: "USD",
    url: item.link || item.product_link || "",
    imageUrl: item.thumbnail || null,
    rating: item.rating || null,
    reviewCount: item.reviews || null,
    store: item.source || "Online",
    isApproximate: false,
  }));
}

// ─── Method: SerpAPI Walmart ─────────────────────────

async function searchSerpApiWalmart(query: string, maxResults: number): Promise<UnifiedProduct[]> {
  if (!SERPAPI_KEY) return [];

  const params = new URLSearchParams({
    engine: "walmart",
    query,
    api_key: SERPAPI_KEY,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT.serpapi),
  });

  if (!res.ok) throw new Error(`SerpAPI Walmart ${res.status}`);
  const data = await res.json() as any;
  const results = data.organic_results || [];

  return results.slice(0, maxResults).map((item: any) => ({
    title: item.title || "",
    price: item.primary_offer?.offer_price || null,
    currency: "USD",
    url: item.product_page_url || item.link || "",
    imageUrl: item.thumbnail || null,
    rating: item.rating || null,
    reviewCount: item.reviews || null,
    store: "Walmart",
    isApproximate: false,
  }));
}

// ─── Method: SerpAPI eBay ────────────────────────────

async function searchSerpApiEbay(query: string, maxResults: number): Promise<UnifiedProduct[]> {
  if (!SERPAPI_KEY) return [];

  const params = new URLSearchParams({
    engine: "ebay",
    _nkw: query,
    api_key: SERPAPI_KEY,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    signal: AbortSignal.timeout(TIMEOUT.serpapi),
  });

  if (!res.ok) throw new Error(`SerpAPI eBay ${res.status}`);
  const data = await res.json() as any;
  const results = data.organic_results || [];

  return results.slice(0, maxResults).map((item: any) => ({
    title: item.title || "",
    price: item.price?.extracted || null,
    currency: "USD",
    url: item.link || "",
    imageUrl: item.thumbnail || null,
    rating: null,
    reviewCount: null,
    store: "eBay",
    condition: item.condition || null,
    freeShipping: item.shipping?.toLowerCase().includes("free") || false,
    isApproximate: false,
  }));
}

// ─── Method: Mercado Livre ───────────────────────────

async function searchMercadoLivre(query: string, maxResults: number): Promise<UnifiedProduct[]> {
  const { searchMeliProducts } = await import("../commerce/mercadolibre.js");
  const result = await searchMeliProducts({ query, country: "brasil", limit: maxResults });
  if (result.error || result.results.length === 0) return [];

  return result.results.map((p: any) => ({
    title: p.title,
    price: p.price,
    currency: p.currency || "BRL",
    url: p.permalink,
    imageUrl: p.thumbnail || null,
    rating: null,
    reviewCount: null,
    store: "Mercado Livre",
    condition: p.condition,
    freeShipping: p.freeShipping,
  }));
}

// ─── Method: Apify (Amazon) ─────────────────────────

async function searchApify(query: string, country: string, maxResults: number, userId?: string): Promise<UnifiedProduct[]> {
  const { searchProducts } = await import("../apify-ecommerce.service.js");
  const result = await searchProducts({ query, platform: "amazon", maxResults, country }, userId);
  if (result.products.length === 0) return [];

  return result.products.map((p: any) => ({
    title: p.title,
    price: p.price,
    currency: p.currency || "USD",
    url: p.url,
    imageUrl: p.imageUrl || null,
    rating: p.rating,
    reviewCount: p.reviewCount,
    store: "Amazon",
    asin: p.asin,
    isApproximate: false,
  }));
}

// ─── Method: Google Search Grounding (Gemini) ────────

async function searchGeminiGrounding(query: string, maxResults: number): Promise<UnifiedProduct[]> {
  if (!GEMINI_API_KEY) throw new Error("No Gemini API key");

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: [{ googleSearch: {} } as any],
  });

  const prompt = `Find "${query}" for sale online RIGHT NOW. Return JSON array, max ${maxResults} products. Format: [{"title":"...","price":299.99,"currency":"USD","url":"https://direct-product-link","store":"Best Buy","rating":4.5}]. ONLY the JSON array, nothing else. Include real product page URLs, not search pages.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, maxResults).map((p: any) => ({
      title: p.title || query,
      price: typeof p.price === "number" ? p.price : null,
      currency: p.currency || "USD",
      url: p.url || `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      imageUrl: null,
      rating: typeof p.rating === "number" ? p.rating : null,
      reviewCount: null,
      store: p.store || "Online",
      isApproximate: true,
    }));
  } catch {
    const groundingMeta = (result.response.candidates?.[0] as any)?.groundingMetadata;
    const sources = groundingMeta?.groundingChunks?.map((c: any) => c.web).filter(Boolean) || [];
    if (sources.length === 0) return [];

    return sources.slice(0, maxResults).map((s: any) => ({
      title: s.title || query,
      price: null,
      currency: "USD",
      url: s.uri || "",
      imageUrl: null,
      rating: null,
      reviewCount: null,
      store: extractStoreName(s.uri || ""),
      isApproximate: true,
    }));
  }
}

// ─── Method: Browser Agent ───────────────────────────

async function searchBrowserAgent(query: string, store: string, maxResults: number): Promise<UnifiedProduct[]> {
  const storeUrls: Record<string, string> = {
    amazon: `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
    bestbuy: `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}`,
    walmart: `https://www.walmart.com/search?q=${encodeURIComponent(query)}`,
    target: `https://www.target.com/s?searchTerm=${encodeURIComponent(query)}`,
    macys: `https://www.macys.com/shop/featured/${encodeURIComponent(query)}`,
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`,
  };

  const storeKey = store.toLowerCase().replace(/[^a-z]/g, "");
  const url = storeUrls[storeKey] || `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query + " " + store)}`;

  const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, searchTerm: query }),
    signal: AbortSignal.timeout(TIMEOUT.browserAgent),
  });

  const data = await res.json() as any;
  if (!data.success || !data.products?.length) return [];

  return data.products.slice(0, maxResults).map((p: any) => ({
    title: p.title || query,
    price: parsePrice(p.price),
    currency: "USD",
    url: p.link || p.url || url,
    imageUrl: p.image || null,
    rating: parseFloat(p.rating) || null,
    reviewCount: parseInt(p.reviews) || null,
    store: store || "Online",
  }));
}

// ─── Helpers ─────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

function parsePrice(val: unknown): number | null {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const num = parseFloat(val.replace(/[^0-9.]/g, ""));
    return isNaN(num) ? null : num;
  }
  return null;
}

function extractStoreName(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    const map: Record<string, string> = {
      "amazon.com": "Amazon", "bestbuy.com": "Best Buy", "walmart.com": "Walmart",
      "target.com": "Target", "ebay.com": "eBay", "macys.com": "Macy's",
      "ray-ban.com": "Ray-Ban", "mercadolivre.com.br": "Mercado Livre",
    };
    return map[hostname] || hostname.split(".")[0].charAt(0).toUpperCase() + hostname.split(".")[0].slice(1);
  } catch {
    return "Online";
  }
}

// ─── Format for WhatsApp/Telegram (concise) ──────────

export function formatUnifiedResults(result: UnifiedSearchResult, lang: string = "en"): string {
  if (result.products.length === 0) return "";

  const isPt = lang.includes("pt") || lang.includes("portu");

  if (result.method === "google_fallback") {
    const p = result.products[0];
    return isPt
      ? `Busque aqui:\n${p.url}`
      : `Search here:\n${p.url}`;
  }

  const lines = result.products.slice(0, 5).map((p, i) => {
    const priceStr = p.price
      ? `${p.currency === "BRL" ? "R$" : "$"}${p.price.toFixed(2)}${p.isApproximate ? " ~" : ""}`
      : (isPt ? "Ver preco" : "See price");
    const ratingStr = p.rating ? ` | ${p.rating}/5` : "";
    return `${i + 1}. ${p.title}\n   ${priceStr}${ratingStr} — ${p.store}\n   ${p.url}`;
  });

  const via = result.fromCache ? " (cached)" : "";
  return lines.join("\n\n") + via;
}
