/**
 * Coupons Service — Find coupon codes before checkout.
 *
 * Sources:
 *   1. Local cache (coupon_cache table) — 24h TTL
 *   2. Gemini Grounding (Google Search): "[store] coupon code [month] [year]"
 *   3. Future: RetailMeNot, CupomValido (BR) via Playwright
 *
 * Flow: user wants to buy → Jarvis checks coupons → suggests best code.
 * If no coupons found → stay silent (don't say "no coupons found").
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
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
  confidence: "VERIFIED" | "LIKELY" | "UNVERIFIED";
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

  // 3. Search via Gemini Grounding (Google Search)
  const coupons = await searchCouponsViaGemini(normalizedStore);

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
    console.log(`[COUPONS] Found ${coupons.length} coupons for ${normalizedStore} via Gemini`);
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

// ─── Gemini Grounding Search ───

async function searchCouponsViaGemini(store: string): Promise<Coupon[]> {
  if (!GEMINI_API_KEY) return [];

  const now = new Date();
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const month = monthNames[now.getMonth()];
  const year = now.getFullYear();

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = `Search for current ${store} coupon codes and promo codes for ${month} ${year}. Return ONLY a JSON array (no markdown) of coupon codes found: [{"code":"CODE123","description":"20% off","discountType":"percentage","discountValue":20}]. discountType must be "percentage", "fixed", or "free_shipping". Max 10 results. Only include codes that appear real and current.`;

    const result = await model.generateContent(prompt);
    let text: string;
    try { text = result.response.text(); } catch { text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || ""; }
    if (!text) return [];

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as any[];
    if (!Array.isArray(parsed)) return [];

    const coupons: Coupon[] = [];
    const seen = new Set<string>();

    for (const p of parsed.slice(0, 10)) {
      const code = (p.code || "").toUpperCase().trim();
      if (!code || code.length < 4 || seen.has(code)) continue;
      if (!isLikelyCouponCode(code)) continue;
      seen.add(code);

      coupons.push({
        code,
        description: p.description || `Coupon for ${store}`,
        discountType: ["percentage", "fixed", "free_shipping"].includes(p.discountType) ? p.discountType : "percentage",
        discountValue: typeof p.discountValue === "number" ? p.discountValue : null,
        minPurchase: typeof p.minPurchase === "number" ? p.minPurchase : null,
        verified: false,
        expiresAt: null,
        source: "gemini_google",
        confidence: p.discountValue ? "LIKELY" : "UNVERIFIED",
      });
    }

    return coupons;
  } catch (err) {
    console.error(`[COUPONS] Gemini search failed for ${store}:`, (err as Error).message);
    return [];
  }
}

// Garbage words that look like coupon codes but aren't
const SKIP_CODES = new Set([
  "CODE", "CODES", "COUPON", "COUPONS", "PROMO", "PROMOS", "VOUCHER",
  "SAVE", "FREE", "DEAL", "DEALS", "BEST", "THIS", "THAT", "MORE",
  "NONE", "SALE", "SHOP", "BLOG", "BLOGS", "THESE", "THOSE", "CLICK",
  "HERE", "COPY", "SHOW", "VIEW", "FIND", "LIST", "HOME", "PAGE",
  "SITE", "LINK", "LINKS", "NEWS", "ITEM", "ITEMS", "CART", "OFFER",
  "OFFERS", "APPLY", "VERIFIED", "EXPIRED", "TODAY", "YEAR", "MONTH",
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST",
  "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER", "RETAIL", "ONLINE",
  "STORE", "STORES", "CHECKOUT", "ORDER", "ORDERS", "DISCOUNT",
  "PERCENT", "SHIPPING", "DELIVERY", "TOTAL", "PRICE", "GIFT",
  "CARD", "CARDS", "SIGN", "JOIN", "EMAIL", "SUBMIT", "ENTER",
  "VALID", "ACTIVE", "SEARCH", "BROWSE", "TRIED", "WORKS", "WORKING",
]);

// Validates that a string looks like a real coupon code (not a dictionary word or garbage)
function isLikelyCouponCode(code: string): boolean {
  // Must be alphanumeric with optional hyphens/underscores, 4-20 chars
  if (!/^[A-Z0-9][A-Z0-9_-]{2,18}[A-Z0-9]$/i.test(code) && !/^[A-Z0-9]{4,20}$/i.test(code)) return false;

  // Skip known garbage
  if (SKIP_CODES.has(code.toUpperCase())) return false;

  // Must contain at least one digit OR be mixed-case alphanumeric (pure dictionary words are unlikely codes)
  const hasDigit = /\d/.test(code);
  const hasMixedAlphaNum = /[A-Z]/.test(code) && code.length >= 5;

  // Codes with digits are more likely real: SAVE20, FREE15, HOLIDAY2026
  if (hasDigit) return true;

  // Pure alpha codes are valid only if they look intentional (5+ chars, not a common word)
  // Common pattern: FREESHIP, WELCOME, BLACKFRIDAY
  if (hasMixedAlphaNum && code.length >= 6) return true;

  return false;
}

/**
 * Extract coupon codes from text using regex patterns.
 * Returns coupons with confidence scoring.
 */
function extractCouponsFromText(text: string, store: string): Coupon[] {
  const coupons: Coupon[] = [];

  // Multiple extraction patterns for better coverage
  const patterns = [
    /(?:code|coupon|promo|voucher|use|apply|enter)\s*:?\s*"?([A-Z0-9][A-Z0-9_-]{2,18}[A-Z0-9])"?/gi,
    /(?:code|coupon|promo|voucher|use|apply|enter)\s*:?\s*([A-Z0-9]{4,20})/gi,
    /\b([A-Z0-9]{4,20})\s+(?:for|gives?|gets?|saves?)\s+\d+%/gi,
  ];

  const seen = new Set<string>();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1].toUpperCase();

      if (seen.has(code)) continue;
      seen.add(code);

      if (!isLikelyCouponCode(code)) continue;

      // Try to extract discount info near the code
      const surrounding = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
      const percentMatch = surrounding.match(/(\d{1,2})%\s*(?:off|desconto|discount|de descuento)/i);
      const fixedMatch = surrounding.match(/\$(\d+(?:\.\d{2})?)\s*(?:off|desconto|discount)/i);
      const shippingMatch = surrounding.match(/free\s*shipping|frete\s*gr[aá]tis/i);

      let discountType: Coupon["discountType"] = "percentage";
      let discountValue: number | null = null;
      let description = `Coupon code for ${store}`;
      let confidence: Coupon["confidence"] = "UNVERIFIED";

      if (percentMatch) {
        discountValue = parseInt(percentMatch[1], 10);
        description = `${discountValue}% off`;
        confidence = "LIKELY"; // has concrete discount info
      } else if (fixedMatch) {
        discountType = "fixed";
        discountValue = parseFloat(fixedMatch[1]);
        description = `$${discountValue} off`;
        confidence = "LIKELY";
      } else if (shippingMatch) {
        discountType = "free_shipping";
        description = "Free shipping";
        confidence = "LIKELY";
      }

      // Boost confidence if code has digit+alpha mix (more likely intentional)
      if (confidence === "UNVERIFIED" && /\d/.test(code) && /[A-Z]/i.test(code)) {
        confidence = "LIKELY";
      }

      coupons.push({
        code,
        description,
        discountType,
        discountValue,
        minPurchase: null,
        verified: false,
        expiresAt: null,
        source: "gemini_google",
        confidence,
      });
    }
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
    confidence: row.verified ? "VERIFIED" : "LIKELY",
  };
}
