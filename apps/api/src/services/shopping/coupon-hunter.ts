/**
 * Coupon Hunter Service — 3-layer deal monitoring system
 *
 * Layer 1: APIs (CouponAPI, LinkMyDeals) — every 30 min
 * Layer 2: Playwright scraping (Pelando, Promobit, Slickdeals) — every 15 min
 * Layer 3: Social/RSS (via Gemini Grounding) — every 30 min
 *
 * Urgency classification via Gemini:
 *   URGENT → push immediately to matching wish list users
 *   NORMAL → aggregate in daily digest
 *   ALWAYS_ACTIVE → use during search queries
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet, redisSetNX } from "../redis.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ─── Config ─���─

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const COUPONAPI_KEY = process.env.COUPONAPI_KEY || ""; // future
const LINKMYDEALS_KEY = process.env.LINKMYDEALS_KEY || ""; // future
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "";

const DEAL_CACHE_TTL = 300; // 5 min Redis dedup window
const MAX_DEALS_PER_RUN = 50;

export interface CouponDealInput {
  store: string;
  title: string;
  code?: string;
  description: string;
  discountType: "percentage" | "fixed" | "free_shipping" | "deal";
  discountValue?: number;
  originalPrice?: number;
  dealPrice?: number;
  currency?: string;
  country: "US" | "BR";
  category?: string;
  productUrl?: string;
  imageUrl?: string;
  source: string;
  sourceId?: string;
  expiresAt?: Date;
  verified?: boolean;
}

// ─── LAYER 1: API Sources ───

/**
 * Future: CouponAPI.org integration
 */
export async function searchCouponApi(country: "US" | "BR" = "US"): Promise<CouponDealInput[]> {
  if (!COUPONAPI_KEY) return [];

  try {
    const res = await fetch(
      `https://api.couponapi.org/v1/coupons?country=${country}&new_since=last_check&api_key=${COUPONAPI_KEY}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.coupons ?? []).map((c: any) => ({
      store: c.store_name?.toLowerCase() || "unknown",
      title: c.title || c.description || "Coupon",
      code: c.coupon_code || undefined,
      description: c.description || c.title || "",
      discountType: c.type === "percent" ? "percentage" : c.type === "fixed" ? "fixed" : "deal",
      discountValue: c.discount_value ? parseFloat(c.discount_value) : undefined,
      currency: country === "BR" ? "BRL" : "USD",
      country,
      category: c.category || undefined,
      productUrl: c.url || undefined,
      source: "couponapi",
      sourceId: c.id?.toString() || `capi_${hashString(c.title + c.store_name)}`,
      expiresAt: c.expiry_date ? new Date(c.expiry_date) : undefined,
      verified: c.verified === true,
    })).slice(0, MAX_DEALS_PER_RUN) as CouponDealInput[];
  } catch (err) {
    console.error("[COUPON-HUNTER] CouponAPI failed:", (err as Error).message);
    return [];
  }
}

/**
 * Future: LinkMyDeals integration
 */
export async function searchLinkMyDeals(country: "US" | "BR" = "US"): Promise<CouponDealInput[]> {
  if (!LINKMYDEALS_KEY) return [];

  try {
    const res = await fetch(
      `https://feed.linkmydeals.com/getOffers/?API_KEY=${LINKMYDEALS_KEY}&format=json&incremental=1`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.offers ?? []).map((o: any) => ({
      store: o.store?.toLowerCase() || "unknown",
      title: o.title || o.description || "Deal",
      code: o.code || undefined,
      description: o.description || o.title || "",
      discountType: o.type === "Coupon" ? "percentage" : "deal",
      discountValue: o.offer_value ? parseFloat(o.offer_value) : undefined,
      currency: "USD",
      country,
      category: o.category || undefined,
      productUrl: o.url || undefined,
      source: "linkmydeals",
      sourceId: o.lmd_id?.toString() || `lmd_${hashString(o.title + o.store)}`,
      expiresAt: o.end_date ? new Date(o.end_date) : undefined,
      verified: true,
    })).slice(0, MAX_DEALS_PER_RUN) as CouponDealInput[];
  } catch (err) {
    console.error("[COUPON-HUNTER] LinkMyDeals failed:", (err as Error).message);
    return [];
  }
}

// ─── LAYER 2: Deal Site Scraping (via Gemini Grounding) ───

async function searchDealsViaGemini(site: string, query: string, country: "US" | "BR", source: string, maxResults: number = 10): Promise<CouponDealInput[]> {
  if (!GEMINI_API_KEY) return [];

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      tools: [{ googleSearch: {} } as any],
    });

    const prompt = `Search "${site} ${query}" for today's deals. Return ONLY a JSON array of max ${maxResults} deals: [{"store":"Store","title":"Deal title","description":"Brief description","price":29.99,"originalPrice":49.99,"url":"https://..."}]. ONLY JSON, no markdown.`;

    const result = await model.generateContent(prompt);
    let text: string;
    try { text = result.response.text(); } catch { text = result.response.candidates?.[0]?.content?.parts?.[0]?.text || ""; }
    if (!text) return [];

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as any[];
    if (!Array.isArray(parsed)) return [];

    return parsed.slice(0, maxResults).map((r: any) => ({
      store: r.store || extractStoreFromTitle(r.title || ""),
      title: (r.title || "").substring(0, 200),
      description: r.description || r.title || "",
      discountType: "deal" as const,
      discountValue: r.originalPrice && r.price ? Math.round(((r.originalPrice - r.price) / r.originalPrice) * 100) : undefined,
      originalPrice: r.originalPrice ?? undefined,
      dealPrice: r.price ?? undefined,
      currency: country === "BR" ? "BRL" : "USD",
      country,
      productUrl: r.url || undefined,
      source,
      sourceId: `${source}_${hashString(r.title || r.url || "")}`,
      verified: false,
    }));
  } catch (err) {
    console.error(`[COUPON-HUNTER] ${source} search failed:`, (err as Error).message);
    return [];
  }
}

/**
 * Scrape Pelando.com.br hot deals
 */
export async function scrapePelando(): Promise<CouponDealInput[]> {
  return searchDealsViaGemini("site:pelando.com.br", "cupom promoção hoje", "BR", "pelando", 20);
}

/**
 * Scrape Promobit.com.br hot deals
 */
export async function scrapePromobit(): Promise<CouponDealInput[]> {
  return searchDealsViaGemini("site:promobit.com.br", "promoção hoje", "BR", "promobit", 20);
}

/**
 * Scrape Slickdeals frontpage deals
 */
export async function scrapeSlickdeals(): Promise<CouponDealInput[]> {
  return searchDealsViaGemini("site:slickdeals.net", "frontpage deal today", "US", "slickdeals", 20);
}

// ─── LAYER 3: Social / RSS ───

/**
 * Search social media for deal mentions via Gemini Grounding
 */
export async function searchSocialDeals(country: "US" | "BR" = "US"): Promise<CouponDealInput[]> {
  if (!GEMINI_API_KEY) return [];

  const query = country === "BR"
    ? "cupom desconto promoção oferta twitter"
    : "deal coupon promo discount twitter";

  return searchDealsViaGemini("site:twitter.com OR site:x.com", query, country, "twitter", 10);
}

// ─── Urgency Classifier (Gemini) ───

export async function classifyUrgency(
  deals: CouponDealInput[]
): Promise<CouponDealInput[]> {
  if (!GEMINI_API_KEY || deals.length === 0) return deals;

  // Only classify deals that look like they might be urgent (has price drop, limited stock words, etc)
  const batch = deals.slice(0, 20);

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Classify each deal's urgency. Return ONLY a JSON array of objects with { index: number, urgency: "URGENT"|"NORMAL"|"ALWAYS_ACTIVE", reason: string }.

URGENT = limited quantity, expires soon (<24h), flash sale, lightning deal, one-time offer
NORMAL = standard deal, regular promotion, no time pressure
ALWAYS_ACTIVE = ongoing coupon code, loyalty discount, student discount, permanent deal

Deals:
${batch.map((d, i) => `${i}. ${d.title} | ${d.description} | Store: ${d.store} | Expires: ${d.expiresAt || "unknown"}`).join("\n")}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const classifications = JSON.parse(jsonMatch[0]) as { index: number; urgency: string; reason: string }[];
      for (const c of classifications) {
        if (c.index >= 0 && c.index < batch.length) {
          const deal = batch[c.index];
          if (["URGENT", "NORMAL", "ALWAYS_ACTIVE"].includes(c.urgency)) {
            (deal as any).urgency = c.urgency;
            (deal as any).urgencyReason = c.reason;
          }
        }
      }
    }

    console.log(`[COUPON-HUNTER] Classified urgency for ${batch.length} deals`);
  } catch (err) {
    console.error("[COUPON-HUNTER] Gemini classification failed:", (err as Error).message);
    // Deals keep default NORMAL urgency
  }

  return deals;
}

// ─── Deal Storage & Dedup ───

/**
 * Save deals to database, deduplicating by source+sourceId
 */
export async function saveDeals(deals: CouponDealInput[]): Promise<number> {
  let saved = 0;

  for (const deal of deals) {
    // Skip if no sourceId (can't dedup)
    if (!deal.sourceId) continue;

    // Redis dedup check (fast path)
    const dedupKey = `coupon_dedup:${deal.source}:${deal.sourceId}`;
    const isNew = await redisSetNX(dedupKey, "1", DEAL_CACHE_TTL);
    if (!isNew) continue; // Already processed

    try {
      await prisma.$executeRaw`
        INSERT INTO coupon_deals (
          id, store, title, code, description, "discountType", "discountValue",
          "originalPrice", "dealPrice", currency, country, category, "productUrl",
          "imageUrl", urgency, "urgencyReason", source, "sourceId", "expiresAt",
          verified, notified, "createdAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${deal.store},
          ${deal.title.substring(0, 500)},
          ${deal.code || null},
          ${deal.description.substring(0, 1000)},
          ${deal.discountType},
          ${deal.discountValue ?? null}::double precision,
          ${deal.originalPrice ?? null}::double precision,
          ${deal.dealPrice ?? null}::double precision,
          ${deal.currency || "USD"},
          ${deal.country},
          ${deal.category || null},
          ${deal.productUrl || null},
          ${deal.imageUrl || null},
          ${(deal as any).urgency || "NORMAL"},
          ${(deal as any).urgencyReason || null},
          ${deal.source},
          ${deal.sourceId!.substring(0, 490)},
          ${deal.expiresAt || null}::timestamp,
          ${deal.verified || false},
          false,
          NOW()
        )
        ON CONFLICT (source, "sourceId") DO UPDATE SET
          "dealPrice" = COALESCE(EXCLUDED."dealPrice", coupon_deals."dealPrice"),
          description = EXCLUDED.description,
          urgency = EXCLUDED.urgency,
          "urgencyReason" = COALESCE(EXCLUDED."urgencyReason", coupon_deals."urgencyReason")
      `;
      saved++;
    } catch (err) {
      // Log but don't crash
      const msg = (err as Error).message;
      if (!msg.includes("duplicate") && !msg.includes("unique")) {
        console.error("[COUPON-HUNTER] Save deal error:", msg.substring(0, 200));
      }
    }
  }

  return saved;
}

// ─── Wish List Matching & Notifications ───

/**
 * Match new deals against user wish lists and send notifications
 */
export async function matchAndNotifyWishList(): Promise<number> {
  let notified = 0;

  // Get unnotified deals
  const deals = await prisma.couponDeal.findMany({
    where: {
      notified: false,
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  if (deals.length === 0) return 0;

  // Get active wish list items
  const wishItems = await prisma.userWishlistItem.findMany({
    where: { active: true },
  });

  if (wishItems.length === 0) {
    // Mark all as notified since there's no one to notify
    await prisma.couponDeal.updateMany({
      where: { id: { in: deals.map(d => d.id) } },
      data: { notified: true },
    });
    return 0;
  }

  for (const deal of deals) {
    const matchingWishes = wishItems.filter(wish => {
      // Country match
      if (wish.country !== deal.country) return false;

      // Text match (case-insensitive keyword match)
      const query = wish.query.toLowerCase();
      const dealText = `${deal.title} ${deal.description} ${deal.store}`.toLowerCase();

      // Split query into words and check if all words appear in deal
      const queryWords = query.split(/\s+/).filter(w => w.length > 2);
      const allMatch = queryWords.every(word => dealText.includes(word));
      if (!allMatch) return false;

      // Price check
      if (wish.maxPrice && deal.dealPrice && deal.dealPrice > wish.maxPrice) return false;

      return true;
    });

    if (matchingWishes.length > 0) {
      // Send notification to each matching user
      for (const wish of matchingWishes) {
        try {
          await sendDealNotification(wish, deal);
          notified++;

          // Update wish list match stats
          await prisma.userWishlistItem.update({
            where: { id: wish.id },
            data: {
              lastMatchAt: new Date(),
              matchCount: { increment: 1 },
            },
          });
        } catch (err) {
          console.error(`[COUPON-HUNTER] Notification failed for wish ${wish.id}:`, (err as Error).message);
        }
      }
    }

    // Mark deal as notified
    await prisma.couponDeal.update({
      where: { id: deal.id },
      data: { notified: true },
    });
  }

  console.log(`[COUPON-HUNTER] Matched & notified ${notified} wish list items`);
  return notified;
}

async function sendDealNotification(wish: any, deal: any): Promise<void> {
  const urgencyEmoji = deal.urgency === "URGENT" ? "🔴" : "🟢";
  const urgencyLabel = deal.urgency === "URGENT" ? "CUPOM URGENTE" : "Oferta encontrada";

  const priceInfo = deal.dealPrice
    ? deal.originalPrice
      ? `${formatCurrency(deal.dealPrice, deal.currency)} (normal ${formatCurrency(deal.originalPrice, deal.currency)})`
      : formatCurrency(deal.dealPrice, deal.currency)
    : "";

  const message = [
    `🐕${urgencyEmoji} ${urgencyLabel}!`,
    deal.title,
    priceInfo,
    deal.code ? `Código: ${deal.code}` : "",
    `Loja: ${deal.store}`,
    deal.urgencyReason ? `⏰ ${deal.urgencyReason}` : "",
    deal.expiresAt ? `Expira: ${new Date(deal.expiresAt).toLocaleDateString()}` : "",
    deal.productUrl ? `🔗 ${deal.productUrl}` : "",
    "",
    "Comprar agora? 🐕",
  ].filter(Boolean).join("\n");

  if (wish.channel === "telegram" && TELEGRAM_BOT_TOKEN) {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: wish.channelId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
  } else if (wish.channel === "whatsapp" && TWILIO_ACCOUNT_SID) {
    const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${auth}`,
        },
        body: new URLSearchParams({
          From: TWILIO_WHATSAPP_NUMBER,
          To: wish.channelId,
          Body: message,
        }),
      }
    );
  }
}

// ─── Public API: Manual Coupon Search (Gemini tool) ───

export async function searchCoupons(
  store: string | undefined,
  category: string | undefined,
  country: "US" | "BR" = "US"
): Promise<any[]> {
  // 1. Check DB for recent deals
  const where: any = {
    country,
    createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  };
  if (store) where.store = { contains: store.toLowerCase(), mode: "insensitive" };
  if (category) where.category = category;

  const dbDeals = await prisma.couponDeal.findMany({
    where,
    orderBy: [{ urgency: "asc" }, { createdAt: "desc" }], // URGENT first
    take: 20,
  });

  if (dbDeals.length >= 5) {
    return dbDeals.map(formatDealForApi);
  }

  // 2. If not enough in DB, search live via Gemini Grounding
  const query = store || category || "best deals";
  const liveDeals = await searchDealsViaGemini("", `${query} deal coupon`, country, "gemini_search", 20);

  // Save and return
  if (liveDeals.length > 0) {
    const classified = await classifyUrgency(liveDeals);
    await saveDeals(classified);
  }

  // Re-query DB (now includes fresh results)
  const freshDeals = await prisma.couponDeal.findMany({
    where,
    orderBy: [{ urgency: "asc" }, { createdAt: "desc" }],
    take: 20,
  });

  return freshDeals.length > 0 ? freshDeals.map(formatDealForApi) : liveDeals.map(formatInputForApi);
}

// ─── Helpers ───

function formatDealForApi(deal: any) {
  return {
    id: deal.id,
    store: deal.store,
    title: deal.title,
    code: deal.code,
    description: deal.description,
    discountType: deal.discountType,
    discountValue: deal.discountValue,
    originalPrice: deal.originalPrice,
    dealPrice: deal.dealPrice,
    currency: deal.currency,
    country: deal.country,
    category: deal.category,
    productUrl: deal.productUrl,
    urgency: deal.urgency,
    urgencyReason: deal.urgencyReason,
    expiresAt: deal.expiresAt,
    verified: deal.verified,
    source: deal.source,
  };
}

function formatInputForApi(deal: CouponDealInput) {
  return {
    store: deal.store,
    title: deal.title,
    code: deal.code,
    description: deal.description,
    discountType: deal.discountType,
    discountValue: deal.discountValue,
    originalPrice: deal.originalPrice,
    dealPrice: deal.dealPrice,
    currency: deal.currency,
    country: deal.country,
    category: deal.category,
    productUrl: deal.productUrl,
    urgency: "NORMAL",
    source: deal.source,
  };
}

function parsePrice(price: any): number | null {
  if (typeof price === "number") return price;
  if (typeof price === "string") {
    const cleaned = price.replace(/[^0-9.,]/g, "").replace(",", ".");
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatCurrency(amount: number, currency: string): string {
  if (currency === "BRL") return `R$${amount.toFixed(2)}`;
  return `$${amount.toFixed(2)}`;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function inferCategory(title: string): string | undefined {
  const t = title.toLowerCase();
  if (/airpod|headphone|earbu|speaker|jbl|bose|beats|sony wh|echo dot/i.test(t)) return "electronics";
  if (/iphone|samsung|pixel|galaxy|smartphone|phone case/i.test(t)) return "smartphones";
  if (/laptop|macbook|chromebook|thinkpad|dell|hp pavilion/i.test(t)) return "computers";
  if (/tv|monitor|display|oled|qled|roku|fire stick/i.test(t)) return "tv_displays";
  if (/nike|adidas|shoe|sneaker|boot|sandal/i.test(t)) return "clothing";
  if (/air fryer|instant pot|blender|coffee|kitchenaid/i.test(t)) return "kitchen";
  if (/vacuum|roomba|robot|mop|dyson/i.test(t)) return "home";
  if (/playstation|xbox|nintendo|switch|ps5|gaming/i.test(t)) return "gaming";
  if (/kindle|book|tablet|ipad/i.test(t)) return "tablets_ereaders";
  return undefined;
}

function extractStoreFromTitle(title: string): string {
  const stores = ["amazon", "walmart", "target", "best buy", "costco", "macys", "ebay",
    "mercado livre", "magazine luiza", "americanas", "casas bahia", "kabum"];
  const lower = title.toLowerCase();
  for (const s of stores) {
    if (lower.includes(s)) return s;
  }
  // Try to extract "at Store" or "em Loja"
  const atMatch = lower.match(/(?:at|em|@)\s+([a-z][a-z\s]+?)(?:\s*[-—|]|\s*$)/);
  if (atMatch) return atMatch[1].trim();
  return "various";
}

function extractCouponCodes(text: string): { code: string; description: string; discountType: "percentage" | "fixed" | "free_shipping"; discountValue: number | null }[] {
  const codes: { code: string; description: string; discountType: "percentage" | "fixed" | "free_shipping"; discountValue: number | null }[] = [];
  const codePattern = /(?:code|coupon|promo|voucher|use|cupom|codigo)\s*:?\s*([A-Z0-9]{4,20})/gi;
  const skipCodes = new Set(["CODE", "COUPON", "PROMO", "SAVE", "FREE", "DEAL", "BEST", "THIS", "THAT", "MORE", "NONE", "HTTP", "HTTPS", "HTML"]);

  let match;
  while ((match = codePattern.exec(text)) !== null) {
    const code = match[1].toUpperCase();
    if (skipCodes.has(code)) continue;

    const surrounding = text.substring(Math.max(0, match.index - 50), match.index + match[0].length + 50);
    const percentMatch = surrounding.match(/(\d{1,2})%\s*(?:off|desconto|discount)/i);
    const fixedMatch = surrounding.match(/\$(\d+(?:\.\d{2})?)\s*(?:off|desconto|discount)/i);
    const shippingMatch = surrounding.match(/free\s*shipping|frete\s*gr[aá]tis/i);

    let discountType: "percentage" | "fixed" | "free_shipping" = "percentage";
    let discountValue: number | null = null;
    let description = `Coupon ${code}`;

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

    codes.push({ code, description, discountType, discountValue });
  }

  // Dedup
  const seen = new Set<string>();
  return codes.filter(c => {
    if (seen.has(c.code)) return false;
    seen.add(c.code);
    return true;
  });
}
