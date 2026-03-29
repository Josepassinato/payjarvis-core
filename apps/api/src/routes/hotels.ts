/**
 * Hotel Routes — /hotels/*
 *
 * Direct hotel endpoints (alternative to /api/commerce/hotels/search).
 * Supports both bot auth and user auth.
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { searchHotels, getHotelOffer, formatHotelResults, resolveCityCode } from "../services/commerce/hotels.js";

export async function hotelRoutes(app: FastifyInstance) {
  // GET /hotels/search?city=miami&checkIn=2026-12-20&checkOut=2026-12-23&adults=2&maxPrice=200
  app.get(
    "/hotels/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const query = request.query as {
        city?: string;
        checkIn?: string;
        checkOut?: string;
        adults?: string;
        maxPrice?: string;
        ratings?: string;
        currency?: string;
        radius?: string;
        format?: string; // "telegram" for formatted text
      };

      if (!query.city || !query.checkIn || !query.checkOut) {
        return reply.status(400).send({
          success: false,
          error: "city, checkIn, and checkOut are required query parameters",
        });
      }

      const result = await searchHotels({
        city: query.city,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        adults: query.adults ? parseInt(query.adults) : 1,
        maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
        ratings: query.ratings ? query.ratings.split(",") : undefined,
        currency: query.currency,
        radius: query.radius ? parseInt(query.radius) : undefined,
      });

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatHotelResults(result.results, query.city),
          resultCount: result.results.length,
          mock: result.mock,
        };
      }

      return {
        success: true,
        data: result,
      };
    }
  );

  // GET /hotels/offer/:offerId — confirm offer details and price
  app.get(
    "/hotels/offer/:offerId",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const { offerId } = request.params as { offerId: string };

      if (!offerId) {
        return reply.status(400).send({
          success: false,
          error: "offerId is required",
        });
      }

      const result = await getHotelOffer(offerId);
      return {
        success: !result.error,
        data: result,
      };
    }
  );

  // GET /hotels/city-code/:city — resolve city name to IATA code
  app.get(
    "/hotels/city-code/:city",
    { preHandler: [requireBotAuth] },
    async (request) => {
      const { city } = request.params as { city: string };
      const code = await resolveCityCode(city);
      return { success: true, city, code };
    }
  );

  // POST /hotels/book — stub for future booking
  app.post(
    "/hotels/book",
    { preHandler: [requireBotAuth] },
    async (_request, reply) => {
      return reply.status(501).send({
        success: false,
        message: "Booking endpoint coming soon — pending Amadeus Enterprise API approval",
      });
    }
  );
}
