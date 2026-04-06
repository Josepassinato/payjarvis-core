/**
 * Retail Routes — Unified retail & pharmacy API
 *
 * POST /api/retail/search          — Search products across platforms
 * POST /api/retail/compare         — Compare prices across all retailers
 * GET  /api/retail/stores/:zip     — Find all retail stores near zip
 * POST /api/retail/rx/status       — Check prescription status
 * POST /api/retail/clinic/book     — Book MinuteClinic / immunization
 * GET  /api/retail/deals/:zip      — Weekly deals from all platforms
 * POST /api/retail/target/search   — Target product search
 * GET  /api/retail/target/stores/:zip — Target stores near zip
 * POST /api/retail/publix/search   — Publix product search
 * GET  /api/retail/publix/bogo/:zip — Publix BOGO deals
 * POST /api/retail/macys/search    — Macy's product search
 * GET  /api/retail/macys/sales     — Macy's current sales
 */

import type { FastifyInstance } from "fastify";
import {
  comparePrice,
  findBestDeal,
  findNearestStores,
  checkRxAcrossPlatforms,
  getWeeklyDeals,
  searchTarget,
  searchPublix,
  searchMacys,
  getTargetStores,
  getPublixBogo,
  getMacysSales,
  type RetailPlatform,
} from "../services/retail/retail-service.js";
import * as cvs from "../services/pharmacy/cvs-client.js";
import * as walgreens from "../services/pharmacy/walgreens-client.js";
import { unifiedProductSearch } from "../services/search/unified-search.service.js";
import { searchFlightsSerpApi, searchHotelsSerpApi, searchEventsSerpApi } from "../services/search/serpapi-travel.service.js";
import { findCoupons, estimateSavings } from "../services/shopping/coupons.service.js";
import { checkPriceHistory, recordPrice } from "../services/shopping/price-history.service.js";
import { getProductReviews } from "../services/shopping/reviews.service.js";
import {
  scanAllSubscriptions, getSubscriptionSummary, cancelSubscription,
  detectWaste, addSubscriptionManually, getSubscriptions,
} from "../services/subscriptions/subscription-manager.service.js";

export async function retailRoutes(app: FastifyInstance) {
  // ── SerpAPI Flights ─────────────────────────────────
  app.post("/api/serpapi/flights", async (request, reply) => {
    const body = request.body as { from?: string; to?: string; date?: string; returnDate?: string; passengers?: number };
    if (!body?.from || !body?.to || !body?.date) {
      return reply.status(400).send({ success: false, error: "from, to, and date are required" });
    }
    try {
      const result = await searchFlightsSerpApi({ from: body.from!, to: body.to!, date: body.date!, returnDate: body.returnDate, passengers: body.passengers });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ── SerpAPI Hotels ──────────────────────────────────
  app.post("/api/serpapi/hotels", async (request, reply) => {
    const body = request.body as { location?: string; checkIn?: string; checkOut?: string; guests?: number };
    if (!body?.location || !body?.checkIn || !body?.checkOut) {
      return reply.status(400).send({ success: false, error: "location, checkIn, and checkOut are required" });
    }
    try {
      const result = await searchHotelsSerpApi({ location: body.location!, checkIn: body.checkIn!, checkOut: body.checkOut!, guests: body.guests });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ── SerpAPI Events ──────────────────────────────────
  app.post("/api/serpapi/events", async (request, reply) => {
    const body = request.body as { query?: string; location?: string };
    if (!body?.query) {
      return reply.status(400).send({ success: false, error: "query is required" });
    }
    try {
      const result = await searchEventsSerpApi({ query: body.query!, location: body.location });
      return reply.send({ success: true, data: result });
    } catch (err) {
      return reply.status(500).send({ success: false, error: (err as Error).message });
    }
  });

  // ── Unified Product Search (fallback chain) ───────────
  app.post("/api/retail/unified-search", async (request, reply) => {
    const body = request.body as {
      query?: string;
      store?: string;
      country?: string;
      zipCode?: string;
      maxResults?: number;
      userId?: string;
    };

    if (!body?.query) {
      return reply.status(400).send({ success: false, error: "query is required" });
    }

    try {
      const startMs = Date.now();
      const result = await unifiedProductSearch({
        query: body.query,
        store: body.store,
        country: body.country || "US",
        zipCode: body.zipCode,
        maxResults: body.maxResults || 5,
        userId: body.userId,
      });

      // ─── LOG SEARCH TO commerce_search_logs ───
      const durationMs = Date.now() - startMs;
      try {
        const { prisma } = await import("@payjarvis/database");
        await prisma.commerceSearchLog.create({
          data: {
            botId: (request.headers["x-bot-id"] as string) || "openclaw",
            service: "products",
            params: {
              query: body.query,
              store: body.store || null,
              country: body.country || "US",
              userId: body.userId || null,
            },
            resultCount: result?.products?.length ?? 0,
            cached: (result as any)?.fromCache ?? false,
            durationMs,
          },
        });
      } catch (logErr) {
        request.log.warn(logErr, "[COMMERCE-LOG] Failed to log search");
      }

      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      request.log.error(err, "[UNIFIED-SEARCH] error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Price Alerts: Create ─────────────────────────────
  app.post("/api/retail/price-alerts", async (request, reply) => {
    const body = request.body as {
      userId?: string;
      query?: string;
      store?: string;
      targetPrice?: number;
      currency?: string;
      country?: string;
    };

    if (!body?.userId || !body?.query || !body?.targetPrice) {
      return reply.status(400).send({ success: false, error: "userId, query, and targetPrice are required" });
    }

    try {
      const { prisma } = await import("@payjarvis/database");
      const alert = await prisma.priceAlert.create({
        data: {
          userId: body.userId,
          query: body.query,
          store: body.store || null,
          targetPrice: body.targetPrice,
          currency: body.currency || "USD",
          country: body.country || "US",
        },
      });
      return reply.send({ success: true, data: alert });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create price alert";
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Price Alerts: List ──────────────────────────────
  app.get("/api/retail/price-alerts/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const { prisma } = await import("@payjarvis/database");
      const alerts = await prisma.priceAlert.findMany({
        where: { userId, active: true },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ success: true, data: alerts });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to list alerts" });
    }
  });

  // ── Price Alerts: Delete ────────────────────────────
  app.delete("/api/retail/price-alerts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { prisma } = await import("@payjarvis/database");
      await prisma.priceAlert.update({ where: { id }, data: { active: false } });
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to delete alert" });
    }
  });

  // ═══ Shopping Tools ═══════════════════════════════════

  // ── Find Coupons ─────────────────────────────────────
  app.post("/api/shopping/coupons", async (request, reply) => {
    const { store, purchaseAmount } = request.body as { store?: string; purchaseAmount?: number };
    if (!store) return reply.status(400).send({ success: false, error: "store is required" });

    try {
      const coupons = await findCoupons(store);
      const bestDeal = purchaseAmount ? estimateSavings(coupons, purchaseAmount) : null;
      return reply.send({ success: true, data: { coupons, bestDeal } });
    } catch (err) {
      request.log.error(err, "[SHOPPING] coupons error");
      return reply.status(500).send({ success: false, error: "Failed to find coupons" });
    }
  });

  // ── Check Price History ──────────────────────────────
  app.post("/api/shopping/price-history", async (request, reply) => {
    const { productName, currentPrice, store, asin } = request.body as {
      productName?: string; currentPrice?: number; store?: string; asin?: string;
    };
    if (!productName || currentPrice === undefined) {
      return reply.status(400).send({ success: false, error: "productName and currentPrice required" });
    }

    try {
      const history = await checkPriceHistory(productName, currentPrice, store, asin);
      return reply.send({ success: true, data: history });
    } catch (err) {
      request.log.error(err, "[SHOPPING] price-history error");
      return reply.status(500).send({ success: false, error: "Failed to check price history" });
    }
  });

  // ── Record Price (internal — called by search pipeline) ──
  app.post("/api/shopping/record-price", async (request, reply) => {
    const { productIdentifier, store, price, currency } = request.body as {
      productIdentifier?: string; store?: string; price?: number; currency?: string;
    };
    if (!productIdentifier || !store || price === undefined) {
      return reply.status(400).send({ success: false, error: "productIdentifier, store, price required" });
    }
    try {
      await recordPrice(productIdentifier, store, price, currency);
      return reply.send({ success: true });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to record price" });
    }
  });

  // ── Product Reviews ──────────────────────────────────
  app.post("/api/shopping/reviews", async (request, reply) => {
    const { productName, store, asin } = request.body as {
      productName?: string; store?: string; asin?: string;
    };
    if (!productName) {
      return reply.status(400).send({ success: false, error: "productName is required" });
    }

    try {
      const reviews = await getProductReviews(productName, store, asin);
      return reply.send({ success: true, data: reviews });
    } catch (err) {
      request.log.error(err, "[SHOPPING] reviews error");
      return reply.status(500).send({ success: false, error: "Failed to get reviews" });
    }
  });

  // ═══ Subscription Management ════════════════════════

  // ── Scan subscriptions from PayPal + MP ──────────────
  app.post("/api/subscriptions/scan", async (request, reply) => {
    const { userId } = request.body as { userId?: string };
    if (!userId) return reply.status(400).send({ success: false, error: "userId required" });
    try {
      const subs = await scanAllSubscriptions(userId);
      return reply.send({ success: true, data: subs });
    } catch (err) {
      request.log.error(err, "[SUBSCRIPTIONS] scan error");
      return reply.status(500).send({ success: false, error: "Scan failed" });
    }
  });

  // ── Get subscription summary ─────────────────────────
  app.get("/api/subscriptions/:userId/summary", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const summary = await getSubscriptionSummary(userId);
      return reply.send({ success: true, data: summary });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to get summary" });
    }
  });

  // ── List subscriptions ───────────────────────────────
  app.get("/api/subscriptions/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const subs = await getSubscriptions(userId);
      return reply.send({ success: true, data: subs });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to list subscriptions" });
    }
  });

  // ── Cancel subscription ──────────────────────────────
  app.post("/api/subscriptions/cancel", async (request, reply) => {
    const { userId, subscriptionId, reason } = request.body as {
      userId?: string; subscriptionId?: string; reason?: string;
    };
    if (!userId || !subscriptionId) {
      return reply.status(400).send({ success: false, error: "userId and subscriptionId required" });
    }
    try {
      const result = await cancelSubscription(userId, subscriptionId, reason);
      return reply.send({ success: result.success, data: result });
    } catch (err) {
      request.log.error(err, "[SUBSCRIPTIONS] cancel error");
      return reply.status(500).send({ success: false, error: "Cancel failed" });
    }
  });

  // ── Add subscription manually ────────────────────────
  app.post("/api/subscriptions/add", async (request, reply) => {
    const { userId, serviceName, amount, currency, billingCycle, paymentMethod } = request.body as {
      userId?: string; serviceName?: string; amount?: number; currency?: string;
      billingCycle?: string; paymentMethod?: string;
    };
    if (!userId || !serviceName || amount === undefined) {
      return reply.status(400).send({ success: false, error: "userId, serviceName, amount required" });
    }
    try {
      const sub = await addSubscriptionManually(userId, { serviceName, amount, currency, billingCycle, paymentMethod });
      return reply.send({ success: true, data: sub });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to add subscription" });
    }
  });

  // ── Detect waste ─────────────────────────────────────
  app.get("/api/subscriptions/:userId/waste", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      const waste = await detectWaste(userId);
      return reply.send({ success: true, data: waste });
    } catch (err) {
      return reply.status(500).send({ success: false, error: "Failed to detect waste" });
    }
  });

  // ── Search products across selected platforms ─────────
  app.post("/api/retail/search", async (request, reply) => {
    const body = request.body as {
      query?: string;
      zipCode?: string;
      platforms?: string[];
    };

    if (!body?.query || !body?.zipCode) {
      return reply
        .status(400)
        .send({ success: false, error: "query and zipCode are required" });
    }

    try {
      const platforms = body.platforms as RetailPlatform[] | undefined;
      const results = await comparePrice(body.query, body.zipCode, platforms);
      return reply.send({ success: true, data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Search failed";
      request.log.error(err, "[RETAIL] search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Compare prices across all retailers ───────────────
  app.post("/api/retail/compare", async (request, reply) => {
    const body = request.body as { query?: string; zipCode?: string };

    if (!body?.query || !body?.zipCode) {
      return reply
        .status(400)
        .send({ success: false, error: "query and zipCode are required" });
    }

    try {
      const result = await findBestDeal(body.query, body.zipCode);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Comparison failed";
      request.log.error(err, "[RETAIL] compare error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Find all retail stores near a zip code ────────────
  app.get("/api/retail/stores/:zip", async (request, reply) => {
    const { zip } = request.params as { zip: string };
    const { radius } = request.query as { radius?: string };

    if (!zip || zip.length < 5) {
      return reply
        .status(400)
        .send({ success: false, error: "Valid zip code is required" });
    }

    try {
      const stores = await findNearestStores(zip, radius ? Number(radius) : undefined);
      return reply.send({ success: true, data: stores });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Store lookup failed";
      request.log.error(err, "[RETAIL] stores error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Check prescription status ─────────────────────────
  app.post("/api/retail/rx/status", async (request, reply) => {
    const body = request.body as {
      rxNumber?: string;
      lastName?: string;
      dob?: string;
      platform?: "cvs" | "walgreens";
    };

    if (!body?.rxNumber) {
      return reply
        .status(400)
        .send({ success: false, error: "rxNumber is required" });
    }

    try {
      // If a specific platform is requested, check only that one
      if (body.platform === "cvs") {
        if (!body.dob) {
          return reply
            .status(400)
            .send({ success: false, error: "dob is required for CVS" });
        }
        const result = await cvs.checkPrescriptionStatus(body.rxNumber, body.dob);
        return reply.send({ success: true, data: { platform: "cvs", ...result } });
      }

      if (body.platform === "walgreens") {
        if (!body.lastName) {
          return reply
            .status(400)
            .send({ success: false, error: "lastName is required for Walgreens" });
        }
        const result = await walgreens.checkPrescriptionReady(body.rxNumber, body.lastName);
        return reply.send({ success: true, data: { platform: "walgreens", ...result } });
      }

      // No platform specified — check both
      const results = await checkRxAcrossPlatforms(body.rxNumber, {
        lastName: body.lastName,
        dob: body.dob,
      });
      return reply.send({ success: true, data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Rx check failed";
      request.log.error(err, "[RETAIL] rx/status error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Book MinuteClinic / immunization appointment ──────
  app.post("/api/retail/clinic/book", async (request, reply) => {
    const body = request.body as {
      service?: string;
      zipCode?: string;
      date?: string;
      platform?: "cvs" | "walgreens";
    };

    if (!body?.service || !body?.zipCode || !body?.date) {
      return reply
        .status(400)
        .send({ success: false, error: "service, zipCode, and date are required" });
    }

    try {
      if (body.platform === "walgreens") {
        // Find nearest Walgreens and check immunization slots
        const stores = await walgreens.findStores(0, 0); // needs lat/lng — zip lookup via browser
        if (stores.length === 0) {
          return reply.send({ success: true, data: { slots: [], message: "No Walgreens stores found" } });
        }
        const slots = await walgreens.bookImmunization(body.service, stores[0].storeId, body.date);
        return reply.send({ success: true, data: { platform: "walgreens", slots } });
      }

      // Default: CVS MinuteClinic
      const stores = await cvs.findStores(body.zipCode);
      if (stores.length === 0) {
        return reply.send({ success: true, data: { slots: [], message: "No CVS stores found" } });
      }

      const slots = await cvs.getMinuteClinicAvailability(stores[0].storeId, body.date);
      return reply.send({ success: true, data: { platform: "cvs", slots } });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Booking failed";
      request.log.error(err, "[RETAIL] clinic/book error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Weekly deals from all platforms ───────────────────
  app.get("/api/retail/deals/:zip", async (request, reply) => {
    const { zip } = request.params as { zip: string };

    if (!zip || zip.length < 5) {
      return reply
        .status(400)
        .send({ success: false, error: "Valid zip code is required" });
    }

    try {
      const deals = await getWeeklyDeals(zip);
      return reply.send({ success: true, data: deals });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deals lookup failed";
      request.log.error(err, "[RETAIL] deals error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Target: product search ────────────────────────────
  app.post("/api/retail/target/search", async (request, reply) => {
    const body = request.body as { query?: string; zipCode?: string };

    if (!body?.query || !body?.zipCode) {
      return reply
        .status(400)
        .send({ success: false, error: "query and zipCode are required" });
    }

    try {
      const results = await searchTarget(body.query, body.zipCode);
      return reply.send({ success: true, data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Target search failed";
      request.log.error(err, "[RETAIL] target/search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Target: stores near zip ───────────────────────────
  app.get("/api/retail/target/stores/:zip", async (request, reply) => {
    const { zip } = request.params as { zip: string };

    if (!zip || zip.length < 5) {
      return reply
        .status(400)
        .send({ success: false, error: "Valid zip code is required" });
    }

    try {
      const stores = await getTargetStores(zip);
      return reply.send({ success: true, data: stores });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Target stores lookup failed";
      request.log.error(err, "[RETAIL] target/stores error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Publix: product search ────────────────────────────
  app.post("/api/retail/publix/search", async (request, reply) => {
    const body = request.body as { query?: string; zipCode?: string };

    if (!body?.query || !body?.zipCode) {
      return reply
        .status(400)
        .send({ success: false, error: "query and zipCode are required" });
    }

    try {
      const results = await searchPublix(body.query, body.zipCode);
      return reply.send({ success: true, data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publix search failed";
      request.log.error(err, "[RETAIL] publix/search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Publix: BOGO deals ───────────────────────────────
  app.get("/api/retail/publix/bogo/:zip", async (request, reply) => {
    const { zip } = request.params as { zip: string };

    if (!zip || zip.length < 5) {
      return reply
        .status(400)
        .send({ success: false, error: "Valid zip code is required" });
    }

    try {
      const deals = await getPublixBogo(zip);
      return reply.send({ success: true, data: deals });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publix BOGO lookup failed";
      request.log.error(err, "[RETAIL] publix/bogo error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Macy's: product search ───────────────────────────
  app.post("/api/retail/macys/search", async (request, reply) => {
    const body = request.body as {
      query?: string;
      category?: string;
      priceMin?: number;
      priceMax?: number;
    };

    if (!body?.query) {
      return reply
        .status(400)
        .send({ success: false, error: "query is required" });
    }

    try {
      const results = await searchMacys(body.query, "", {
        category: body.category,
        priceMin: body.priceMin,
        priceMax: body.priceMax,
      });
      return reply.send({ success: true, data: results });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Macys search failed";
      request.log.error(err, "[RETAIL] macys/search error");
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // ── Macy's: current sales ────────────────────────────
  app.get("/api/retail/macys/sales", async (request, reply) => {
    try {
      const sales = await getMacysSales();
      return reply.send({ success: true, data: sales });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Macys sales lookup failed";
      request.log.error(err, "[RETAIL] macys/sales error");
      return reply.status(500).send({ success: false, error: message });
    }
  });
}
