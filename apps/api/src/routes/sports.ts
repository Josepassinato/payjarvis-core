/**
 * Sports Routes — /sports/*
 *
 * ESPN Public API (free, no API key).
 */

import type { FastifyInstance } from "fastify";
import { getScores, getStandings, formatScoresResult } from "../services/commerce/sports.js";

export async function sportsRoutes(app: FastifyInstance) {
  // GET /sports/scores?league=nfl&team=dolphins
  app.get(
    "/sports/scores",
    {},
    async (request, reply) => {
      const query = request.query as {
        sport?: string;
        league?: string;
        team?: string;
        limit?: string;
        format?: string;
      };

      const result = await getScores({
        sport: query.sport,
        league: query.league,
        team: query.team,
        limit: query.limit ? parseInt(query.limit) : undefined,
      });

      if (result.error) {
        return { success: false, error: result.error };
      }

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatScoresResult(result.results, result.league),
          resultCount: result.results.length,
        };
      }

      return { success: true, data: result };
    }
  );

  // GET /sports/standings?league=nba
  app.get(
    "/sports/standings",
    {},
    async (request, reply) => {
      const query = request.query as {
        sport?: string;
        league?: string;
      };

      const result = await getStandings({
        sport: query.sport,
        league: query.league,
      });

      if (result.error) {
        return { success: false, error: result.error };
      }

      return { success: true, data: result };
    }
  );
}
