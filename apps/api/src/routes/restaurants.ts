/**
 * Restaurant Routes — /restaurants/*
 *
 * Direct restaurant endpoints (Yelp + OpenTable).
 * Supports bot auth.
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import {
  searchRestaurants,
  getRestaurantDetails,
  getReservationLink,
  formatRestaurantResults,
  formatRestaurantDetail,
} from "../services/commerce/restaurants.js";

export async function restaurantRoutes(app: FastifyInstance) {
  // GET /restaurants/search?location=Miami&term=sushi&price=2,3&sort_by=rating&limit=10&open_now=true
  app.get(
    "/restaurants/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const query = request.query as {
        location?: string;
        term?: string;
        price?: string;
        sort_by?: string;
        limit?: string;
        open_now?: string;
        radius?: string;
        format?: string; // "telegram" for formatted text
      };

      if (!query.location) {
        return reply.status(400).send({
          success: false,
          error: "location is required",
        });
      }

      const result = await searchRestaurants({
        location: query.location,
        term: query.term,
        price: query.price,
        sort_by: query.sort_by,
        limit: query.limit ? parseInt(query.limit) : 10,
        open_now: query.open_now === "true",
        radius: query.radius ? parseInt(query.radius) : undefined,
      });

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatRestaurantResults(result.results),
          resultCount: result.results.length,
          mock: result.mock,
        };
      }

      return { success: true, data: result };
    }
  );

  // GET /restaurants/:id — details + reviews
  app.get(
    "/restaurants/:id",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.status(400).send({
          success: false,
          error: "restaurant id is required",
        });
      }

      const result = await getRestaurantDetails(id);

      return {
        success: !result.error,
        data: result,
        formatted: result.detail ? formatRestaurantDetail(result.detail) : null,
      };
    }
  );

  // GET /restaurants/:id/reserve?covers=2&date=2026-12-20&time=19:00
  app.get(
    "/restaurants/:id/reserve",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as {
        covers?: string;
        date?: string;
        time?: string;
      };

      const covers = query.covers ? parseInt(query.covers) : 2;
      const dateTime = query.date && query.time
        ? `${query.date}T${query.time}`
        : undefined;

      // First get restaurant details to build the link
      const result = await getRestaurantDetails(id);
      if (result.error || !result.detail) {
        return reply.status(404).send({
          success: false,
          error: result.error || "Restaurant not found",
        });
      }

      const reservationUrl = getReservationLink(result.detail, covers, dateTime);

      return {
        success: true,
        restaurant: result.detail.name,
        reservationUrl,
        note: reservationUrl
          ? "Abra este link para completar a reserva no OpenTable"
          : "Este restaurante não tem reserva online disponível",
      };
    }
  );
}
