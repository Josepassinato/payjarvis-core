/**
 * Price History Service — Track prices over time, tell users if it's a good deal.
 *
 * Sources:
 *   1. Internal price_history table (every search logs price)
 *   2. CamelCamelCamel via SerpAPI (Amazon US ASIN lookup)
 *   3. Google Shopping price trends via SerpAPI
 *
 * Indicators:
 *   🟢 "Great price!" — below 30-day average
 *   🟡 "Normal price" — within ±5% of average
 *   🔴 "Price is high — consider waiting" — above average
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";

const SERPAPI_KEY = process.env.SERPAPI_KEY || "";

export interface PriceHistoryResult {
  indicator: "great" | "normal" | "high";
  emoji: string;
  currentPrice: number;
  avg30d: number | null;
  lowestEver: number | null;
  lowestStore: string | null;
  recommendation: string;
  recommendationPt: string;
  dataPoints: number;
}

/**
 * Record a price observation (called after every product search).
 */
export async function recordPrice(
  productIdentifier: string,
  store: string,
  price: number,
  currency: string = "USD"
): Promise<void> {
  try {
    await prisma.priceHistory.create({
      data: { productIdentifier: normalizeId(productIdentifier), store, price, currency },
    });
  } catch {
    // Don't fail the search if logging fails
  }
}

/**
 * Record multiple prices from a search result batch.
 */
export async function recordPrices(
  items: Array<{ identifier: string; store: string; price: number; currency?: string }>
): Promise<void> {
  if (items.length === 0) return;
  try {
    await prisma.priceHistory.createMany({
      data: items.map((i) => ({
        productIdentifier: normalizeId(i.identifier),
        store: i.store,
        price: i.price,
        currency: i.currency || "USD",
      })),
      skipDuplicates: true,
    });
  } catch {
    // Don't fail
  }
}

/**
 * Check price history for a product and return recommendation.
 */
export async function checkPriceHistory(
  productName: string,
  currentPrice: number,
  store?: string,
  asin?: string
): Promise<PriceHistoryResult> {
  const identifier = normalizeId(asin || productName);
  const cacheKey = `price_hist:${identifier}`;
  const cached = await redisGet(cacheKey);

  let avg30d: number | null = null;
  let lowestEver: number | null = null;
  let lowestStore: string | null = null;
  let dataPoints = 0;

  // 1. Check internal history
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  if (cached) {
    const c = JSON.parse(cached);
    avg30d = c.avg30d;
    lowestEver = c.lowestEver;
    lowestStore = c.lowestStore;
    dataPoints = c.dataPoints;
  } else {
    try {
      // Average price last 30 days
      const avgResult = await prisma.priceHistory.aggregate({
        where: {
          productIdentifier: identifier,
          recordedAt: { gte: thirtyDaysAgo },
        },
        _avg: { price: true },
        _count: { price: true },
      });
      avg30d = avgResult._avg.price ? Math.round(avgResult._avg.price * 100) / 100 : null;
      dataPoints = avgResult._count.price;

      // Lowest ever
      const lowestResult = await prisma.priceHistory.findFirst({
        where: { productIdentifier: identifier },
        orderBy: { price: "asc" },
        select: { price: true, store: true },
      });
      if (lowestResult) {
        lowestEver = lowestResult.price;
        lowestStore = lowestResult.store;
      }

      // Cache for 2h
      await redisSet(cacheKey, JSON.stringify({ avg30d, lowestEver, lowestStore, dataPoints }), 7200);
    } catch (err) {
      console.error("[PRICE-HISTORY] DB query failed:", (err as Error).message);
    }
  }

  // 2. If no internal data and we have ASIN, try CamelCamelCamel via SerpAPI
  if (dataPoints < 3 && asin && SERPAPI_KEY) {
    const camelData = await fetchCamelData(asin);
    if (camelData) {
      if (camelData.lowest !== null) {
        lowestEver = lowestEver !== null ? Math.min(lowestEver, camelData.lowest) : camelData.lowest;
        lowestStore = "Amazon (historical)";
      }
      if (camelData.avg !== null && avg30d === null) {
        avg30d = camelData.avg;
        dataPoints = Math.max(dataPoints, 10); // Camel has lots of data
      }
    }
  }

  // 3. Determine indicator
  const { indicator, emoji, recommendation, recommendationPt } = evaluatePrice(
    currentPrice, avg30d, lowestEver
  );

  return {
    indicator,
    emoji,
    currentPrice,
    avg30d,
    lowestEver,
    lowestStore,
    recommendation,
    recommendationPt,
    dataPoints,
  };
}

// ─── Price Evaluation ───

function evaluatePrice(
  current: number,
  avg: number | null,
  lowest: number | null
): { indicator: "great" | "normal" | "high"; emoji: string; recommendation: string; recommendationPt: string } {
  if (avg === null) {
    // No history — check against lowest
    if (lowest !== null && current <= lowest * 1.05) {
      return { indicator: "great", emoji: "🟢", recommendation: "Near lowest price ever!", recommendationPt: "Perto do menor preço histórico!" };
    }
    return { indicator: "normal", emoji: "🟡", recommendation: "Not enough price history — first time tracking.", recommendationPt: "Sem histórico suficiente — primeira vez rastreando." };
  }

  const ratio = current / avg;

  if (ratio <= 0.95) {
    // 5%+ below average
    if (lowest !== null && current <= lowest * 1.02) {
      return { indicator: "great", emoji: "🟢", recommendation: "Excellent price — near all-time low! Buy now.", recommendationPt: "Preço excelente — perto da mínima histórica! Compra agora." };
    }
    return { indicator: "great", emoji: "🟢", recommendation: "Good deal — below 30-day average.", recommendationPt: "Bom negócio — abaixo da média dos últimos 30 dias." };
  }

  if (ratio <= 1.05) {
    return { indicator: "normal", emoji: "🟡", recommendation: "Normal price — typical for this product.", recommendationPt: "Preço normal — típico pra esse produto." };
  }

  // Above average
  const pctAbove = Math.round((ratio - 1) * 100);
  return {
    indicator: "high",
    emoji: "🔴",
    recommendation: `Price is ${pctAbove}% above average — consider waiting for a sale.`,
    recommendationPt: `Preço ${pctAbove}% acima da média — sugiro esperar uma promoção.`,
  };
}

// ─── CamelCamelCamel via SerpAPI ───

async function fetchCamelData(asin: string): Promise<{ lowest: number | null; avg: number | null } | null> {
  const cacheKey = `camel:${asin}`;
  const cached = await redisGet(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    // Search for CamelCamelCamel price info via Google
    const query = `camelcamelcamel ${asin} price history`;
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=3`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as any;

    // Try to extract price info from snippets
    let lowest: number | null = null;
    let avg: number | null = null;

    for (const r of (data.organic_results ?? [])) {
      const snippet = r.snippet || "";

      // Look for "Lowest: $XXX" or "lowest price: $XXX"
      const lowestMatch = snippet.match(/lowest[^$]*\$(\d+(?:\.\d{2})?)/i);
      if (lowestMatch && !lowest) lowest = parseFloat(lowestMatch[1]);

      // Look for "Average: $XXX"
      const avgMatch = snippet.match(/average[^$]*\$(\d+(?:\.\d{2})?)/i);
      if (avgMatch && !avg) avg = parseFloat(avgMatch[1]);
    }

    const result = { lowest, avg };
    await redisSet(cacheKey, JSON.stringify(result), 86400); // 24h cache
    return result;
  } catch {
    return null;
  }
}

function normalizeId(id: string): string {
  return id.toLowerCase().trim().replace(/\s+/g, "_").substring(0, 200);
}
