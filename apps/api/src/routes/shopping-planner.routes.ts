/**
 * Shopping Planner Routes — Generate and manage shopping plans.
 */

import { FastifyInstance } from "fastify";
import {
  generateShoppingPlan,
  formatShoppingPlan,
  getUserLists,
  getList,
  updateListStatus,
  approveList,
  executeList,
} from "../services/shopping/shopping-planner.service.js";

export async function shoppingPlannerRoutes(app: FastifyInstance) {
  // Generate a new shopping plan
  app.post("/api/shopping/plan", async (req, reply) => {
    try {
      const { userId, theme, location, budget, preferences, userName, lang } = req.body as any;
      if (!userId || !theme || !location) {
        return reply.code(400).send({ success: false, error: "userId, theme, and location are required" });
      }

      const plan = await generateShoppingPlan(userId, theme, location, budget, preferences);
      if ("error" in plan) {
        return reply.send({ success: false, error: plan.error });
      }

      const formatted = formatShoppingPlan(plan, userName || "Customer", lang || "en");

      return reply.send({
        success: true,
        data: {
          plan,
          formatted,
        },
      });
    } catch (err) {
      console.error("[SHOPPING-PLANNER] Route error:", err);
      return reply.code(500).send({ success: false, error: "Internal server error" });
    }
  });

  // Get user's shopping lists
  app.get("/api/shopping/lists/:userId", async (req, reply) => {
    const { userId } = req.params as any;
    try {
      const lists = await getUserLists(userId);
      return reply.send({ success: true, data: lists });
    } catch (err) {
      return reply.code(500).send({ success: false, error: "Failed to get lists" });
    }
  });

  // Get single list detail
  app.get("/api/shopping/lists/detail/:id", async (req, reply) => {
    const { id } = req.params as any;
    try {
      const list = await getList(id);
      if (!list) return reply.code(404).send({ success: false, error: "List not found" });
      return reply.send({ success: true, data: list });
    } catch (err) {
      return reply.code(500).send({ success: false, error: "Failed to get list" });
    }
  });

  // Update list status
  app.patch("/api/shopping/lists/:id/status", async (req, reply) => {
    const { id } = req.params as any;
    const { status } = req.body as any;
    try {
      const list = await updateListStatus(id, status);
      return reply.send({ success: true, data: list });
    } catch (err) {
      return reply.code(500).send({ success: false, error: "Failed to update list" });
    }
  });

  // Approve (or partially approve / reject) a shopping list
  app.post("/api/shopping/lists/:id/approve", async (req, reply) => {
    const { id } = req.params as any;
    const { userId, action, approvedItemIds, rejectedItemIds, swapRequests } = req.body as any;
    if (!userId || !action) {
      return reply.code(400).send({ success: false, error: "userId and action are required" });
    }
    try {
      const result = await approveList(id, userId, action, { approvedItemIds, rejectedItemIds, swapRequests });
      return reply.send({ success: true, data: result });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "LIST_NOT_FOUND") return reply.code(404).send({ success: false, error: "List not found" });
      if (msg === "USER_MISMATCH") return reply.code(403).send({ success: false, error: "User does not own this list" });
      console.error("[SHOPPING-APPROVE] Error:", msg);
      return reply.code(500).send({ success: false, error: "Failed to process approval" });
    }
  });

  // Execute a purchase from an approved shopping list (stub)
  app.post("/api/shopping/lists/:id/execute", async (req, reply) => {
    const { id } = req.params as any;
    const { userId } = req.body as any;
    if (!userId) {
      return reply.code(400).send({ success: false, error: "userId is required" });
    }
    try {
      const result = await executeList(id, userId);
      return reply.send({ success: true, data: result });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "LIST_NOT_FOUND") return reply.code(404).send({ success: false, error: "List not found" });
      if (msg === "NOT_APPROVED") return reply.code(400).send({ success: false, error: "List must be approved before execution" });
      if (msg === "USER_MISMATCH") return reply.code(403).send({ success: false, error: "User does not own this list" });
      console.error("[SHOPPING-EXECUTE] Error:", msg);
      return reply.code(500).send({ success: false, error: "Failed to execute purchase" });
    }
  });
}
