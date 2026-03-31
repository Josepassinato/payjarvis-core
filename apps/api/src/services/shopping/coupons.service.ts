/**
 * Coupons Service — Find coupon codes before checkout.
 *
 * Sources:
 *   1. Local cache (coupon_cache table) — 24h TTL
 *   2. SerpAPI Google Search: "[store] coupon code [month] [year]"
 *   3. Future: RetailMeNot, CupomValido (BR) via Apify
 *
 * Flow: user wants to buy → Jarvis checks coupons → suggests best code.
 * If no coupons found → stay silent (don't say "no coupons found").
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";

const SERPAPI_KEY = process.env.SERPAPI_KEY || "";
const CACHE_TTL = 86400; // 24h Redis cache per store

export interface Coupon {
  code: string;
  description: string;
  discountType: "percentage" | "fixed" | "free_shipping";
  discountValue: number | null;
  minPurchase: number | null;
  verified: boolean;
  expiresAt: string | null;
  source: string;
}

/**
 * Find coupons for a store. Checks cache first, then SerpAPI.
 */
export async function findCoupons(store: string): Promise<Coupon[]> {
  const normalizedStore = store.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  if (!normalizedStore) return [];

  // 1. Check Redis cache
  const cacheKey = `coupons:${normalizedStore}`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    console.log(`[COUPONS] Cache hit for ${normalizedStore}`);
    return JSON.parse(cached);
  }

  // 2. Check DB cache (still valid within 24h)
  const dbCoupons = await prisma.couponCache.findMany({
    where: {
      store: normalizedStore,
      createdAt: { gte: new Date(Date.now() - CACHE_TTL * 1000) },
    },
    orderBy: { verified: "desc" },
    take: 10,
  });

  if (dbCoupons.length > 0) {
    const result = dbCoupons.map(mapDbCoupon);
    await redisSet(cacheKey, JSON.stringify(result), CACHE_TTL);
    console.log(`[COUPONS] DB cache hit for ${normalizedStore}: ${result.length} coupons`);
    return result;
  }

  // 3. Search via SerpAPI
  const coupons = await searchCouponsSerpApi(normalizedStore);

  // 4. Store in DB + Redis
  if (coupons.length > 0) {
    await Promise.allSettled(
      coupons.map((c) =>
        prisma.couponCache.create({
          data: {
            store: normalizedStore,
            code: c.code,
            description: c.description,
            discountType: c.discountType,
            discountValue: c.discountValue,
            minPurchase: c.minPurchase,
            verified: c.verified,
            expiresAt: c.expiresAt ? new Date(c.expiresAt) : null,
            source: c.source,
          },
        })
      )
    );
    await redisSet(cacheKey, JSON.stringify(coupons), CACHE_TTL);
    console.log(`[COUPONS] Found ${coupons.length} coupons for ${normalizedStore} via SerpAPI`);
  } else {
    // Cache empty result to avoid re-searching
    await redisSet(cacheKey, "[]", 3600); // 1h for empty
    console.log(`[COUPONS] No coupons found for ${normalizedStore}`);
  }

  return coupons;
}

/**
 * Estimate savings for a purchase amount with best coupon.
 */
export function estimateSavings(coupons: Coupon[], purchaseAmount: number): { bestCoupon: Coupon; savings: number } | null {
  if (coupons.length === 0) return null;

  let best: { coupon: Coupon; savings: number } | null = null;

  for (const c of coupons) {
    if (c.minPurchase && purchaseAmount < c.minPurchase) continue;

    let savings = 0;
    if (c.discountType === "percentage" && c.discountValue) {
      savings = purchaseAmount * (c.discountValue / 100);
    } else if (c.discountType === "fixed" && c.discountValue) {
      savings = c.discountValue;
    } else if (c.discountType === "free_shipping") {
      savings = 5; // estimated shipping cost
    }

    if (!best || savings > best.savings) {
      best = { coupon: c, savings };
    }
  }

  return best ? { bestCoupon: best.coupon, savings: Math.round(best.savings * 100) / 100 } : null;
}

// ─── SerpAPI Search ───

async function searchCouponsSerpApi(store: string): Promise<Coupon[]> {
  if (!SERPAPI_KEY) return [];

  const now = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();

  const query = `${store} coupon code ${month} ${year}`;

  try {
    const res = await fetch(
      `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&api_key=${SERPAPI_KEY}&num=10`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
    const data = await res.json() as any;

    const coupons: Coupon[] = [];
    const results = data.organic_results ?? [];

    for (const r of results) {
      const snippet = (r.snippet || "") + " " + (r.title || "");
      const extracted = extractCouponsFromText(snippet, store);
      coupons.push(...extracted);
    }

    // Dedupe by code
    const seen = new Set<string>();
    return coupons.filter((c) => {
      const key = c.code.toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  } catch (err) {
    console.error(`[COUPONS] SerpAPI search failed for ${store}:`, (err as Error).message);
    return [];
  }
}

/**
 * Extract coupon codes from text using regex patterns.
 */
function extractCouponsFromText(text: string, store: string): Coupon[] {
  const coupons: Coupon[] = [];

  // Pattern: CODE (all-caps or alphanumeric, 4-20 chars) near discount words
  // Common patterns: "Use code SAVE15", "coupon: FREESHIP", "code HOLIDAY20 for 20% off"
  const codePattern = /(?:code|coupon|promo|voucher|use)\s*:?\s*([A-Z0-9]{4,20})/gi;
  let match;

  while ((match = codePattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    // Skip generic/garbage codes
    if (["CODE", "COUPON", "PROMO", "SAVE", "FREE", "DEAL", "BEST", "THIS", "THAT", "MORE", "NONE"].includes(code)) continue;

    // Try to extract discount info near the code
    const surrounding = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
    const percentMatch = surrounding.match(/(\d{1,2})%\s*(?:off|desconto|discount)/i);
    const fixedMatch = surrounding.match(/\$(\d+(?:\.\d{2})?)\s*(?:off|desconto|discount)/i);
    const shippingMatch = surrounding.match(/free\s*shipping/i);

    let discountType: Coupon["discountType"] = "percentage";
    let discountValue: number | null = null;
    let description = `Coupon code for ${store}`;

    if (percentMatch) {
      discountValue = parseInt(percentMatch[1], 10);
      description = `${discountValue}% off`;
    } else if (fixedMatch) {
      discountType = "fixed";
      discountValue = parseFloat(fixedMatch[1]);
      description = `$${discountValue} off`;
    } else if (shippingMatch) {
      discountType = "free_shipping";
      description = "Free shipping";
    }

    coupons.push({
      code,
      description,
      discountType,
      discountValue,
      minPurchase: null,
      verified: false,
      expiresAt: null,
      source: "serpapi_google",
    });
  }

  return coupons;
}

function mapDbCoupon(row: any): Coupon {
  return {
    code: row.code,
    description: row.description,
    discountType: row.discountType as Coupon["discountType"],
    discountValue: row.discountValue ? Number(row.discountValue) : null,
    minPurchase: row.minPurchase ? Number(row.minPurchase) : null,
    verified: row.verified,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    source: row.source,
  };
}
