/**
 * Weather Routes — /weather/*
 *
 * Open-Meteo (free, no API key).
 */

import type { FastifyInstance } from "fastify";
import { getWeather, formatWeatherResult } from "../services/commerce/weather.js";

export async function weatherRoutes(app: FastifyInstance) {
  // GET /weather?city=Miami&days=5
  // GET /weather?latitude=25.76&longitude=-80.19&days=3
  app.get(
    "/weather",
    {},
    async (request, reply) => {
      const query = request.query as {
        city?: string;
        latitude?: string;
        longitude?: string;
        days?: string;
        format?: string;
      };

      if (!query.city && !query.latitude) {
        return reply.status(400).send({
          success: false,
          error: "city or latitude/longitude required",
        });
      }

      const result = await getWeather({
        city: query.city,
        latitude: query.latitude ? parseFloat(query.latitude) : undefined,
        longitude: query.longitude ? parseFloat(query.longitude) : undefined,
        days: query.days ? parseInt(query.days) : 3,
      });

      if (result.error) {
        return reply.status(404).send({ success: false, error: result.error });
      }

      if (query.format === "telegram" && result.data) {
        return {
          success: true,
          formatted: formatWeatherResult(result.data),
          source: result.source,
        };
      }

      return { success: true, data: result };
    }
  );
}
