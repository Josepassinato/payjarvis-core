/**
 * Event Routes — /events/*
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { searchEvents, getEventDetails, formatEventResults } from "../services/commerce/events.js";

export async function eventRoutes(app: FastifyInstance) {
  // GET /events/search?keyword=concert&city=Miami&startDate=2026-12-01&endDate=2026-12-31&category=music
  app.get(
    "/events/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const query = request.query as {
        city?: string;
        keyword?: string;
        startDate?: string;
        endDate?: string;
        category?: string;
        format?: string;
      };

      if (!query.city) {
        return reply.status(400).send({
          success: false,
          error: "city is required",
        });
      }

      const result = await searchEvents({
        city: query.city,
        keyword: query.keyword,
        startDate: query.startDate,
        endDate: query.endDate,
        category: query.category,
      });

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatEventResults(result.results),
          resultCount: result.results.length,
          mock: result.mock,
        };
      }

      return { success: true, data: result };
    }
  );

  // GET /events/:id
  app.get(
    "/events/:id",
    { preHandler: [requireBotAuth] },
    async (request) => {
      const { id } = request.params as { id: string };
      const result = await getEventDetails(id);
      return { success: !result.error, data: result };
    }
  );
}
