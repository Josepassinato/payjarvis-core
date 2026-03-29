/**
 * Inner Circle Routes — specialist detection, consultation, tracking.
 * Auth: x-internal-secret (called by bots).
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import {
  detectNeed,
  generateIntroduction,
  provideFreeConsultation,
  logIntroShown,
  logDeclined,
  logPremiumReferral,
  getInnerCircleStats,
  listSpecialists,
} from "../services/inner-circle/inner-circle.service.js";

export async function innerCircleRoutes(app: FastifyInstance) {

  function checkInternal(req: any, reply: any): boolean {
    if (req.headers["x-internal-secret"] !== process.env.INTERNAL_SECRET) {
      reply.status(403).send({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  async function resolveUserId(rawId: string): Promise<string | null> {
    if (rawId.startsWith("c") && rawId.length > 20) return rawId;
    const user = await prisma.user.findFirst({
      where: { OR: [{ telegramChatId: rawId }, { phone: rawId.replace("whatsapp:", "") }, { id: rawId }] },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  // POST /api/inner-circle/detect — Check if user needs a specialist
  app.post("/api/inner-circle/detect", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, message, recentMessages, userFacts } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (!userId) return { match: null };

    const match = await detectNeed(userId, message, recentMessages || [], userFacts || {});
    if (!match) return { match: null };

    return {
      match: {
        specialistId: match.specialist.id,
        name: match.specialist.name,
        expertise: match.specialist.expertise,
        confidence: match.confidence,
      },
    };
  });

  // POST /api/inner-circle/introduce — Generate introduction message
  app.post("/api/inner-circle/introduce", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, specialistId, userName, message, language } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const specialist = await prisma.innerCircleSpecialist.findUnique({ where: { id: specialistId } });
    if (!specialist) return reply.status(404).send({ error: "Specialist not found" });

    const intro = await generateIntroduction(
      { ...specialist, freeServices: JSON.parse(specialist.freeServices), premiumServices: JSON.parse(specialist.premiumServices) },
      { userName: userName || "amigo", message: message || "", language: language || "pt" }
    );

    await logIntroShown(userId, specialistId, message || "");
    return { success: true, introduction: intro };
  });

  // POST /api/inner-circle/consult — Free AI consultation
  app.post("/api/inner-circle/consult", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, specialistId, message, image } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (!userId) return reply.status(404).send({ error: "User not found" });

    const consultation = await provideFreeConsultation(userId, specialistId, message, image);
    return { success: true, consultation };
  });

  // POST /api/inner-circle/declined
  app.post("/api/inner-circle/declined", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, specialistId } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (userId) await logDeclined(userId, specialistId);
    return { ok: true };
  });

  // POST /api/inner-circle/referral
  app.post("/api/inner-circle/referral", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    const { userId: rawId, specialistId } = req.body as any;
    const userId = await resolveUserId(rawId);
    if (userId) await logPremiumReferral(userId, specialistId);
    return { ok: true };
  });

  // GET /api/inner-circle/stats
  app.get("/api/inner-circle/stats", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    return getInnerCircleStats();
  });

  // GET /api/inner-circle/specialists
  app.get("/api/inner-circle/specialists", async (req: any, reply) => {
    if (!checkInternal(req, reply)) return;
    return listSpecialists();
  });
}
