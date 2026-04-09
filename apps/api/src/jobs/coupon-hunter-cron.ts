/**
 * Coupon Hunter Cron — Automated deal monitoring with 3 layers
 *
 * Layer 1 (APIs):      every 5 min  — SerpAPI, CouponAPI, LinkMyDeals
 * Layer 2 (Scraping):  every 15 min — Pelando, Promobit, Slickdeals
 * Layer 3 (Social):    every 30 min — Twitter/X, RSS
 * Wish List Matching:  every 2 min  — match new deals → push notifications
 */

import cron from "node-cron";
import {
  searchDealsViaSerpApi,
  searchCouponCodesSerpApi,
  searchCouponApi,
  searchLinkMyDeals,
  scrapePelando,
  scrapePromobit,
  scrapeSlickdeals,
  searchSocialDeals,
  classifyUrgency,
  saveDeals,
  matchAndNotifyWishList,
} from "../services/shopping/coupon-hunter.js";

// Popular search queries for proactive deal hunting
const TRENDING_US = [
  "AirPods Pro deal",
  "iPhone case discount",
  "Amazon deals today",
  "laptop deals",
  "TV deals 4K",
  "gaming headset sale",
  "robot vacuum deal",
  "air fryer discount",
  "Kindle deal",
  "Nintendo Switch deal",
];

const TRENDING_BR = [
  "cupom Amazon Brasil",
  "promoção Magazine Luiza",
  "desconto Mercado Livre",
  "oferta Kabum",
  "cupom Americanas",
  "promoção Casas Bahia",
  "air fryer promoção",
  "smartphone desconto",
  "fone bluetooth oferta",
  "notebook promoção",
];

const POPULAR_STORES_US = ["amazon", "walmart", "target", "bestbuy", "costco", "macys", "ebay"];
const POPULAR_STORES_BR = ["amazon", "magazineluiza", "mercadolivre", "americanas", "kabum", "casasbahia"];

// ─── Layer 1: API Sources (every 5 min) ───
cron.schedule("*/5 * * * *", async () => {
  console.log("[COUPON-HUNTER] Layer 1 (APIs) starting...");

  try {
    // Pick 2 random queries per country per run (to spread API usage)
    const usQueries = shuffle(TRENDING_US).slice(0, 2);
    const brQueries = shuffle(TRENDING_BR).slice(0, 2);

    const allDeals = [];

    // SerpAPI Shopping deals
    for (const q of usQueries) {
      const deals = await searchDealsViaSerpApi(q, "US");
      allDeals.push(...deals);
    }
    for (const q of brQueries) {
      const deals = await searchDealsViaSerpApi(q, "BR");
      allDeals.push(...deals);
    }

    // Coupon codes for popular stores (1 random store per country)
    const usStore = shuffle(POPULAR_STORES_US)[0];
    const brStore = shuffle(POPULAR_STORES_BR)[0];
    const usCodes = await searchCouponCodesSerpApi(usStore, "US");
    const brCodes = await searchCouponCodesSerpApi(brStore, "BR");
    allDeals.push(...usCodes, ...brCodes);

    // Future: CouponAPI + LinkMyDeals
    const couponApiDeals = await searchCouponApi("US");
    const linkMyDeals = await searchLinkMyDeals("US");
    allDeals.push(...couponApiDeals, ...linkMyDeals);

    // Classify urgency with Gemini
    const classified = await classifyUrgency(allDeals);

    // Save to DB
    const saved = await saveDeals(classified);
    console.log(`[COUPON-HUNTER] Layer 1 done: ${allDeals.length} found, ${saved} new saved`);
  } catch (err) {
    console.error("[COUPON-HUNTER] Layer 1 error:", (err as Error).message);
  }
});

// ─── Layer 2: Scraping Sources (every 15 min) ───
cron.schedule("*/15 * * * *", async () => {
  console.log("[COUPON-HUNTER] Layer 2 (Scraping) starting...");

  try {
    const [pelando, promobit, slickdeals] = await Promise.allSettled([
      scrapePelando(),
      scrapePromobit(),
      scrapeSlickdeals(),
    ]);

    const allDeals = [
      ...(pelando.status === "fulfilled" ? pelando.value : []),
      ...(promobit.status === "fulfilled" ? promobit.value : []),
      ...(slickdeals.status === "fulfilled" ? slickdeals.value : []),
    ];

    const classified = await classifyUrgency(allDeals);
    const saved = await saveDeals(classified);
    console.log(`[COUPON-HUNTER] Layer 2 done: ${allDeals.length} found, ${saved} new saved`);
  } catch (err) {
    console.error("[COUPON-HUNTER] Layer 2 error:", (err as Error).message);
  }
});

// ─── Layer 3: Social / RSS (every 30 min) ───
cron.schedule("*/30 * * * *", async () => {
  console.log("[COUPON-HUNTER] Layer 3 (Social) starting...");

  try {
    const [usDeals, brDeals] = await Promise.allSettled([
      searchSocialDeals("US"),
      searchSocialDeals("BR"),
    ]);

    const allDeals = [
      ...(usDeals.status === "fulfilled" ? usDeals.value : []),
      ...(brDeals.status === "fulfilled" ? brDeals.value : []),
    ];

    const classified = await classifyUrgency(allDeals);
    const saved = await saveDeals(classified);
    console.log(`[COUPON-HUNTER] Layer 3 done: ${allDeals.length} found, ${saved} new saved`);
  } catch (err) {
    console.error("[COUPON-HUNTER] Layer 3 error:", (err as Error).message);
  }
});

// ─── Wish List Matcher (every 2 min) ───
cron.schedule("*/2 * * * *", async () => {
  try {
    const notified = await matchAndNotifyWishList();
    if (notified > 0) {
      console.log(`[COUPON-HUNTER] Wish list matcher: ${notified} notifications sent`);
    }
  } catch (err) {
    console.error("[COUPON-HUNTER] Wish list matcher error:", (err as Error).message);
  }
});

// ─── Helpers ───

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

console.log("[Cron] Coupon Hunter: L1 every 5m, L2 every 15m, L3 every 30m, Wishlist every 2m");

export {};
