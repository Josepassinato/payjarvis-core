/**
 * Product Routes — /products/*
 *
 * Unified product search across Mercado Libre and eBay.
 * Source param determines which API to use.
 */

import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import { searchMeliProducts, getMeliProduct, formatMeliResults } from "../services/commerce/mercadolibre.js";
import { searchEbayProducts, getEbayProduct, formatEbayResults } from "../services/commerce/ebay.js";

export async function productRoutes(app: FastifyInstance) {
  // GET /products/search?query=iphone+15&source=mercadolibre&site=MLB&maxPrice=5000&sort=price_asc
  // GET /products/search?query=iphone+15&source=ebay&maxPrice=800&condition=NEW
  app.get(
    "/products/search",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const query = request.query as {
        query?: string;
        source?: string;      // "mercadolibre" | "ebay"
        site?: string;        // MLB, MLA, etc. (MeLi only)
        country?: string;     // "brasil", "argentina" (MeLi only)
        maxPrice?: string;
        sort?: string;
        condition?: string;   // "NEW", "USED" (eBay only)
        limit?: string;
        format?: string;
      };

      if (!query.query) {
        return reply.status(400).send({
          success: false,
          error: "query is required",
        });
      }

      const source = query.source?.toLowerCase() || "mercadolibre";

      if (source === "ebay") {
        const result = await searchEbayProducts({
          query: query.query,
          priceMax: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
          sort: query.sort,
          condition: query.condition,
          limit: query.limit ? parseInt(query.limit) : 10,
        });

        if (query.format === "telegram") {
          return {
            success: true,
            formatted: formatEbayResults(result.results),
            resultCount: result.results.length,
            mock: result.mock,
          };
        }

        return { success: true, data: result };
      }

      // Default: Mercado Libre
      const result = await searchMeliProducts({
        query: query.query,
        siteId: query.site,
        country: query.country,
        priceMax: query.maxPrice ? parseFloat(query.maxPrice) : undefined,
        sort: query.sort,
        limit: query.limit ? parseInt(query.limit) : 10,
      });

      if (query.format === "telegram") {
        return {
          success: true,
          formatted: formatMeliResults(result.results),
          resultCount: result.results.length,
          mock: result.mock,
        };
      }

      return { success: true, data: result };
    }
  );

  // GET /products/:source/:id — product details
  app.get(
    "/products/:source/:id",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const { source, id } = request.params as { source: string; id: string };

      if (source === "ebay") {
        const result = await getEbayProduct(id);
        return { success: !result.error, data: result };
      }

      if (source === "mercadolibre") {
        const result = await getMeliProduct(id);
        return { success: !result.error, data: result };
      }

      return reply.status(400).send({
        success: false,
        error: "source must be 'mercadolibre' or 'ebay'",
      });
    }
  );
}
