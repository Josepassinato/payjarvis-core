/**
 * Flight Routes — /flights/*
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { searchFlights, formatFlightResults } from "../services/commerce/flights.js";
import { resolveCityCode } from "../services/commerce/hotels.js";

export async function flightRoutes(app: FastifyInstance) {
  // GET /flights/search?origin=miami&destination=sao+paulo&departure=2026-12-20&return=2026-12-27&adults=2
  app.get(
    "/flights/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const query = request.query as {
        origin?: string;
        destination?: string;
        departure?: string;
        return?: string;
        adults?: string;
        cabin?: string;
        maxPrice?: string;
        format?: string;
      };

      if (!query.origin || !query.destination || !query.departure) {
        return reply.status(400).send({
          success: false,
          error: "origin, destination, and departure are required",
        });
      }

      const result = await searchFlights({
        origin: query.origin,
        destination: query.destination,
        departureDate: query.departure,
        returnDate: query.return,
        passengers: query.adults ? parseInt(query.adults) : 1,
        cabin: query.cabin,
        maxPrice: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
      });

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatFlightResults(result.results, query.origin, query.destination),
          resultCount: result.results.length,
          mock: result.mock,
        };
      }

      return { success: true, data: result };
    }
  );
}
