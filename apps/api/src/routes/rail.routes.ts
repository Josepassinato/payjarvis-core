/**
 * POST /api/rail/select — pure rail selection over given context.
 * GET  /api/rail/registry — list known merchants + their caps.
 *
 * Bots call select after approval to learn which rail to use at checkout.
 * No DB writes — pure decision.
 */
import type { FastifyInstance } from "fastify";
import { requireBotAuth } from "../middleware/bot-auth.js";
import {
  selectRail,
  lookupMerchant,
  type RailContext,
} from "../services/payments/rail-selector.js";

export async function railRoutes(app: FastifyInstance) {
  app.post(
    "/api/rail/select",
    { preHandler: [requireBotAuth] },
    async (request, reply) => {
      const body = request.body as Partial<RailContext>;
      if (typeof body?.amount !== "number" || !body?.currency) {
        return reply
          .status(400)
          .send({ success: false, error: "amount (number) and currency required" });
      }
      const decision = selectRail(body as RailContext);
      const { key } = lookupMerchant(body);
      return {
        success: true,
        data: {
          merchant_key_matched: key,
          ...decision,
        },
      };
    },
  );

  app.get(
    "/api/rail/registry",
    { preHandler: [requireBotAuth] },
    async (_request, _reply) => {
      // Re-import to read the module's MERCHANT_REGISTRY via a known key probe.
      // Simpler: expose via a named export if needed. For now, return a curated list.
      const sample = ["magalu","mercadolivre","amazon_br","kabum","amazon","aliexpress","apple","ebay"];
      const entries = sample.map((k) => ({
        key: k,
        decision_brl_100: selectRail({ merchantId: k, amount: 100, currency: "BRL" }),
        decision_usd_20: selectRail({ merchantId: k, amount: 20, currency: "USD" }),
      }));
      return { success: true, data: { sample: entries } };
    },
  );
}
