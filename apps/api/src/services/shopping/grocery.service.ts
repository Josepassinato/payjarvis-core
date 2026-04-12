/**
 * Grocery Service — Search supermarket products with location awareness
 *
 * US stores: Publix, Walmart, Target (via Gemini Grounding + retail-service)
 * BR stores: Carrefour, Pão de Açúcar, Rappi, iFood (via Gemini Grounding)
 *
 * Reuses existing infrastructure:
 * - Gemini Grounding (Google Search) with grocery filters
 * - Publix service (browser-agent)
 * - Price history tracking
 * - Future: Playwright for stores without official APIs
 */

import { prisma } from "@payjarvis/database";
import { recordPrices } from "./price-history.service.js";

// ─── Types ──────────────────────────────────────────────

export interface GroceryItem {
  name: string;
  brand: string | null;
  price: number | null;
  unitPrice: string | null; // e.g. "$0.29/oz"
  store: string;
  available: boolean;
  imageUrl: string | null;
  url: string;
  onSale: boolean;
  savings: number | null; // dollars saved if on sale
}

export interface GroceryStoreResult {
  store: string;
  items: GroceryItem[];
  subtotal: number;
  deliveryFee: number | null;
  estimatedTotal: number;
  deliveryTime: string | null; // e.g. "2 hours", "same day"
}

export interface GrocerySearchResult {
  items: GroceryItem[];
  byStore: GroceryStoreResult[];
  bestStore: string | null; // cheapest total
  query: string;
  zipCode: string | null;
  country: string;
}

type GroceryRegion = "us" | "br";

// ─── Config ──────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TIMEOUT_MS = 8000;

const US_GROCERY_STORES = ["Publix", "Walmart", "Target", "Costco", "Whole Foods", "Kroger"];
const BR_GROCERY_STORES = ["Carrefour", "Pão de Açúcar", "Extra", "Rappi", "iFood"];

const DELIVERY_FEES: Record<string, number> = {
  "Publix": 3.99, // via Instacart
  "Walmart": 0,   // free delivery $35+
  "Target": 9.99, // via Shipt
  "Costco": 3.99, // via Instacart
  "Whole Foods": 0, // free for Prime
  "Kroger": 6.95,
  "Carrefour": 9.90, // BRL
  "Pão de Açúcar": 12.90, // BRL
  "Rappi": 5.99, // BRL
  "iFood": 7.99, // BRL
};

// ─── Region Detection ───────────────────────────────────

function detectRegion(zipCode?: string, country?: string, language?: string): GroceryRegion {
  if (country && (country.toLowerCase() === "br" || country.toLowerCase() === "brasil" || country.toLowerCase() === "brazil")) return "br";
  if (zipCode && /^\d{5}-?\d{3}$/.test(zipCode)) return "br"; // Brazilian CEP format
  if (language && language.toLowerCase().startsWith("pt") && !country) return "br"; // PT speaker without explicit country
  return "us";
}

// ─── PT→EN Translation for US grocery searches ──────────

const PT_EN_GROCERY: Record<string, string> = {
  "leite": "milk", "ovos": "eggs", "ovo": "egg", "pão": "bread", "pao": "bread",
  "café": "coffee", "cafe": "coffee", "manteiga": "butter", "queijo": "cheese",
  "arroz": "rice", "feijão": "beans", "feijao": "beans", "açúcar": "sugar",
  "acucar": "sugar", "sal": "salt", "óleo": "cooking oil", "oleo": "cooking oil",
  "azeite": "olive oil", "farinha": "flour", "macarrão": "pasta", "macarrao": "pasta",
  "frango": "chicken", "carne": "beef", "porco": "pork", "peixe": "fish",
  "camarão": "shrimp", "camarao": "shrimp", "presunto": "ham", "salsicha": "sausage",
  "tomate": "tomato", "cebola": "onion", "alho": "garlic", "batata": "potato",
  "cenoura": "carrot", "alface": "lettuce", "banana": "banana", "maçã": "apple",
  "maca": "apple", "laranja": "orange", "limão": "lemon", "limao": "lemon",
  "morango": "strawberry", "uva": "grape", "abacate": "avocado",
  "iogurte": "yogurt", "creme de leite": "heavy cream", "leite condensado": "condensed milk",
  "sorvete": "ice cream", "chocolate": "chocolate", "biscoito": "cookie",
  "suco": "juice", "água": "water", "agua": "water", "cerveja": "beer",
  "vinho": "wine", "refrigerante": "soda", "papel higiênico": "toilet paper",
  "papel higienico": "toilet paper", "sabonete": "soap", "shampoo": "shampoo",
  "detergente": "dish soap", "sabão em pó": "laundry detergent",
};

function translateGroceryQuery(query: string, region: GroceryRegion): string {
  if (region !== "us") return query; // Only translate when searching US stores
  const words = query.toLowerCase().trim();
  // Check for exact match first
  if (PT_EN_GROCERY[words]) return PT_EN_GROCERY[words];
  // Check for partial match (multi-word items)
  for (const [pt, en] of Object.entries(PT_EN_GROCERY)) {
    if (words.includes(pt)) {
      return words.replace(pt, en);
    }
  }
  return query; // Return as-is if no translation found
}

// ─── Gemini Grounding Grocery Search ─────────────────────

async function searchGeminiGrocery(
  query: string,
  store: string | null,
  region: GroceryRegion,
  maxResults: number,
  city?: string,
): Promise<GroceryItem[]> {
  if (!GEMINI_API_KEY) return [];

  const translatedQuery = translateGroceryQuery(query, region);
  const storeFilter = store ? ` at ${store}` : "";
  const cityFilter = city ? ` in ${city}` : "";
  const regionContext = region === "br" ? "Brazil supermarket delivery" : "US grocery";

  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = `Search for "${translatedQuery}" grocery products${storeFilter}${cityFilter} (${regionContext}). Return ONLY a JSON array of max ${maxResults} products currently available: [{"name":"Product Name","brand":"Brand","price":4.99,"unitPrice":"$0.25/oz","store":"Store Name","available":true,"url":"https://...","onSale":false,"savings":null}]. Use real current prices. ONLY JSON, no markdown.`;

    const result = await model.generateContent(prompt);
    let text: string;
    try { text = result.response.text(); } catch { text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || ""; }
    if (!text) return [];

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as any[];
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, maxResults).map((item: any) => ({
      name: item.name || item.title || "",
      brand: item.brand || extractBrand(item.name || ""),
      price: typeof item.price === "number" ? item.price : null,
      unitPrice: item.unitPrice || null,
      store: item.store || store || "Online",
      available: item.available !== false,
      imageUrl: item.imageUrl || null,
      url: item.url || "",
      onSale: item.onSale === true,
      savings: typeof item.savings === "number" ? item.savings : null,
    }));
  } catch (err) {
    console.error(`[GROCERY] Gemini search failed:`, (err as Error).message);
    return [];
  }
}

function extractBrand(title: string): string | null {
  const commonBrands = [
    "Parmalat", "Nestlé", "Folgers", "Keurig", "Starbucks", "Great Value",
    "Publix", "Lactaid", "Organic Valley", "Horizon", "Fairlife",
    "Wonder", "Nature's Own", "Sara Lee", "Land O Lakes", "Kerrygold",
    "Eggland's", "Vital Farms", "Pete and Gerry's",
    // BR brands
    "Piracanjuba", "Itambé", "Pilão", "Melitta", "3 Corações", "Pullman",
    "Bauduco", "Presidente", "Sadia", "Perdigão", "Seara",
  ];
  for (const brand of commonBrands) {
    if (title.toLowerCase().includes(brand.toLowerCase())) return brand;
  }
  return null;
}

// ─── Main Search Function ───────────────────────────────

export async function searchGrocery(opts: {
  query: string;
  zipCode?: string;
  store?: string;
  country?: string;
  city?: string;
  language?: string;
  maxResults?: number;
}): Promise<GrocerySearchResult> {
  const { query, zipCode, store, country, city, language, maxResults = 5 } = opts;
  const region = detectRegion(zipCode, country, language);
  const startTime = Date.now();

  console.log(`[GROCERY] Searching: "${query}" store=${store || "any"} region=${region} zip=${zipCode || "?"}`);

  // Run searches in parallel
  type Source = { name: string; fn: () => Promise<GroceryItem[]> };
  const sources: Source[] = [];

  if (store) {
    // User specified a store — search only that store
    sources.push({ name: store, fn: () => searchGeminiGrocery(query, store, region, maxResults) });
  } else {
    // Search multiple stores in parallel
    if (region === "us") {
      sources.push({ name: "Walmart", fn: () => searchGeminiGrocery(query, "Walmart", region, maxResults) });
      sources.push({ name: "Google Grocery", fn: () => searchGeminiGrocery(query, null, region, maxResults) });
      sources.push({ name: "Publix", fn: () => searchGeminiGrocery(query, "Publix", region, 3) });
      sources.push({ name: "Target", fn: () => searchGeminiGrocery(query, "Target grocery", region, 3) });
    } else {
      // Brazil — search store-specific and aggregators
      const city = opts.city || "";
      sources.push({ name: "Carrefour", fn: () => searchGeminiGrocery(query, "Carrefour", region, 3, city) });
      sources.push({ name: "Pão de Açúcar", fn: () => searchGeminiGrocery(query, "Pão de Açúcar", region, 3, city) });
      sources.push({ name: "Rappi", fn: () => searchGeminiGrocery(query, "Rappi", region, 3, city) });
      sources.push({ name: "Google BR", fn: () => searchGeminiGrocery(query, null, region, maxResults, city) });
    }
  }

  // Early return pattern (same as unified-search)
  const allItems: GroceryItem[] = [];
  const EARLY_RETURN_MS = 6000;

  const sourcePromises = sources.map((s) =>
    s.fn()
      .then((items) => ({ name: s.name, items, error: null as string | null }))
      .catch((err) => ({ name: s.name, items: [] as GroceryItem[], error: (err as Error).message }))
  );

  const earlyPromise = new Promise<void>((resolve) => {
    let resolved = false;
    sourcePromises.forEach((p) =>
      p.then((r) => {
        if (r.items.length > 0) {
          console.log(`[GROCERY] ✓ ${r.name}: ${r.items.length} items`);
          allItems.push(...r.items);
          if (!resolved && allItems.length >= 3) {
            resolved = true;
            resolve();
          }
        } else {
          console.log(`[GROCERY] ✗ ${r.name}: ${r.error || "0 items"}`);
        }
      })
    );
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, EARLY_RETURN_MS);
  });

  await earlyPromise;

  // Wait for remaining if we got nothing
  if (allItems.length === 0) {
    const remaining = await Promise.allSettled(sourcePromises);
    for (const r of remaining) {
      if (r.status === "fulfilled" && r.value.items.length > 0) {
        allItems.push(...r.value.items);
      }
    }
  }

  // Group by store
  const storeMap = new Map<string, GroceryItem[]>();
  for (const item of allItems) {
    if (!item.price) continue;
    const key = normalizeStoreName(item.store);
    const list = storeMap.get(key) || [];
    list.push(item);
    storeMap.set(key, list);
  }

  const byStore: GroceryStoreResult[] = [];
  for (const [storeName, items] of storeMap) {
    const subtotal = items.reduce((sum, i) => sum + (i.price || 0), 0);
    const fee = DELIVERY_FEES[storeName] ?? null;
    byStore.push({
      store: storeName,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      deliveryFee: fee,
      estimatedTotal: Math.round((subtotal + (fee || 0)) * 100) / 100,
      deliveryTime: getEstimatedDelivery(storeName),
    });
  }

  // Sort by total (cheapest first)
  byStore.sort((a, b) => a.estimatedTotal - b.estimatedTotal);

  // Record prices for history tracking
  const forHistory = allItems
    .filter((i) => i.price)
    .map((i) => ({
      identifier: i.name,
      store: i.store,
      price: i.price!,
      currency: region === "br" ? "BRL" : "USD",
    }));
  recordPrices(forHistory).catch(() => {});

  const duration = Date.now() - startTime;
  console.log(`[GROCERY] Done in ${duration}ms: ${allItems.length} items from ${storeMap.size} stores`);

  return {
    items: allItems,
    byStore,
    bestStore: byStore[0]?.store || null,
    query,
    zipCode: zipCode || null,
    country: region === "br" ? "BR" : "US",
  };
}

// ─── Build Grocery List ─────────────────────────────────

export async function buildGroceryList(opts: {
  items: string[]; // ["leite", "ovos", "pão"]
  zipCode?: string;
  store?: string;
  country?: string;
  city?: string;
  language?: string;
  userId?: string;
}): Promise<{
  stores: GroceryStoreResult[];
  bestStore: string | null;
  totalSavings: number;
  recommendation: string;
}> {
  const { items, zipCode, store, country, userId } = opts;
  const region = detectRegion(zipCode, country);

  console.log(`[GROCERY-LIST] Building list: ${items.length} items, store=${store || "any"}, region=${region}`);

  // Check user habits for brand preferences
  let habits: Array<{ item_name: string; preferred_brand: string | null; preferred_store: string }> = [];
  if (userId) {
    try {
      const dbUser = await prisma.user.findFirst({
        where: { OR: [{ phone: userId.replace("whatsapp:", "") }, { telegramChatId: userId }] },
        select: { id: true },
      });
      if (dbUser) {
        habits = await prisma.$queryRaw<typeof habits>`
          SELECT item_name, preferred_brand, preferred_store FROM grocery_habits
          WHERE user_id = ${dbUser.id}
        `;
      }
    } catch { /* table may not exist yet */ }
  }

  // Search each item (batch parallel, max 3 concurrent)
  const searchResults: Array<{ item: string; results: GroceryItem[] }> = [];
  const batchSize = 3;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        // Use preferred brand if known
        const habit = habits.find((h) => h.item_name.toLowerCase() === item.toLowerCase());
        const searchQuery = habit?.preferred_brand ? `${habit.preferred_brand} ${item}` : item;
        const result = await searchGrocery({
          query: searchQuery,
          zipCode,
          store: store || habit?.preferred_store,
          country,
          city: opts.city,
          language: opts.language,
          maxResults: 3,
        });
        return { item, results: result.items };
      })
    );

    for (const r of batchResults) {
      if (r.status === "fulfilled") {
        searchResults.push(r.value);
      }
    }
  }

  // Aggregate by store: for each store, pick the best item for each search
  const storeItems = new Map<string, { items: GroceryItem[]; subtotal: number }>();

  for (const { item, results } of searchResults) {
    // Group this item's results by store
    const byStore = new Map<string, GroceryItem>();
    for (const r of results) {
      if (!r.price) continue;
      const key = normalizeStoreName(r.store);
      if (!byStore.has(key) || r.price < (byStore.get(key)!.price || Infinity)) {
        byStore.set(key, r);
      }
    }

    // Add cheapest item per store
    for (const [storeName, bestItem] of byStore) {
      const entry = storeItems.get(storeName) || { items: [], subtotal: 0 };
      entry.items.push(bestItem);
      entry.subtotal += bestItem.price || 0;
      storeItems.set(storeName, entry);
    }
  }

  // Build store results
  const stores: GroceryStoreResult[] = [];
  for (const [storeName, { items: storeItemList, subtotal }] of storeItems) {
    const fee = DELIVERY_FEES[storeName] ?? null;
    stores.push({
      store: storeName,
      items: storeItemList,
      subtotal: Math.round(subtotal * 100) / 100,
      deliveryFee: fee,
      estimatedTotal: Math.round((subtotal + (fee || 0)) * 100) / 100,
      deliveryTime: getEstimatedDelivery(storeName),
    });
  }

  stores.sort((a, b) => a.estimatedTotal - b.estimatedTotal);

  const bestStore = stores[0]?.store || null;
  const worstTotal = stores[stores.length - 1]?.estimatedTotal || 0;
  const bestTotal = stores[0]?.estimatedTotal || 0;
  const totalSavings = Math.round((worstTotal - bestTotal) * 100) / 100;

  const symbol = region === "br" ? "R$" : "$";
  let recommendation = "";
  if (stores.length >= 2) {
    recommendation = `${bestStore} is cheapest at ${symbol}${bestTotal.toFixed(2)} (saves ${symbol}${totalSavings.toFixed(2)} vs ${stores[stores.length - 1]?.store})`;
  } else if (stores.length === 1) {
    recommendation = `Found everything at ${bestStore} for ${symbol}${bestTotal.toFixed(2)}`;
  } else {
    recommendation = "No grocery stores found for these items.";
  }

  console.log(`[GROCERY-LIST] Done: ${stores.length} stores, best=${bestStore} (${symbol}${bestTotal.toFixed(2)})`);

  return { stores, bestStore, totalSavings, recommendation };
}

// ─── Helpers ────────────────────────────────────────────

function normalizeStoreName(store: string): string {
  const s = store.toLowerCase();
  if (s.includes("publix")) return "Publix";
  if (s.includes("walmart")) return "Walmart";
  if (s.includes("target")) return "Target";
  if (s.includes("costco")) return "Costco";
  if (s.includes("whole foods") || s.includes("wholefoods")) return "Whole Foods";
  if (s.includes("kroger")) return "Kroger";
  if (s.includes("carrefour")) return "Carrefour";
  if (s.includes("pão de açúcar") || s.includes("pao de acucar")) return "Pão de Açúcar";
  if (s.includes("rappi")) return "Rappi";
  if (s.includes("ifood")) return "iFood";
  return store;
}

function getEstimatedDelivery(store: string): string | null {
  const times: Record<string, string> = {
    "Publix": "2-3 hours (Instacart)",
    "Walmart": "Same day or next day",
    "Target": "Same day (Shipt)",
    "Costco": "2-3 hours (Instacart)",
    "Whole Foods": "2 hours (Amazon Fresh)",
    "Kroger": "Same day",
    "Carrefour": "2-4 horas",
    "Pão de Açúcar": "2-4 horas",
    "Rappi": "30min-1 hora",
    "iFood": "30min-1 hora",
  };
  return times[store] || null;
}

// ─── Grocery Habits ─────────────────────────────────────

export async function recordGroceryHabit(
  userId: string,
  itemName: string,
  brand: string | null,
  store: string,
  price: number,
): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO grocery_habits (user_id, item_name, preferred_brand, preferred_store, avg_price, last_purchased_at, updated_at)
      VALUES (${userId}, ${itemName}, ${brand}, ${store}, ${price}, NOW(), NOW())
      ON CONFLICT (user_id, item_name) DO UPDATE SET
        preferred_brand = COALESCE(EXCLUDED.preferred_brand, grocery_habits.preferred_brand),
        preferred_store = EXCLUDED.preferred_store,
        avg_price = (grocery_habits.avg_price + EXCLUDED.avg_price) / 2,
        purchase_count = grocery_habits.purchase_count + 1,
        last_purchased_at = NOW(),
        updated_at = NOW()
    `;
  } catch (err) {
    console.error("[GROCERY-HABITS] Error:", (err as Error).message);
  }
}

export async function getGroceryHabits(userId: string): Promise<Array<{
  item_name: string;
  preferred_brand: string | null;
  preferred_store: string;
  avg_price: number;
  purchase_count: number;
  last_purchased_at: Date;
}>> {
  try {
    return await prisma.$queryRaw`
      SELECT item_name, preferred_brand, preferred_store, avg_price, purchase_count, last_purchased_at
      FROM grocery_habits WHERE user_id = ${userId}
      ORDER BY purchase_count DESC
    `;
  } catch {
    return [];
  }
}
