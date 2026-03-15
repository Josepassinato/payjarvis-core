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

export async function retailRoutes(app: FastifyInstance) {
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
