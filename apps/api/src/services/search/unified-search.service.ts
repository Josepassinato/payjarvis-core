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
import { recordPrices } from "../shopping/price-history.service.js";

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
  /** 2-Phase Architecture: 'discovery' = Google only, 'purchase' = marketplace APIs, undefined = all (legacy) */
  phase?: "discovery" | "purchase";
}

// ─── Config ──────────────────────────────────────────
const TIMEOUT = {
  serpapi: 15000,       // 15s (increased from 10s — bug report: Google Search was timing out)
  mercadoLivre: 8000,
  apify: 15000,
  grounding: 18000,     // 18s (increased from 12s — was timing out in discovery phase)
  browserAgent: 12000,  // 12s
} as const;

const PARALLEL_TIMEOUT = 25000; // Global timeout: return whatever we have after 25s
const EARLY_RETURN_MS = 8000;   // If a high-priority source succeeds within 8s, return immediately
const CACHE_TTL = 3600;         // 1 hour

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";

// ─── Main Entry Point (PARALLEL) ─────────────────────

export async function unifiedProductSearch(opts: SearchOptions): Promise<UnifiedSearchResult> {
  const { query, store, country = "US", zipCode, maxResults = 5, userId, phase } = opts;
  const isBrazil = country === "BR" || country === "brasil" || country === "Brazil";
  const storeQuery = store ? `${query} ${store}` : query;
  const isDiscovery = phase === "discovery";
  const isPurchase = phase === "purchase";

  console.log(`[UNIFIED-SEARCH] query="${query}" store="${store || "any"}" country="${country}" phase="${phase || "all"}"`);

  // ─── Check Redis cache first ───────────────────────
  const cacheKey = `search:products:${query.toLowerCase().trim()}:${store || "any"}:${country}:${phase || "all"}`;
  try {
    const cached = await redisGet(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as UnifiedSearchResult;
      if (parsed.products && parsed.products.length > 0) {
        console.log(`[UNIFIED-SEARCH] CACHE HIT "${query}" (method=${parsed.method}, ${parsed.products.length} products, phase=${phase || "all"})`);
        return { ...parsed, methodsAttempted: ["cache"], fromCache: true };
      }
    }
  } catch { /* corrupted cache, proceed */ }

  // ─── Build sources array ───────────────────────────
  // 2-PHASE ARCHITECTURE:
  //   discovery = Google only (SerpAPI Google Shopping + Gemini Grounding)
  //   purchase  = Marketplace APIs only (Walmart, eBay, ML, Apify, Browser)
  //   undefined = all sources (legacy/backward compat)
  type Source = { name: string; fn: () => Promise<UnifiedProduct[]>; priority: number };
  const sources: Source[] = [];

  // ── GOOGLE SOURCES (Phase 1: Discovery + legacy) ──
  if (!isPurchase) {
    // SerpAPI Google Shopping — fastest, covers 100+ stores
    if (SERPAPI_KEY) {
      sources.push({ name: "serpapi", fn: () => withTimeout(searchSerpApi(storeQuery, country, maxResults), TIMEOUT.serpapi), priority: 1 });
    }

    // Google Search Grounding — free, works well for general queries
    if (GEMINI_API_KEY) {
      sources.push({ name: "grounding", fn: () => withTimeout(searchGeminiGrounding(storeQuery, maxResults), TIMEOUT.grounding), priority: store ? 4 : 2 });
    }

    // Apify as FALLBACK in discovery — low priority so Google sources win if they work,
    // but prevents total failure when SerpAPI is rate-limited (429) and grounding times out
    if (isDiscovery) {
      sources.push({ name: "apify", fn: () => withTimeout(searchApify(query, country, maxResults, userId), TIMEOUT.apify), priority: 5 });
    }
  }

  // ── MARKETPLACE SOURCES (Phase 2: Purchase + legacy + direct_store) ──
  if (!isDiscovery) {
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
    const isAmazon = store && store.toLowerCase().includes("amazon");
    sources.push({ name: "apify", fn: () => withTimeout(searchApify(query, country, maxResults, userId), TIMEOUT.apify), priority: isAmazon ? 1 : 3 });

    // Browser Agent — last resort, slow
    if (store) {
      sources.push({ name: "browser", fn: () => withTimeout(searchBrowserAgent(query, store, maxResults), TIMEOUT.browserAgent), priority: 5 });
    }
  }

  if (isDiscovery) {
    console.log(`[PHASE-1][DISCOVERY] Google-only search: ${sources.map(s => s.name).join(", ")} for query="${query}"`);
  } else if (isPurchase) {
    console.log(`[PHASE-2][PURCHASE] Marketplace search: ${sources.map(s => s.name).join(", ")} for query="${query}"`);
  }

  // ─── Run ALL sources in parallel with early return ──
  const methodsAttempted: string[] = [];
  const successfulSources: Array<{ name: string; products: UnifiedProduct[]; priority: number }> = [];

  // Start all sources running
  const sourcePromises = sources.map((s, i) =>
    s.fn()
      .then((products) => ({ index: i, products, error: null as string | null }))
      .catch((err) => ({ index: i, products: [] as UnifiedProduct[], error: (err as Error).message }))
  );

  // Early return: resolve as soon as a high-priority source (priority <= 2) returns 2+ results
  // OR after EARLY_RETURN_MS, whichever comes first. Other sources keep running for enrichment up to PARALLEL_TIMEOUT.
  const earlyReturnPromise = new Promise<void>((resolve) => {
    let resolved = false;
    const checkEarly = (result: { index: number; products: UnifiedProduct[]; error: string | null }) => {
      if (resolved) return;
      const src = sources[result.index];
      methodsAttempted.push(src.name);
      if (result.products.length > 0) {
        console.log(`[UNIFIED-SEARCH] ✓ ${src.name} returned ${result.products.length} results`);
        successfulSources.push({ name: src.name, products: result.products, priority: src.priority });
        // Early return if high-priority source with results
        if (src.priority <= 2 && result.products.length >= 1) {
          resolved = true;
          console.log(`[UNIFIED-SEARCH] EARLY RETURN: ${src.name} (priority ${src.priority}, ${result.products.length} results)`);
          resolve();
        }
      } else {
        console.log(`[UNIFIED-SEARCH] ✗ ${src.name}: ${result.error || "0 results"}`);
      }
    };
    sourcePromises.forEach((p) => p.then(checkEarly));
    // Safety: resolve after EARLY_RETURN_MS even if no early return triggered
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, EARLY_RETURN_MS);
  });

  // Wait for early return OR the timeout
  await earlyReturnPromise;

  // If no results yet, wait for remaining sources up to PARALLEL_TIMEOUT
  if (successfulSources.length === 0) {
    console.log(`[UNIFIED-SEARCH] No early results — waiting for remaining sources...`);
    const remainingResults = await withTimeout(
      Promise.allSettled(sourcePromises),
      PARALLEL_TIMEOUT - EARLY_RETURN_MS,
    ).catch(() => {
      console.log(`[UNIFIED-SEARCH] Global timeout — using partial results`);
      return [] as PromiseSettledResult<{ index: number; products: UnifiedProduct[]; error: string | null }>[];
    });

    for (const result of remainingResults) {
      if (result.status === "fulfilled") {
        const r = result.value;
        const src = sources[r.index];
        if (!methodsAttempted.includes(src.name)) {
          methodsAttempted.push(src.name);
          if (r.products.length > 0) {
            console.log(`[UNIFIED-SEARCH] ✓ ${src.name} returned ${r.products.length} results (late)`);
            successfulSources.push({ name: src.name, products: r.products, priority: src.priority });
          } else {
            console.log(`[UNIFIED-SEARCH] ✗ ${src.name}: ${r.error || "0 results"} (late)`);
          }
        }
      }
    }
  }

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

    // Filter by store if user specified a marketplace
    const storeFiltered = store ? filterByStore(allProducts, store) : allProducts;
    // Use filtered results if we got any; otherwise fall back to unfiltered
    const productsToSort = storeFiltered.length > 0 ? storeFiltered : allProducts;

    // Clean URLs: replace Google search/shopping URLs with direct store links
    for (const p of productsToSort) {
      p.url = cleanProductUrl(p.url, p.title, p.store);
    }

    // Sort by price (nulls last), cap at maxResults
    const finalProducts = productsToSort
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
      ...(store && storeFiltered.length === 0 ? { storeNotFound: true } : {}),
    } as UnifiedSearchResult & { storeNotFound?: boolean };

    // Cache successful results
    redisSet(cacheKey, JSON.stringify(searchResult), CACHE_TTL).catch(() => {});

    // Record prices for history tracking (async, non-blocking)
    recordSearchPrices(finalProducts).catch(() => {});

    return searchResult;
  }

  // ─── ALL FAILED — return empty results with error flag ──────
  // NEVER return fake products — this causes LLM hallucination of prices/links
  console.log(`[UNIFIED-SEARCH] ALL methods failed for "${query}". Returning empty results with searchFailed flag.`);
  methodsAttempted.push("all_failed");
  return {
    products: [],
    method: "all_failed",
    methodsAttempted,
    query,
    store,
    totalResults: 0,
    searchFailed: true,
  } as UnifiedSearchResult & { searchFailed: boolean };
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
    url: (item.link && !item.link.includes("google.com/")) ? item.link : (item.product_link || item.link || ""),
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
    rating: p.rating ?? null,
    reviewCount: p.reviewCount ?? null,
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
      url: cleanProductUrl(p.url || "", p.title || query, p.store || "Online"),
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
      url: cleanProductUrl(s.uri || "", s.title || query, extractStoreName(s.uri || "")),
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
  const url = storeUrls[storeKey] || buildDirectStoreUrl(query, store);

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

// ─── Price History Integration ───────────────────────

async function recordSearchPrices(products: UnifiedProduct[]): Promise<void> {
  const items = products
    .filter(p => p.price !== null && p.price > 0)
    .map(p => ({
      identifier: p.asin || p.title,
      store: p.store,
      price: p.price!,
      currency: p.currency,
    }));
  if (items.length > 0) {
    await recordPrices(items);
  }
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

// ─── Store filtering (Bug 3 fix) ───────────────────
// When user specifies "na Amazon" or "on eBay", filter results to only that marketplace
function filterByStore(products: UnifiedProduct[], requestedStore: string): UnifiedProduct[] {
  const norm = requestedStore.toLowerCase().replace(/[^a-z0-9]/g, "");
  const storeAliases: Record<string, string[]> = {
    amazon: ["amazon"],
    walmart: ["walmart"],
    ebay: ["ebay"],
    target: ["target"],
    bestbuy: ["bestbuy", "best buy"],
    macys: ["macys", "macy's", "macy"],
    mercadolivre: ["mercadolivre", "mercado livre", "mercadolibre", "mercado libre", "ml"],
    jomashop: ["jomashop"],
    fragrancenet: ["fragrancenet", "fragrance net"],
  };

  // Find which store group matches
  let matchKeys: string[] = [];
  for (const [, aliases] of Object.entries(storeAliases)) {
    if (aliases.some(a => norm.includes(a.replace(/[^a-z0-9]/g, "")))) {
      matchKeys = aliases;
      break;
    }
  }
  // Fallback: match by substring
  if (matchKeys.length === 0) matchKeys = [norm];

  return products.filter(p => {
    const pStore = p.store.toLowerCase();
    const pUrl = p.url.toLowerCase();
    return matchKeys.some(k => pStore.includes(k) || pUrl.includes(k));
  });
}

// ─── URL Cleanup (Bug 1 fix — v2 2026-04-06) ────────
// ABSOLUTE RULE: NEVER return a google.com URL to the user.
// Priority: extract embedded real URL → store search URL → Amazon search fallback.
function cleanProductUrl(url: string, title: string, store: string): string {
  // If URL is already a direct product link (not google.com), keep it
  if (!url.includes("google.com")) return url;

  // 1. Try to extract the REAL product URL from Google redirect parameters
  try {
    const parsed = new URL(url);
    const embedded = parsed.searchParams.get("url")
      || parsed.searchParams.get("adurl")
      || parsed.searchParams.get("merchant_purl")
      || parsed.searchParams.get("q");
    if (embedded && embedded.startsWith("http") && !embedded.includes("google.com")) return embedded;

    // Google Shopping product pages sometimes embed merchant URL in prds param
    const prds = parsed.searchParams.get("prds") || "";
    const merchantMatch = prds.match(/murl:([^,]+)/);
    if (merchantMatch) {
      const decoded = decodeURIComponent(merchantMatch[1]);
      if (!decoded.includes("google.com")) return decoded;
    }
  } catch { /* malformed URL, fall through */ }

  // 2. Build a direct store search URL — NEVER return google.com
  return buildDirectStoreUrl(title, store);
}

// ─── Build direct store URL (NEVER returns google.com) ──
function buildDirectStoreUrl(productName: string, storeName: string): string {
  const q = encodeURIComponent((productName || "").substring(0, 100));
  const storeKey = (storeName || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const storeSearchUrls: Record<string, string> = {
    amazon: `https://www.amazon.com/s?k=${q}`,
    walmart: `https://www.walmart.com/search?q=${q}`,
    target: `https://www.target.com/s?searchTerm=${q}`,
    bestbuy: `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`,
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${q}`,
    macys: `https://www.macys.com/shop/featured/${q}`,
    jomashop: `https://www.jomashop.com/search?q=${q}`,
    fragrancenet: `https://www.fragrancenet.com/search?q=${q}`,
    sephora: `https://www.sephora.com/search?keyword=${q}`,
    scentsangel: `https://www.scentsangel.com/search?q=${q}`,
    mercadolivre: `https://lista.mercadolivre.com.br/${q}`,
    mercadolibre: `https://lista.mercadolivre.com.br/${q}`,
    nordstrom: `https://www.nordstrom.com/sr?keyword=${q}`,
    costco: `https://www.costco.com/CatalogSearch?keyword=${q}`,
    homedepot: `https://www.homedepot.com/s/${q}`,
    lowes: `https://www.lowes.com/search?searchTerm=${q}`,
    newegg: `https://www.newegg.com/p/pl?d=${q}`,
    nike: `https://www.nike.com/w?q=${q}`,
    adidas: `https://www.adidas.com/us/search?q=${q}`,
    ulta: `https://www.ulta.com/search?query=${q}`,
    bathandbodyworks: `https://www.bathandbodyworks.com/search?q=${q}`,
  };

  // Exact match
  if (storeSearchUrls[storeKey]) return storeSearchUrls[storeKey];

  // Fuzzy match — check if store name contains a known key
  for (const [key, url] of Object.entries(storeSearchUrls)) {
    if (storeKey.includes(key) || key.includes(storeKey)) return url;
  }

  // Unknown store — default to Amazon search (NEVER google.com)
  return `https://www.amazon.com/s?k=${q}`;
}

// ─── Format for WhatsApp/Telegram (concise) ──────────

export function formatUnifiedResults(result: UnifiedSearchResult, lang: string = "en"): string {
  if (result.products.length === 0) return "";

  // SAFETY NET: sanitize any google.com URLs that slipped through
  for (const p of result.products) {
    if (p.url.includes("google.com")) {
      console.warn(`[CLEAN_URL] BLOCKED google.com URL in final output: ${p.url}`);
      p.url = buildDirectStoreUrl(p.title, p.store);
    }
  }

  const isPt = lang.includes("pt") || lang.includes("portu");

  if (result.method === "store_fallback" || result.method === "google_fallback") {
    const p = result.products[0];
    return isPt
      ? `Busque aqui:\n${p.url}`
      : `Search here:\n${p.url}`;
  }

  const lines = result.products.slice(0, 5).map((p, i) => {
    const priceStr = p.price
      ? `${p.currency === "BRL" ? "R$" : "$"}${p.price.toFixed(2)}${p.isApproximate ? " ~" : ""}`
      : (isPt ? "Ver preço" : "See price");
    const ratingStr = p.rating ? ` | ${p.rating}/5` : "";
    return `${i + 1}. ${p.title}\n   ${priceStr}${ratingStr} — ${p.store}\n   ${p.url}`;
  });

  const via = result.fromCache ? " (cached)" : "";
  return lines.join("\n\n") + via;
}
