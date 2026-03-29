/**
 * Commerce Routes — /api/commerce/*
 *
 * All commerce search endpoints. Requires bot auth (X-Bot-Api-Key).
 * Each endpoint validates params, calls the central commerce router,
 * and returns standardized results.
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { commerceSearch } from "../services/commerce/index.js";

export async function commerceRoutes(app: FastifyInstance) {
  // ─── Flights ────────────────────────────────────────
  app.post(
    "/api/commerce/flights/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const body = request.body as {
        origin?: string;
        destination?: string;
        departureDate?: string;
        returnDate?: string;
        passengers?: number;
        cabin?: string;
      };

      if (!body.origin || !body.destination || !body.departureDate) {
        return reply.status(400).send({
          success: false,
          error: "origin, destination, and departureDate are required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "flights",
        params: {
          origin: body.origin.toUpperCase(),
          destination: body.destination.toUpperCase(),
          departureDate: body.departureDate,
          returnDate: body.returnDate,
          passengers: body.passengers ?? 1,
          cabin: body.cabin,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );

  // ─── Hotels ─────────────────────────────────────────
  app.post(
    "/api/commerce/hotels/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const body = request.body as {
        city?: string;
        checkIn?: string;
        checkOut?: string;
        adults?: number;
        maxPrice?: number;
        ratings?: string;
        currency?: string;
        radius?: number;
        latitude?: number;
        longitude?: number;
      };

      if (!body.checkIn || !body.checkOut) {
        return reply.status(400).send({
          success: false,
          error: "checkIn and checkOut are required",
        });
      }

      if (!body.city && !(body.latitude && body.longitude)) {
        return reply.status(400).send({
          success: false,
          error: "city or latitude/longitude is required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "hotels",
        params: {
          city: body.city,
          checkIn: body.checkIn,
          checkOut: body.checkOut,
          adults: body.adults ?? 1,
          maxPrice: body.maxPrice,
          ratings: body.ratings ? body.ratings.split(",") : undefined,
          currency: body.currency,
          radius: body.radius,
          latitude: body.latitude,
          longitude: body.longitude,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );

  // ─── Restaurants ────────────────────────────────────
  app.post(
    "/api/commerce/restaurants/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const body = request.body as {
        location?: string;
        term?: string;
        cuisine?: string;
        price?: string;
        priceRange?: string;
        sort_by?: string;
        limit?: number;
        open_now?: boolean;
        radius?: number;
        date?: string;
        time?: string;
        covers?: number;
        latitude?: number;
        longitude?: number;
      };

      if (!body.location && !(body.latitude && body.longitude)) {
        return reply.status(400).send({
          success: false,
          error: "location or latitude/longitude is required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "restaurants",
        params: {
          location: body.location,
          term: body.term,
          cuisine: body.cuisine,
          price: body.price || body.priceRange,
          sort_by: body.sort_by,
          limit: body.limit,
          open_now: body.open_now,
          radius: body.radius,
          date: body.date,
          time: body.time,
          covers: body.covers ?? 2,
          latitude: body.latitude,
          longitude: body.longitude,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );

  // ─── Events ─────────────────────────────────────────
  app.post(
    "/api/commerce/events/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const body = request.body as {
        city?: string;
        category?: string;
        keyword?: string;
        startDate?: string;
        endDate?: string;
        latitude?: number;
        longitude?: number;
      };

      if (!body.city && !(body.latitude && body.longitude)) {
        return reply.status(400).send({
          success: false,
          error: "city or latitude/longitude is required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "events",
        params: {
          city: body.city,
          category: body.category,
          keyword: body.keyword,
          startDate: body.startDate,
          endDate: body.endDate,
          latitude: body.latitude,
          longitude: body.longitude,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );

  // ─── Transport ──────────────────────────────────────
  app.post(
    "/api/commerce/transport/request",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const userId = (request as any).userId as string;
      const body = request.body as {
        pickup?: string;
        destination?: string;
      };

      if (!body.pickup || !body.destination) {
        return reply.status(400).send({
          success: false,
          error: "pickup and destination are required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "transport",
        params: {
          pickup: body.pickup,
          destination: body.destination,
          userId,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );

  // ─── Delivery ───────────────────────────────────────
  app.post(
    "/api/commerce/delivery/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const botId = (request as any).botId as string;
      const body = request.body as {
        location?: string;
        cuisine?: string;
        maxPrice?: number;
      };

      if (!body.location) {
        return reply.status(400).send({
          success: false,
          error: "location is required",
        });
      }

      const result = await commerceSearch({
        botId,
        service: "delivery",
        params: {
          location: body.location,
          cuisine: body.cuisine,
          maxPrice: body.maxPrice,
        },
      });

      if (result.rateLimited) return reply.status(429).send(result);
      return result;
    }
  );
}
