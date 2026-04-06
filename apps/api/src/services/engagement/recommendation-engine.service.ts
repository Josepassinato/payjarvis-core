/**
 * Proactive Recommendation Engine — Sniffer 🐕 fareja ofertas pro usuário.
 *
 * Triggers:
 *   1. PRICE_DROP  — product user searched dropped > 15%
 *   2. SIMILAR     — product similar to user's profile
 *   3. RESTOCK     — consumable product due for reorder
 *   4. DEAL_ALERT  — big discount in user's favorite categories
 *
 * Rules:
 *   - confidence > 0.7 to send
 *   - max 1 recommendation/day/user (urgent price drops > 30% bypass)
 *   - never recommend rejected products
 *   - respect quiet hours
 *   - 3 consecutive ignores → reduce frequency to 1/week
 */

import { prisma, Prisma } from "@payjarvis/database";
import { redisGet, redisSet } from "../redis.js";
import { unifiedProductSearch } from "../search/unified-search.service.js";

// ─── Types ───

export interface RecommendationCandidate {
  triggerType: "price_drop" | "similar" | "restock" | "deal_alert";
  productName: string;
  productUrl?: string;
  imageUrl?: string;
  store?: string;
  originalPrice?: number;
  currentPrice?: number;
  currency: string;
  savingsPercent?: number;
  confidenceScore: number;
  sourceQuery?: string;
  metadata?: Record<string, unknown>;
}

interface UserProfile {
  userId: string;
  lang: "pt" | "en" | "es";
  searchedProducts: { query: string; store?: string; createdAt: Date }[];
  categories: string[];
  avgPriceRange: { min: number; max: number };
  favoriteBrands: string[];
  favoriteStores: string[];
  rejectedProducts: string[];
  recentIgnores: number; // consecutive ignores
}

// ─── Constants ───

const MIN_CONFIDENCE = 0.7;
const MAX_DAILY_RECOMMENDATIONS = 1;
const URGENT_PRICE_DROP_THRESHOLD = 0.30; // 30% bypass daily limit
const NORMAL_PRICE_DROP_THRESHOLD = 0.15; // 15% minimum
const DEAL_ALERT_MIN_DISCOUNT = 0.25; // 25% for deal alerts
const IGNORE_THROTTLE_COUNT = 3; // after 3 ignores, reduce to weekly
const SEARCH_LOOKBACK_DAYS = 30;
const ACTIVE_USER_DAYS = 14;

// ─── User Profile Builder ───

export async function buildUserProfile(userId: string, telegramChatId?: string | null, phone?: string | null): Promise<UserProfile> {
  const possibleIds = [userId];
  if (telegramChatId) possibleIds.push(telegramChatId);
  if (phone) {
    const cleaned = phone.replace(/[^+\d]/g, "");
    possibleIds.push(`whatsapp:${cleaned}`);
    if (!cleaned.startsWith("+")) possibleIds.push(`whatsapp:+${cleaned}`);
  }

  // 1. Get searched products from commerce_search_logs (last 30 days)
  //    Logs use botId="openclaw" and params may have userId.
  //    Also search by possibleIds in botId for direct API searches.
  const lookbackDate = new Date(Date.now() - SEARCH_LOOKBACK_DAYS * 86_400_000);
  const botIds = [...possibleIds, "openclaw"];
  const searchLogs = await prisma.commerceSearchLog.findMany({
    where: {
      botId: { in: botIds },
      service: "products",
      createdAt: { gte: lookbackDate },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Filter: keep logs that match user (via params.userId) or all openclaw logs if few users
  const searchedProducts = searchLogs
    .map(log => {
      const params = log.params as Record<string, unknown>;
      return {
        query: (params.query as string) || "",
        store: (params.store as string) || undefined,
        createdAt: log.createdAt,
        logUserId: (params.userId as string) || null,
      };
    })
    .filter(p => {
      if (!p.query) return false;
      // If log has userId, match it; otherwise include (shared bot)
      if (p.logUserId) return possibleIds.includes(p.logUserId);
      return true;
    })
    .slice(0, 50);

  // 2. Get user facts for interests/categories/brands
  const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
    SELECT fact_key, fact_value FROM openclaw_user_facts
    WHERE user_id IN (${Prisma.join(possibleIds)})
  `;
  const factsMap: Record<string, string> = {};
  for (const f of facts) factsMap[f.fact_key] = f.fact_value;

  // Extract categories and brands from facts + search queries
  const categories: string[] = [];
  const brands: string[] = [];
  if (factsMap.interests) categories.push(...factsMap.interests.split(",").map(s => s.trim()));
  if (factsMap.favorite_categories) categories.push(...factsMap.favorite_categories.split(",").map(s => s.trim()));
  if (factsMap.favorite_brands) brands.push(...factsMap.favorite_brands.split(",").map(s => s.trim()));

  // Extract brands from search queries (common pattern: "Brand Product")
  for (const sp of searchedProducts) {
    const words = sp.query.split(" ");
    if (words.length >= 2) {
      const potentialBrand = words[0];
      if (potentialBrand.length > 2 && /^[A-Z]/.test(potentialBrand)) {
        brands.push(potentialBrand);
      }
    }
  }

  // Favorite stores from search logs
  const storeCounts: Record<string, number> = {};
  for (const sp of searchedProducts) {
    if (sp.store) storeCounts[sp.store] = (storeCounts[sp.store] || 0) + 1;
  }
  const favoriteStores = Object.entries(storeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([store]) => store);

  // Average price range from price alerts
  const priceAlerts = await prisma.priceAlert.findMany({
    where: { userId: { in: possibleIds }, active: true },
    select: { targetPrice: true, currentPrice: true },
  });
  let avgMin = 0, avgMax = 200;
  if (priceAlerts.length > 0) {
    const prices = priceAlerts.map(a => a.targetPrice).filter(p => p > 0);
    if (prices.length > 0) {
      avgMin = Math.min(...prices) * 0.5;
      avgMax = Math.max(...prices) * 1.5;
    }
  }

  // Rejected products
  const rejected = await prisma.recommendation.findMany({
    where: { userId, status: "rejected" },
    select: { productName: true },
    take: 100,
  });
  const rejectedProducts = rejected.map(r => r.productName.toLowerCase());

  // Count consecutive ignores
  const recentRecs = await prisma.recommendation.findMany({
    where: { userId, status: { in: ["sent", "ignored"] } },
    orderBy: { sentAt: "desc" },
    take: 5,
    select: { status: true },
  });
  let recentIgnores = 0;
  for (const r of recentRecs) {
    if (r.status === "ignored") recentIgnores++;
    else break;
  }

  // Language detection
  const lang = factsMap.language === "pt" || factsMap.country === "BR" ? "pt"
    : factsMap.language === "es" ? "es" : "en";

  return {
    userId,
    lang: lang as "pt" | "en" | "es",
    searchedProducts,
    categories: [...new Set(categories)],
    avgPriceRange: { min: avgMin, max: avgMax },
    favoriteBrands: [...new Set(brands)].slice(0, 10),
    favoriteStores,
    rejectedProducts,
    recentIgnores,
  };
}

// ─── Trigger 1: Price Drop Detection ───

async function findPriceDrops(profile: UserProfile): Promise<RecommendationCandidate[]> {
  const candidates: RecommendationCandidate[] = [];
  if (profile.searchedProducts.length === 0) return candidates;

  // Deduplicate queries — keep only unique searches
  const seen = new Set<string>();
  const uniqueSearches = profile.searchedProducts.filter(sp => {
    const key = sp.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10); // max 10 lookups per user per cycle

  // Check price alerts first (already tracked)
  const possibleIds = [profile.userId];
  const alerts = await prisma.priceAlert.findMany({
    where: {
      userId: { in: possibleIds },
      active: true,
      currentPrice: { not: null },
    },
  });

  for (const alert of alerts) {
    if (!alert.currentPrice || alert.currentPrice >= alert.targetPrice) continue;
    const drop = (alert.targetPrice - alert.currentPrice) / alert.targetPrice;
    if (drop < NORMAL_PRICE_DROP_THRESHOLD) continue;

    // Skip if rejected
    if (profile.rejectedProducts.includes(alert.query.toLowerCase())) continue;

    candidates.push({
      triggerType: "price_drop",
      productName: alert.query,
      store: alert.store || undefined,
      originalPrice: alert.targetPrice,
      currentPrice: alert.currentPrice,
      currency: alert.currency,
      savingsPercent: Math.round(drop * 100),
      confidenceScore: Math.min(0.6 + drop, 1.0), // higher drop = higher confidence
      sourceQuery: alert.query,
    });
  }

  // Also check recent searches against current prices (for users without explicit alerts)
  // Only if we don't already have candidates from alerts
  if (candidates.length === 0) {
    for (const search of uniqueSearches.slice(0, 3)) {
      try {
        const cacheKey = `rec:price:${search.query.toLowerCase()}`;
        const cached = await redisGet(cacheKey);
        if (cached) continue; // already checked recently

        const result = await unifiedProductSearch({
          query: search.query,
          store: search.store,
          maxResults: 1,
        });

        // Mark as checked (cache 6h)
        await redisSet(cacheKey, "1", 21600);

        const product = result.products[0];
        if (!product?.price) continue;

        // Check price history
        const history = await prisma.priceHistory.findMany({
          where: {
            productIdentifier: { contains: search.query.substring(0, 30) },
          },
          orderBy: { recordedAt: "desc" },
          take: 5,
        });

        if (history.length < 2) continue;
        const oldPrice = history[history.length - 1].price;
        const drop = (oldPrice - product.price) / oldPrice;
        if (drop < NORMAL_PRICE_DROP_THRESHOLD) continue;

        if (profile.rejectedProducts.includes(search.query.toLowerCase())) continue;

        candidates.push({
          triggerType: "price_drop",
          productName: product.title,
          productUrl: product.url,
          imageUrl: product.imageUrl || undefined,
          store: product.store,
          originalPrice: oldPrice,
          currentPrice: product.price,
          currency: product.currency || "USD",
          savingsPercent: Math.round(drop * 100),
          confidenceScore: Math.min(0.65 + drop, 1.0),
          sourceQuery: search.query,
        });
      } catch {
        // Non-critical — continue
      }
    }
  }

  return candidates;
}

// ─── Trigger 2: Similar Products ───

async function findSimilarProducts(profile: UserProfile): Promise<RecommendationCandidate[]> {
  if (profile.searchedProducts.length === 0 && profile.categories.length === 0) return [];
  const candidates: RecommendationCandidate[] = [];

  // Build a search from the user's most recent search + favorite brand
  const recentQuery = profile.searchedProducts[0]?.query;
  if (!recentQuery) return [];

  const cacheKey = `rec:similar:${profile.userId}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await redisGet(cacheKey);
  if (cached) return []; // already checked today

  try {
    // Search for related products
    const variations = [];
    if (profile.favoriteBrands.length > 0) {
      const brand = profile.favoriteBrands[Math.floor(Math.random() * profile.favoriteBrands.length)];
      // Extract product type from recent query (remove brand if present)
      const productType = recentQuery.replace(new RegExp(brand, "i"), "").trim();
      if (productType.length > 3) {
        variations.push(`${brand} ${productType}`);
      }
    }
    // Add category-based search
    if (profile.categories.length > 0) {
      const cat = profile.categories[Math.floor(Math.random() * profile.categories.length)];
      variations.push(`best ${cat} deals`);
    }

    for (const query of variations.slice(0, 1)) {
      const result = await unifiedProductSearch({ query, maxResults: 3 });
      for (const product of result.products) {
        if (!product.price) continue;
        if (product.price < profile.avgPriceRange.min || product.price > profile.avgPriceRange.max) continue;
        if (profile.rejectedProducts.includes(product.title.toLowerCase())) continue;

        candidates.push({
          triggerType: "similar",
          productName: product.title,
          productUrl: product.url,
          imageUrl: product.imageUrl || undefined,
          store: product.store,
          currentPrice: product.price,
          currency: product.currency || "USD",
          confidenceScore: 0.75,
          sourceQuery: recentQuery,
          metadata: { relatedTo: recentQuery, brand: product.store },
        });
      }
    }

    await redisSet(cacheKey, "1", 86400); // cache 24h
  } catch {
    // Non-critical
  }

  return candidates.slice(0, 2);
}

// ─── Trigger 3: Restock Reminders ───

async function findRestockCandidates(profile: UserProfile): Promise<RecommendationCandidate[]> {
  const candidates: RecommendationCandidate[] = [];

  try {
    const threshold = new Date(Date.now() + 3 * 86_400_000); // due within 3 days
    const rows = await prisma.$queryRaw<{
      product_name: string;
      store: string;
      price: number;
      currency: string;
      product_url: string | null;
      reorder_cycle_days: number;
      next_reorder_date: Date;
      purchased_at: Date;
    }[]>`
      SELECT DISTINCT ON (LOWER(product_name), LOWER(store))
        product_name, store, price, currency, product_url,
        reorder_cycle_days, next_reorder_date, purchased_at
      FROM purchase_history
      WHERE user_id = ${profile.userId}
        AND is_recurring = true
        AND next_reorder_date <= ${threshold}
        AND next_reorder_date > NOW() - INTERVAL '7 days'
      ORDER BY LOWER(product_name), LOWER(store), purchased_at DESC
    `;

    for (const row of rows) {
      if (profile.rejectedProducts.includes(row.product_name.toLowerCase())) continue;

      const daysSincePurchase = Math.floor((Date.now() - new Date(row.purchased_at).getTime()) / 86_400_000);
      candidates.push({
        triggerType: "restock",
        productName: row.product_name,
        productUrl: row.product_url || undefined,
        store: row.store,
        currentPrice: row.price ? Number(row.price) : undefined,
        currency: row.currency || "USD",
        confidenceScore: 0.85, // high confidence — based on actual purchase patterns
        metadata: { cycleDays: row.reorder_cycle_days, daysSincePurchase },
      });
    }
  } catch (err) {
    console.error("[RECOMMENDATION] Restock query error:", (err as Error).message);
  }

  return candidates;
}

// ─── Trigger 4: Deal Alerts (category-based) ───

async function findDealAlerts(profile: UserProfile): Promise<RecommendationCandidate[]> {
  if (profile.categories.length === 0 && profile.searchedProducts.length === 0) return [];
  const candidates: RecommendationCandidate[] = [];

  const cacheKey = `rec:deals:${profile.userId}:${new Date().toISOString().slice(0, 10)}`;
  const cached = await redisGet(cacheKey);
  if (cached) return [];

  try {
    // Pick a category the user cares about
    const searchTerms = profile.searchedProducts.slice(0, 3).map(s => s.query);
    const categoryTerm = profile.categories[0] || searchTerms[0];
    if (!categoryTerm) return [];

    const query = `${categoryTerm} deals sale discount`;
    const result = await unifiedProductSearch({ query, maxResults: 5 });

    for (const product of result.products) {
      if (!product.price) continue;
      if (profile.rejectedProducts.includes(product.title.toLowerCase())) continue;

      // We need some indicator of discount — check if price seems discounted
      // (compare against user's avg range or product's own signals)
      const seemsDiscounted = product.price < profile.avgPriceRange.max * 0.75;
      if (!seemsDiscounted) continue;

      candidates.push({
        triggerType: "deal_alert",
        productName: product.title,
        productUrl: product.url,
        imageUrl: product.imageUrl || undefined,
        store: product.store,
        currentPrice: product.price,
        currency: product.currency || "USD",
        confidenceScore: 0.72,
        sourceQuery: categoryTerm,
        metadata: { category: categoryTerm },
      });
    }

    await redisSet(cacheKey, "1", 86400);
  } catch {
    // Non-critical
  }

  return candidates.slice(0, 2);
}

// ─── Message Builder ───

export function buildRecommendationMessage(candidate: RecommendationCandidate, lang: "pt" | "en" | "es"): string {
  const curr = candidate.currency === "BRL" ? "R$" : "$";

  switch (candidate.triggerType) {
    case "price_drop": {
      const savings = candidate.savingsPercent || 0;
      const priceStr = candidate.currentPrice ? `${curr}${candidate.currentPrice.toFixed(2)}` : "";
      const oldStr = candidate.originalPrice ? `${curr}${candidate.originalPrice.toFixed(2)}` : "";
      if (lang === "pt") {
        return `🔥 ${candidate.productName}${candidate.sourceQuery ? ` que você buscou` : ""} baixou de ${oldStr} pra ${priceStr}! Economia de ${savings}%.${candidate.store ? ` Na ${candidate.store}.` : ""}\nQuer que eu garanta pra você?`;
      }
      return `🔥 ${candidate.productName}${candidate.sourceQuery ? ` you searched for` : ""} dropped from ${oldStr} to ${priceStr}! Save ${savings}%.${candidate.store ? ` At ${candidate.store}.` : ""}\nWant me to grab it for you?`;
    }

    case "similar": {
      const priceStr = candidate.currentPrice ? ` por ${curr}${candidate.currentPrice.toFixed(2)}` : "";
      const storeStr = candidate.store ? ` na ${candidate.store}` : "";
      if (lang === "pt") {
        return `🐕 Farejei algo! ${candidate.productName}${priceStr}${storeStr} — combina com o que você curtiu. Quer ver?`;
      }
      return `🐕 Sniffed out something! ${candidate.productName}${priceStr}${storeStr} — matches your taste. Want to see?`;
    }

    case "restock": {
      const days = (candidate.metadata as Record<string, unknown>)?.daysSincePurchase as number;
      if (lang === "pt") {
        return `🔄 Já faz ${days} dias que você comprou ${candidate.productName}. Tá na hora de repor? Posso farejar o melhor preço!`;
      }
      return `🔄 It's been ${days} days since you bought ${candidate.productName}. Time to restock? I can sniff out the best price!`;
    }

    case "deal_alert": {
      const priceStr = candidate.currentPrice ? `${curr}${candidate.currentPrice.toFixed(2)}` : "";
      const cat = (candidate.metadata as Record<string, unknown>)?.category as string || "";
      if (lang === "pt") {
        return `💰 Oferta! ${candidate.productName} por ${priceStr}${candidate.store ? ` na ${candidate.store}` : ""}. Quer que eu filtre os melhores pra você?`;
      }
      return `💰 Deal alert! ${candidate.productName} at ${priceStr}${candidate.store ? ` at ${candidate.store}` : ""}. Want me to filter the best ones for you?`;
    }
  }
}

// ─── Quiet Hours Check ───

function isQuietHours(timezone: string, quietStart: number, quietEnd: number): boolean {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
    const hour = parseInt(formatter.format(now), 10);

    if (quietStart > quietEnd) {
      // Wraps midnight (e.g., 22-8)
      return hour >= quietStart || hour < quietEnd;
    }
    return hour >= quietStart && hour < quietEnd;
  } catch {
    // If timezone invalid, assume safe to send during 8-22 UTC
    const hour = new Date().getUTCHours();
    return hour < 8 || hour >= 22;
  }
}

// ─── Can Send Check ───

async function canSendRecommendation(userId: string, isUrgent: boolean): Promise<boolean> {
  const oneDayAgo = new Date(Date.now() - 86_400_000);
  const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000);

  // Check daily limit
  const sentToday = await prisma.recommendation.count({
    where: {
      userId,
      status: { in: ["sent", "clicked", "converted"] },
      sentAt: { gte: oneDayAgo },
    },
  });

  if (sentToday >= MAX_DAILY_RECOMMENDATIONS && !isUrgent) return false;

  // Check if throttled (3 consecutive ignores → weekly max)
  const recentRecs = await prisma.recommendation.findMany({
    where: { userId, sentAt: { not: null } },
    orderBy: { sentAt: "desc" },
    take: IGNORE_THROTTLE_COUNT,
    select: { status: true },
  });

  const allIgnored = recentRecs.length >= IGNORE_THROTTLE_COUNT &&
    recentRecs.every(r => r.status === "ignored");

  if (allIgnored) {
    // Throttled — only 1 per week
    const sentThisWeek = await prisma.recommendation.count({
      where: {
        userId,
        status: { in: ["sent", "clicked", "converted"] },
        sentAt: { gte: oneWeekAgo },
      },
    });
    if (sentThisWeek >= 1) return false;
  }

  return true;
}

// ─── Score & Select Best ───

function selectBestCandidate(candidates: RecommendationCandidate[]): RecommendationCandidate | null {
  // Filter by minimum confidence
  const eligible = candidates.filter(c => c.confidenceScore >= MIN_CONFIDENCE);
  if (eligible.length === 0) return null;

  // Priority: price_drop > restock > similar > deal_alert
  const priorityOrder = { price_drop: 4, restock: 3, similar: 2, deal_alert: 1 };
  eligible.sort((a, b) => {
    const pDiff = (priorityOrder[b.triggerType] || 0) - (priorityOrder[a.triggerType] || 0);
    if (pDiff !== 0) return pDiff;
    return b.confidenceScore - a.confidenceScore;
  });

  return eligible[0];
}

// ─── Main: Generate Recommendations for User ───

export async function generateRecommendationsForUser(
  userId: string,
  telegramChatId?: string | null,
  phone?: string | null,
): Promise<RecommendationCandidate | null> {
  try {
    const profile = await buildUserProfile(userId, telegramChatId, phone);

    // Skip users with no search history and no categories
    if (profile.searchedProducts.length === 0 && profile.categories.length === 0) {
      return null;
    }

    // Run all triggers in parallel
    const [priceDrops, similar, restock, deals] = await Promise.all([
      findPriceDrops(profile).catch(() => [] as RecommendationCandidate[]),
      findSimilarProducts(profile).catch(() => [] as RecommendationCandidate[]),
      findRestockCandidates(profile).catch(() => [] as RecommendationCandidate[]),
      findDealAlerts(profile).catch(() => [] as RecommendationCandidate[]),
    ]);

    const allCandidates = [...priceDrops, ...similar, ...restock, ...deals];
    if (allCandidates.length === 0) return null;

    const best = selectBestCandidate(allCandidates);
    if (!best) return null;

    // Check if this is an urgent price drop (> 30%)
    const isUrgent = best.triggerType === "price_drop" &&
      (best.savingsPercent || 0) >= URGENT_PRICE_DROP_THRESHOLD * 100;

    // Check if we can send
    const canSend = await canSendRecommendation(userId, isUrgent);
    if (!canSend) return null;

    return best;
  } catch (err) {
    console.error(`[RECOMMENDATION] Error for ${userId}:`, (err as Error).message);
    return null;
  }
}

// ─── Save Recommendation to DB ───

export async function saveRecommendation(
  userId: string,
  candidate: RecommendationCandidate,
  message: string,
  channel: string,
): Promise<string> {
  const rec = await prisma.recommendation.create({
    data: {
      userId,
      triggerType: candidate.triggerType,
      productName: candidate.productName,
      productUrl: candidate.productUrl,
      imageUrl: candidate.imageUrl,
      store: candidate.store,
      originalPrice: candidate.originalPrice,
      currentPrice: candidate.currentPrice,
      currency: candidate.currency,
      savingsPercent: candidate.savingsPercent,
      confidenceScore: candidate.confidenceScore,
      message,
      channel,
      status: "sent",
      sentAt: new Date(),
      sourceQuery: candidate.sourceQuery,
      metadata: candidate.metadata as Prisma.InputJsonValue ?? undefined,
    },
  });
  return rec.id;
}

// ─── Feedback Handlers ───

export async function recordRecommendationClick(recommendationId: string) {
  await prisma.recommendation.update({
    where: { id: recommendationId },
    data: { status: "clicked", clickedAt: new Date() },
  });
}

export async function recordRecommendationConversion(recommendationId: string) {
  await prisma.recommendation.update({
    where: { id: recommendationId },
    data: { status: "converted", convertedAt: new Date() },
  });
}

export async function recordRecommendationRejection(recommendationId: string) {
  await prisma.recommendation.update({
    where: { id: recommendationId },
    data: { status: "rejected", rejectedAt: new Date() },
  });
}

// Mark old sent recommendations as ignored (no interaction in 48h)
export async function markStaleAsIgnored() {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  const result = await prisma.recommendation.updateMany({
    where: {
      status: "sent",
      sentAt: { lt: cutoff },
    },
    data: { status: "ignored" },
  });
  if (result.count > 0) {
    console.log(`[RECOMMENDATION] Marked ${result.count} stale recommendations as ignored`);
  }
}

// ─── For Morning Briefing: Get top recommendations without sending ───

export async function getRecommendationsForBriefing(
  userId: string,
  telegramChatId?: string | null,
  phone?: string | null,
  lang: "pt" | "en" | "es" = "en",
): Promise<string> {
  try {
    const profile = await buildUserProfile(userId, telegramChatId, phone);
    if (profile.searchedProducts.length === 0 && profile.categories.length === 0) return "";

    // Only check price drops and restock for briefing (fast, high-confidence)
    const [priceDrops, restock] = await Promise.all([
      findPriceDrops(profile).catch(() => [] as RecommendationCandidate[]),
      findRestockCandidates(profile).catch(() => [] as RecommendationCandidate[]),
    ]);

    const candidates = [...priceDrops, ...restock]
      .filter(c => c.confidenceScore >= MIN_CONFIDENCE)
      .sort((a, b) => b.confidenceScore - a.confidenceScore)
      .slice(0, 3);

    if (candidates.length === 0) return "";

    const lines: string[] = [];
    const header = lang === "pt" ? "🐕 Farejei pra você:" : "🐕 Sniffed out for you:";
    lines.push(header);

    for (const c of candidates) {
      const curr = c.currency === "BRL" ? "R$" : "$";
      if (c.triggerType === "price_drop") {
        const savings = c.savingsPercent || 0;
        if (lang === "pt") {
          lines.push(`  🔥 ${c.productName.substring(0, 40)} — ${curr}${c.currentPrice?.toFixed(0)} (-${savings}%)`);
        } else {
          lines.push(`  🔥 ${c.productName.substring(0, 40)} — ${curr}${c.currentPrice?.toFixed(0)} (-${savings}%)`);
        }
      } else if (c.triggerType === "restock") {
        const days = (c.metadata as Record<string, unknown>)?.daysSincePurchase as number;
        if (lang === "pt") {
          lines.push(`  🔄 ${c.productName.substring(0, 40)} — repor? (${days}d)`);
        } else {
          lines.push(`  🔄 ${c.productName.substring(0, 40)} — restock? (${days}d)`);
        }
      }
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[RECOMMENDATION] Briefing section error:", (err as Error).message);
    return "";
  }
}

// ─── Metrics ───

export async function getRecommendationMetrics(days: number = 14): Promise<{
  total: number;
  clicked: number;
  converted: number;
  rejected: number;
  ignored: number;
  clickRate: number;
  conversionRate: number;
}> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [total, clicked, converted, rejected, ignored] = await Promise.all([
    prisma.recommendation.count({ where: { sentAt: { gte: since } } }),
    prisma.recommendation.count({ where: { status: "clicked", sentAt: { gte: since } } }),
    prisma.recommendation.count({ where: { status: "converted", sentAt: { gte: since } } }),
    prisma.recommendation.count({ where: { status: "rejected", sentAt: { gte: since } } }),
    prisma.recommendation.count({ where: { status: "ignored", sentAt: { gte: since } } }),
  ]);

  return {
    total,
    clicked,
    converted,
    rejected,
    ignored,
    clickRate: total > 0 ? Math.round((clicked / total) * 100) : 0,
    conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
  };
}
