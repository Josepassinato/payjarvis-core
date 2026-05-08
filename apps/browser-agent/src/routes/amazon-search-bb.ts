/**
 * Amazon Search via Browserbase (Playwright CDP)
 *
 * POST /amazon/search-bb
 * Body: { query: string, maxResults?: number, domain?: string }
 *
 * Opens a fresh Browserbase cloud session, connects via Playwright CDP,
 * navigates to Amazon search results, and extracts the top N products
 * via deterministic DOM scraping (data-asin tiles). Returns direct
 * amazon.com/dp/ASIN links. Bypasses Stagehand (no LLM dependency).
 *
 * Session is ALWAYS closed (finally block) to avoid billing leaks.
 */

import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { createSession } from "../services/browserbase-client.js";

interface RawTile {
  asin: string;
  title: string;
  price: string;
  rating: string | null;
  reviewCount: string | null;
  imageUrl: string | null;
  prime: boolean;
  sponsored: boolean;
}

const CACHE_TTL_SECONDS = 3600; // 1h

let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    });
    redisClient.connect().catch(() => {
      console.warn("[AMAZON-SEARCH-BB] Redis unavailable — cache disabled");
    });
    return redisClient;
  } catch {
    return null;
  }
}

export async function amazonSearchBbRoutes(app: FastifyInstance) {
  app.post("/amazon/search-bb", async (request, reply) => {
    const body = request.body as {
      query?: string;
      maxResults?: number;
      domain?: string;
      noCache?: boolean;
    };

    if (!body?.query) {
      return reply.status(400).send({ success: false, error: "query is required" });
    }

    const max = Math.min(Math.max(body.maxResults ?? 3, 1), 5);
    const domain = body.domain ?? "amazon.com";
    const searchUrl = `https://www.${domain}/s?k=${encodeURIComponent(body.query)}`;
    const cacheKey = `search:amazon-bb:${domain}:${body.query.toLowerCase().trim()}:${max}`;

    const tag = `[AMAZON-SEARCH-BB]`;
    const t0 = Date.now();
    console.log(`${tag} query="${body.query}" max=${max}`);

    // ── Cache lookup ────────────────────────────────────
    const redis = getRedis();
    if (redis && !body.noCache && redis.status === "ready") {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed?.products?.length > 0) {
            console.log(`${tag} CACHE HIT "${body.query}" (${parsed.products.length} products, ${Date.now() - t0}ms)`);
            return { ...parsed, fromCache: true };
          }
        }
      } catch {
        /* cache miss on parse error */
      }
    }

    const apiKey = process.env.BROWSERBASE_API_KEY;
    if (!apiKey) {
      return reply.status(500).send({ success: false, error: "BROWSERBASE_API_KEY not set", products: [] });
    }

    let browser: Awaited<ReturnType<typeof import("playwright-core").chromium.connectOverCDP>> | null = null;
    try {
      const session = await createSession({
        browserSettings: { blockAds: true },
        timeout: 120,
      });
      const sessionId = session.sessionId;
      const connectUrl = `wss://connect.browserbase.com?apiKey=${apiKey}&sessionId=${sessionId}`;

      const { chromium } = await import("playwright-core");
      browser = await chromium.connectOverCDP(connectUrl);
      const ctx = browser.contexts()[0];
      const page = ctx?.pages()[0] ?? (await ctx!.newPage());

      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForSelector("[data-asin]", { timeout: 15_000 }).catch(() => null);

      const rawProducts = (await page.evaluate((n: number) => {
        const out: Array<{
          asin: string;
          title: string;
          price: string;
          rating: string | null;
          reviewCount: string | null;
          imageUrl: string | null;
          prime: boolean;
          sponsored: boolean;
        }> = [];
        const tiles = document.querySelectorAll("[data-asin]");
        for (const tile of Array.from(tiles)) {
          const asin = tile.getAttribute("data-asin");
          if (!asin || asin.length < 8) continue;
          const titleEl = tile.querySelector("h2 span, h2 a span");
          const title = titleEl?.textContent?.trim();
          if (!title) continue;
          const priceEl = tile.querySelector(".a-price .a-offscreen");
          const price = priceEl?.textContent?.trim() || "";
          const ratingEl = tile.querySelector(".a-icon-alt");
          const ratingTxt = ratingEl?.textContent?.split(" ")[0] || "";
          const reviewEl = tile.querySelector(
            '.a-size-base.s-underline-text, [aria-label*="stars"] + span',
          );
          const reviewCount = reviewEl?.textContent?.trim()?.replace(/[()]/g, "") || null;
          const imgEl = tile.querySelector("img.s-image");
          const imageUrl = imgEl?.getAttribute("src") || null;
          const prime = !!tile.querySelector('[aria-label*="Prime"], .a-icon-prime');
          const sponsored = !!tile.querySelector(
            '[aria-label*="Sponsored"], .puis-sponsored-label-text',
          );
          out.push({
            asin,
            title: title.slice(0, 140),
            price,
            rating: ratingTxt || null,
            reviewCount,
            imageUrl,
            prime,
            sponsored,
          });
          if (out.length >= n + 5) break;
        }
        return out;
      }, max * 3)) as RawTile[];

      const seen = new Set<string>();
      const sorted = [
        ...rawProducts.filter((p) => !p.sponsored),
        ...rawProducts.filter((p) => p.sponsored),
      ];
      const products: Array<{
        asin: string;
        title: string;
        price: string;
        rating?: string;
        reviewCount?: string;
        imageUrl?: string;
        prime?: boolean;
        url: string;
      }> = [];
      for (const p of sorted) {
        if (seen.has(p.asin)) continue;
        seen.add(p.asin);
        products.push({
          asin: p.asin,
          title: p.title,
          price: p.price || "See price",
          rating: p.rating || undefined,
          reviewCount: p.reviewCount || undefined,
          imageUrl: p.imageUrl || undefined,
          prime: p.prime || undefined,
          url: `https://www.${domain}/dp/${p.asin}`,
        });
        if (products.length >= max) break;
      }

      console.log(
        `${tag} ✓ ${products.length} products in ${Date.now() - t0}ms (raw=${rawProducts.length})`,
      );

      const result = { success: true, products };
      if (redis && redis.status === "ready" && products.length > 0) {
        redis
          .setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(result))
          .catch(() => {});
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "search failed";
      console.error(`${tag} ERROR ${Date.now() - t0}ms: ${message}`);
      return reply.status(500).send({ success: false, error: message, products: [] });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {
          /* ignore close errors */
        }
      }
    }
  });
}
