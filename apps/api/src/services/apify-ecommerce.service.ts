/**
 * Apify E-Commerce Service — Unified product search via Apify actors
 *
 * Supports: Amazon (via gauravsaran/amazon-product-discovery — PAY_PER_EVENT)
 * Each search logs usage for billing (15x markup on Apify cost).
 *
 * Cost: ~$0.008 per Amazon search (3 results)
 */

import { ApifyClient } from "apify-client";
import { prisma } from "@payjarvis/database";

const client = new ApifyClient({
  token: process.env.APIFY_API_KEY,
});

// ─── Actor IDs (PAY_PER_EVENT — no monthly rental needed) ──
const ACTORS = {
  amazon: "gauravsaran/amazon-product-discovery",
} as const;

// ─── Supported Amazon domains ──────────────────────────
const AMAZON_DOMAINS: Record<string, string> = {
  US: "amazon.com",
  BR: "amazon.com.br",
  UK: "amazon.co.uk",
  DE: "amazon.de",
  FR: "amazon.fr",
  ES: "amazon.es",
  IT: "amazon.it",
  CA: "amazon.ca",
  MX: "amazon.com.mx",
  AU: "amazon.com.au",
};

// ─── Cost per run (approximate, in USD) ────────────────
const COST_PER_RUN: Record<string, number> = {
  amazon: 0.008,
};

const MARKUP = 15; // 15x markup for billing

// ─── Interfaces ────────────────────────────────────────

export interface ProductResult {
  title: string;
  price: number | null;
  priceBeforeDiscount: number | null;
  currency: string;
  url: string;
  imageUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  platform: string;
  asin?: string;
  isDiscounted?: boolean;
  isSponsored?: boolean;
}

export interface SearchOptions {
  query: string;
  platform?: string; // amazon | all (more platforms coming)
  maxResults?: number;
  country?: string;
}

// ─── Amazon Search (gauravsaran/amazon-product-discovery) ──

async function searchAmazon(query: string, maxResults: number, country: string): Promise<ProductResult[]> {
  const domain = AMAZON_DOMAINS[country] || "amazon.com";

  const run = await client.actor(ACTORS.amazon).call({
    searchTerms: [query],
    maxItems: Math.min(maxResults, 10),
    amazonDomain: domain,
  }, { waitSecs: 90 });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  return items.slice(0, maxResults).map((item: Record<string, any>) => ({
    title: item.productName || "",
    price: typeof item.productPrice === "number" ? item.productPrice : parseFloat(item.productPrice) || null,
    priceBeforeDiscount: item.productPriceBeforeDiscount ? parseFloat(item.productPriceBeforeDiscount) : null,
    currency: item.priceCurrencyCode || "USD",
    url: item.productUrl || `https://www.${domain}/dp/${item.productId}`,
    imageUrl: item.productImage || null,
    rating: null, // This actor doesn't return ratings in search results
    reviewCount: typeof item.reviewCount === "number" ? item.reviewCount : parseInt(item.reviewCount) || null,
    platform: "amazon",
    asin: item.productId,
    isDiscounted: item.isDiscountedProduct || false,
    isSponsored: item.isSponsoredProduct || false,
  }));
}

// ─── Unified Search ────────────────────────────────────

export async function searchProducts(opts: SearchOptions, userId?: string): Promise<{
  products: ProductResult[];
  totalResults: number;
  platforms: string[];
}> {
  const { query, platform = "amazon", maxResults = 5, country = "US" } = opts;
  // Currently only Amazon supported; "all" also defaults to Amazon
  const platforms = ["amazon"];
  const allProducts: ProductResult[] = [];
  let totalCost = 0;

  for (const p of platforms) {
    try {
      const results = await searchAmazon(query, maxResults, country);
      allProducts.push(...results);
      totalCost += COST_PER_RUN[p] || 0.008;
    } catch (err) {
      console.error(`[APIFY] Error searching ${p}:`, err);
    }
  }

  // Sort by price (lowest first), nulls last
  allProducts.sort((a, b) => {
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  // Log usage for billing
  if (userId && allProducts.length > 0) {
    try {
      await logApifyUsage(userId, "search_products", platforms, totalCost);
    } catch (err) {
      console.error("[APIFY] Failed to log usage:", err);
    }
  }

  return {
    products: allProducts.slice(0, maxResults),
    totalResults: allProducts.length,
    platforms,
  };
}

// ─── Usage Logging (Billing) ───────────────────────────

async function logApifyUsage(
  userId: string,
  operation: string,
  platforms: string[],
  costReal: number,
) {
  const costCharged = costReal * MARKUP;

  await prisma.$executeRaw`
    INSERT INTO apify_usage_logs (user_id, operation, platforms, cost_real_usd, cost_charged_usd, created_at)
    VALUES (${userId}, ${operation}, ${platforms.join(",")}, ${costReal}, ${costCharged}, NOW())
  `;
}

// ─── Get Usage Summary ─────────────────────────────────

export async function getUsageSummary(userId: string, days: number = 30) {
  const rows = await prisma.$queryRaw<{
    total_operations: number;
    total_cost_real: number;
    total_cost_charged: number;
  }[]>`
    SELECT
      COUNT(*)::int as total_operations,
      COALESCE(SUM(cost_real_usd), 0) as total_cost_real,
      COALESCE(SUM(cost_charged_usd), 0) as total_cost_charged
    FROM apify_usage_logs
    WHERE user_id = ${userId}
      AND created_at > NOW() - make_interval(days => ${days})
  `;
  return rows[0] || { total_operations: 0, total_cost_real: 0, total_cost_charged: 0 };
}
