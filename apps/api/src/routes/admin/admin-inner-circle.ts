/**
 * Admin Inner Circle Routes — CRUD for specialist partners.
 * Auth: Admin JWT (same as other admin routes).
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";

export async function adminInnerCircleRoutes(app: FastifyInstance) {

  // GET /admin/inner-circle — List all specialists
  app.get("/admin/inner-circle", async () => {
    const specialists = await prisma.innerCircleSpecialist.findMany({
      orderBy: { createdAt: "desc" },
    });
    return specialists.map(s => ({
      ...s,
      freeServices: JSON.parse(s.freeServices),
      premiumServices: JSON.parse(s.premiumServices),
      triggerKeywords: JSON.parse(s.triggerKeywords),
      triggerContexts: JSON.parse(s.triggerContexts),
    }));
  });

  // POST /admin/inner-circle — Create specialist
  app.post("/admin/inner-circle", async (req: any, reply) => {
    const body = req.body as any;
    if (!body.name || !body.slug || !body.expertise) {
      return reply.status(400).send({ error: "name, slug, expertise required" });
    }

    const specialist = await prisma.innerCircleSpecialist.create({
      data: {
        name: body.name,
        slug: body.slug,
        expertise: body.expertise,
        bio: body.bio || "",
        credentials: body.credentials || "",
        instagram: body.instagram,
        website: body.website,
        contactLink: body.contactLink,
        freeServices: JSON.stringify(body.freeServices || []),
        premiumServices: JSON.stringify(body.premiumServices || []),
        triggerKeywords: JSON.stringify(body.triggerKeywords || []),
        triggerContexts: JSON.stringify(body.triggerContexts || []),
        aiKnowledgePrompt: body.aiKnowledgePrompt || "",
        introMessage: body.introMessage || "",
        maxFreePerUser: body.maxFreePerUser || 3,
        revenueSharePct: body.revenueSharePct || 15,
        active: body.active !== false,
      },
    });
    return { success: true, specialist };
  });

  // PUT /admin/inner-circle/:id — Update specialist
  app.put<{ Params: { id: string } }>("/admin/inner-circle/:id", async (req, reply) => {
    const body = req.body as any;
    const updates: Record<string, any> = {};

    const fields = ["name", "slug", "expertise", "bio", "credentials", "instagram",
      "website", "contactLink", "aiKnowledgePrompt", "introMessage",
      "maxFreePerUser", "revenueSharePct", "active"];

    for (const f of fields) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    // JSON fields
    if (body.freeServices) updates.freeServices = JSON.stringify(body.freeServices);
    if (body.premiumServices) updates.premiumServices = JSON.stringify(body.premiumServices);
    if (body.triggerKeywords) updates.triggerKeywords = JSON.stringify(body.triggerKeywords);
    if (body.triggerContexts) updates.triggerContexts = JSON.stringify(body.triggerContexts);

    const specialist = await prisma.innerCircleSpecialist.update({
      where: { id: req.params.id },
      data: updates,
    });
    return { success: true, specialist };
  });

  // DELETE /admin/inner-circle/:id — Deactivate specialist (soft delete)
  app.delete<{ Params: { id: string } }>("/admin/inner-circle/:id", async (req) => {
    await prisma.innerCircleSpecialist.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    return { success: true, message: "Specialist deactivated" };
  });

  // GET /admin/inner-circle/:id/metrics — Specialist metrics
  app.get<{ Params: { id: string } }>("/admin/inner-circle/:id/metrics", async (req) => {
    const id = req.params.id;
    const specialist = await prisma.innerCircleSpecialist.findUnique({ where: { id }, select: { name: true, slug: true } });
    if (!specialist) return { error: "Not found" };

    const [intros, consultations, referrals, declined, conversions] = await Promise.all([
      prisma.innerCircleInteraction.count({ where: { specialistId: id, type: "intro_shown" } }),
      prisma.innerCircleInteraction.count({ where: { specialistId: id, type: "free_consultation" } }),
      prisma.innerCircleInteraction.count({ where: { specialistId: id, type: "premium_referral" } }),
      prisma.innerCircleInteraction.count({ where: { specialistId: id, type: "declined" } }),
      prisma.innerCircleInteraction.count({ where: { specialistId: id, converted: true } }),
    ]);

    const revenueResult = await prisma.innerCircleInteraction.aggregate({
      where: { specialistId: id, converted: true },
      _sum: { revenue: true },
    });

    return {
      specialist: specialist.name,
      intros,
      freeConsultations: consultations,
      premiumReferrals: referrals,
      declined,
      conversions,
      conversionRate: intros > 0 ? Math.round((conversions / intros) * 100) : 0,
      totalRevenue: revenueResult._sum.revenue || 0,
    };
  });

  // GET /admin/inner-circle/interactions — All recent interactions
  app.get("/admin/inner-circle/interactions", async (req: any) => {
    const limit = Math.min(parseInt(req.query?.limit || "50", 10), 200);
    const interactions = await prisma.innerCircleInteraction.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { specialist: { select: { name: true, slug: true } } },
    });
    return interactions;
  });
}
