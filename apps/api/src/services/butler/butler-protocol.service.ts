/**
 * Butler Protocol 🎩 — Personal data vault + account management.
 *
 * All PII is encrypted at rest using AES-256-CBC (same key as ZK vault).
 * The Butler can store profile data, create accounts, and manage credentials.
 */

import crypto from "crypto";
import { prisma } from "@payjarvis/database";
import { encryptPII, decryptPII } from "../vault/crypto.js";

// ─── Types ───

export interface ButlerProfileData {
  fullName?: string;
  email?: string;
  address?: string | { street: string; city: string; state: string; zip: string; country: string };
  phone?: string;
  dateOfBirth?: string;
  ssn?: string;
}

export interface ButlerCredentialData {
  serviceName: string;
  serviceUrl: string;
  login: string;
  password: string;
  notes?: string;
}

// ─── Profile Management ───

export async function setupButlerProfile(userId: string, data: ButlerProfileData) {
  const addressStr = typeof data.address === "object" ? JSON.stringify(data.address) : data.address;

  const profile = await prisma.butlerProfile.upsert({
    where: { userId },
    create: {
      userId,
      fullName: data.fullName ? encryptPII(data.fullName) : null,
      email: data.email ? encryptPII(data.email) : null,
      address: addressStr ? encryptPII(addressStr) : null,
      phone: data.phone ? encryptPII(data.phone) : null,
      dateOfBirth: data.dateOfBirth ? encryptPII(data.dateOfBirth) : null,
      ssn: data.ssn ? encryptPII(data.ssn) : null,
    },
    update: {
      ...(data.fullName !== undefined && { fullName: data.fullName ? encryptPII(data.fullName) : null }),
      ...(data.email !== undefined && { email: data.email ? encryptPII(data.email) : null }),
      ...(addressStr !== undefined && { address: addressStr ? encryptPII(addressStr) : null }),
      ...(data.phone !== undefined && { phone: data.phone ? encryptPII(data.phone) : null }),
      ...(data.dateOfBirth !== undefined && { dateOfBirth: data.dateOfBirth ? encryptPII(data.dateOfBirth) : null }),
      ...(data.ssn !== undefined && { ssn: data.ssn ? encryptPII(data.ssn) : null }),
    },
  });

  await logButlerAction(userId, "setup_profile", null, "success", {
    fields: Object.keys(data).filter(k => (data as any)[k]),
  });

  return profile;
}

export async function getButlerProfile(userId: string): Promise<ButlerProfileData & { active: boolean } | null> {
  const profile = await prisma.butlerProfile.findUnique({ where: { userId } });
  if (!profile) return null;

  let address: string | { street: string; city: string; state: string; zip: string; country: string } | undefined;
  if (profile.address) {
    const decAddr = decryptPII(profile.address);
    try { address = JSON.parse(decAddr); } catch { address = decAddr; }
  }

  return {
    active: profile.active,
    fullName: profile.fullName ? decryptPII(profile.fullName) : undefined,
    email: profile.email ? decryptPII(profile.email) : undefined,
    address,
    phone: profile.phone ? decryptPII(profile.phone) : undefined,
    dateOfBirth: profile.dateOfBirth ? decryptPII(profile.dateOfBirth) : undefined,
    ssn: profile.ssn ? decryptPII(profile.ssn) : undefined,
  };
}

export async function updateButlerProfile(userId: string, data: Partial<ButlerProfileData>) {
  const existing = await prisma.butlerProfile.findUnique({ where: { userId } });
  if (!existing) throw new Error("Butler Profile not found. Setup first.");

  const addressStr = typeof data.address === "object" ? JSON.stringify(data.address) : data.address;
  const updates: Record<string, any> = {};

  if (data.fullName !== undefined) updates.fullName = data.fullName ? encryptPII(data.fullName) : null;
  if (data.email !== undefined) updates.email = data.email ? encryptPII(data.email) : null;
  if (addressStr !== undefined) updates.address = addressStr ? encryptPII(addressStr) : null;
  if (data.phone !== undefined) updates.phone = data.phone ? encryptPII(data.phone) : null;
  if (data.dateOfBirth !== undefined) updates.dateOfBirth = data.dateOfBirth ? encryptPII(data.dateOfBirth) : null;
  if (data.ssn !== undefined) updates.ssn = data.ssn ? encryptPII(data.ssn) : null;

  await prisma.butlerProfile.update({ where: { userId }, data: updates });

  await logButlerAction(userId, "update_profile", null, "success", {
    fields: Object.keys(data).filter(k => (data as any)[k]),
  });
}

// ─── Credential Management ───

export function generateSecurePassword(length = 16): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const symbols = "!@#$%^&*_-+=";
  const all = upper + lower + digits + symbols;

  // Guarantee at least one of each
  let password = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];

  for (let i = password.length; i < length; i++) {
    password.push(all[crypto.randomInt(all.length)]);
  }

  // Shuffle
  for (let i = password.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }

  return password.join("");
}

export async function saveCredential(userId: string, data: ButlerCredentialData) {
  // Ensure profile exists
  const profile = await prisma.butlerProfile.findUnique({ where: { userId } });
  if (!profile) throw new Error("Butler Profile required before saving credentials");

  await prisma.butlerCredential.upsert({
    where: { userId_serviceName: { userId, serviceName: data.serviceName } },
    create: {
      userId,
      serviceName: data.serviceName,
      serviceUrl: data.serviceUrl,
      login: encryptPII(data.login),
      encryptedPassword: encryptPII(data.password),
      notes: data.notes,
    },
    update: {
      serviceUrl: data.serviceUrl,
      login: encryptPII(data.login),
      encryptedPassword: encryptPII(data.password),
      notes: data.notes,
      lastUsed: new Date(),
    },
  });

  await logButlerAction(userId, "save_credential", data.serviceName, "success");
}

export async function getCredential(userId: string, serviceName: string) {
  const cred = await prisma.butlerCredential.findUnique({
    where: { userId_serviceName: { userId, serviceName } },
  });
  if (!cred) return null;

  // Update lastUsed
  await prisma.butlerCredential.update({
    where: { id: cred.id },
    data: { lastUsed: new Date() },
  }).catch(() => {});

  return {
    serviceName: cred.serviceName,
    serviceUrl: cred.serviceUrl,
    login: decryptPII(cred.login),
    password: decryptPII(cred.encryptedPassword),
    notes: cred.notes,
    lastUsed: cred.lastUsed,
  };
}

export async function listCredentials(userId: string) {
  const creds = await prisma.butlerCredential.findMany({
    where: { userId },
    select: { serviceName: true, serviceUrl: true, login: true, lastUsed: true, createdAt: true },
    orderBy: { lastUsed: "desc" },
  });

  return creds.map(c => ({
    serviceName: c.serviceName,
    serviceUrl: c.serviceUrl,
    login: decryptPII(c.login),
    lastUsed: c.lastUsed,
    createdAt: c.createdAt,
  }));
}

// ─── Audit Log ───

export async function logButlerAction(
  userId: string,
  action: string,
  service: string | null,
  status: string,
  details?: Record<string, any>
) {
  await prisma.butlerAuditLog.create({
    data: {
      userId,
      action,
      service: service || undefined,
      status,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}

export async function getButlerAuditLog(userId: string, limit = 20) {
  return prisma.butlerAuditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

// ─── Status ───

export async function getButlerStatus() {
  const totalProfiles = await prisma.butlerProfile.count({ where: { active: true } });
  const totalCredentials = await prisma.butlerCredential.count();
  const recentActions = await prisma.butlerAuditLog.count({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
  });

  return { totalProfiles, totalCredentials, recentActions };
}
