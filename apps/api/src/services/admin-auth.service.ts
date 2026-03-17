/**
 * Admin Auth Service — login, token verification, logout for admin dashboard.
 * Completely separate from Clerk/user auth.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyRequest, FastifyReply } from "fastify";

const prisma = new PrismaClient();

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || "dev-admin-secret-change-me";
const ADMIN_JWT_EXPIRES_IN = process.env.ADMIN_JWT_EXPIRES_IN || "8h";

function parseExpiry(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)(h|d|m)$/);
  if (!match) return 8 * 60 * 60 * 1000; // default 8h
  const val = parseInt(match[1]);
  const unit = match[2];
  if (unit === "h") return val * 60 * 60 * 1000;
  if (unit === "d") return val * 24 * 60 * 60 * 1000;
  if (unit === "m") return val * 60 * 1000;
  return 8 * 60 * 60 * 1000;
}

export async function login(email: string, password: string) {
  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new Error("Invalid credentials");

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) throw new Error("Invalid credentials");

  const expiresInSeconds = Math.floor(parseExpiry(ADMIN_JWT_EXPIRES_IN) / 1000);
  const token = jwt.sign(
    { adminId: admin.id, email: admin.email, role: admin.role },
    ADMIN_JWT_SECRET,
    { expiresIn: expiresInSeconds }
  );

  const expiresAt = new Date(Date.now() + parseExpiry(ADMIN_JWT_EXPIRES_IN));

  await prisma.adminSession.create({
    data: { adminId: admin.id, token, expiresAt },
  });

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  });

  const { passwordHash: _, ...safeAdmin } = admin;
  return { token, admin: safeAdmin };
}

export async function verifyToken(token: string) {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: string };

    const session = await prisma.adminSession.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      throw new Error("Session expired");
    }

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.adminId } });
    if (!admin) throw new Error("Admin not found");

    const { passwordHash: _, ...safeAdmin } = admin;
    return safeAdmin;
  } catch {
    throw new Error("Invalid token");
  }
}

export async function logout(token: string) {
  await prisma.adminSession.deleteMany({ where: { token } });
}

/** Fastify preHandler hook for admin routes */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({ success: false, error: "No token provided" });
  }

  const token = authHeader.slice(7);
  try {
    const admin = await verifyToken(token);
    (request as any).admin = admin;
    (request as any).adminToken = token;
  } catch {
    return reply.status(401).send({ success: false, error: "Invalid or expired token" });
  }
}
