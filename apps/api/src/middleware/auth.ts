import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@payjarvis/database";
import { createAuditLog } from "../services/audit.js";

const DEV_USER_ID = "dev-user-local";
const DEV_USER_EMAIL = "dev@payjarvis.local";

// KYC-based initial trust scores
const KYC_TRUST_SCORES: Record<number, number> = {
  0: 30,
  1: 50,
  2: 65,
  3: 80,
};

/**
 * Ensure user exists in database. Creates automatically on first login.
 * Returns the internal user ID.
 */
async function ensureUser(clerkId: string, email?: string, fullName?: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { clerkId } });
  if (existing) return existing.id;

  // First login — create user with KYC level 1 (email verified by Clerk)
  const kycLevel = 1;
  const user = await prisma.user.create({
    data: {
      clerkId,
      email: email ?? `${clerkId}@clerk.user`,
      fullName: fullName ?? "PayJarvis User",
      kycLevel: "BASIC", // level 1
      status: "ACTIVE",
    },
  });

  await createAuditLog({
    entityType: "user",
    entityId: user.id,
    action: "user.created",
    actorType: "system",
    actorId: clerkId,
    payload: { clerkId, email, kycLevel },
  });

  return user.id;
}

export function getKycLevel(kycLevel: string): number {
  switch (kycLevel) {
    case "NONE": return 0;
    case "BASIC": return 1;
    case "VERIFIED": return 2;
    case "ENHANCED": return 3;
    default: return 0;
  }
}

export function getInitialTrustScore(kycLevelNum: number): number {
  return KYC_TRUST_SCORES[kycLevelNum] ?? 50;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Dev-mode bypass when no Clerk key is configured
  if (process.env.NODE_ENV !== "production" && (!process.env.CLERK_SECRET_KEY || process.env.CLERK_SECRET_KEY === "sk_test_placeholder")) {
    (request as any).userId = DEV_USER_ID;
    // Auto-create dev user
    await ensureUser(DEV_USER_ID, DEV_USER_EMAIL, "Dev User");
    return;
  }

  try {
    const { verifyToken } = await import("@clerk/fastify");

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ success: false, error: "Missing authorization token" });
    }

    const token = authHeader.slice(7);
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    if (!payload.sub) {
      return reply.status(401).send({ success: false, error: "Invalid token" });
    }

    (request as any).userId = payload.sub;

    // Auto-create user in database on first login
    await ensureUser(
      payload.sub,
      (payload as any).email,
      (payload as any).name
    );
  } catch {
    return reply.status(401).send({ success: false, error: "Authentication failed" });
  }
}
