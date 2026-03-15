/**
 * Vault Service — CRUD for encrypted user sessions
 */

import { prisma } from "@payjarvis/database";
import { encryptCookies, decryptCookies } from "./crypto.js";

const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL ?? "http://localhost:3003";

export interface SaveSessionParams {
  userId: string;
  provider: string;
  cookies: object;
  userAgent: string;
  expiresAt?: Date;
}

export interface SessionData {
  cookies: object;
  userAgent: string;
  isValid: boolean;
  lastVerified: Date;
  expiresAt: Date | null;
}

export async function saveSession(params: SaveSessionParams) {
  const { userId, provider, cookies, userAgent, expiresAt } = params;
  const cookiesEnc = encryptCookies(cookies);

  const result = await prisma.userAccountVault.upsert({
    where: { userId_provider: { userId, provider } },
    update: {
      cookiesEnc,
      userAgent,
      isValid: true,
      lastVerified: new Date(),
      expiresAt: expiresAt ?? null,
    },
    create: {
      userId,
      provider,
      cookiesEnc,
      userAgent,
      isValid: true,
      expiresAt: expiresAt ?? null,
    },
  });

  return { id: result.id, provider: result.provider, savedAt: result.updatedAt };
}

export async function getSession(
  userId: string,
  provider: string
): Promise<SessionData | null> {
  const vault = await prisma.userAccountVault.findUnique({
    where: { userId_provider: { userId, provider } },
  });

  if (!vault) return null;

  const cookies = decryptCookies(vault.cookiesEnc);
  return {
    cookies,
    userAgent: vault.userAgent,
    isValid: vault.isValid,
    lastVerified: vault.lastVerified,
    expiresAt: vault.expiresAt,
  };
}

export async function invalidateSession(userId: string, provider: string) {
  await prisma.userAccountVault.updateMany({
    where: { userId, provider },
    data: { isValid: false },
  });
  return { success: true };
}

export async function deleteSession(userId: string, provider: string) {
  await prisma.userAccountVault.deleteMany({
    where: { userId, provider },
  });
  return { success: true };
}

export async function listSessions(userId: string) {
  const sessions = await prisma.userAccountVault.findMany({
    where: { userId },
    select: {
      provider: true,
      isValid: true,
      lastVerified: true,
      expiresAt: true,
    },
  });
  return sessions;
}

export async function verifySession(
  userId: string,
  provider: string
): Promise<{ valid: boolean; error?: string }> {
  const session = await getSession(userId, provider);
  if (!session) return { valid: false, error: "No session found" };

  if (provider !== "amazon") {
    return { valid: session.isValid };
  }

  // For Amazon: test session by loading account page via browser-agent
  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: "https://www.amazon.com/gp/css/homepage.html",
        injectCookies: session.cookies,
        userAgent: session.userAgent,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await res.json()) as {
      success: boolean;
      content?: string;
      obstacle?: { type: string };
    };

    if (!data.success || data.obstacle) {
      await prisma.userAccountVault.updateMany({
        where: { userId, provider },
        data: { isValid: false, lastVerified: new Date() },
      });
      return { valid: false, error: "Session expired or blocked" };
    }

    // Check if user is logged in (look for "Hello, " or "Your Account")
    const content = data.content ?? "";
    const isLoggedIn =
      content.includes("Hello,") ||
      content.includes("Your Account") ||
      content.includes("Your Orders");

    await prisma.userAccountVault.updateMany({
      where: { userId, provider },
      data: { isValid: isLoggedIn, lastVerified: new Date() },
    });

    return { valid: isLoggedIn, error: isLoggedIn ? undefined : "Not logged in" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Verification failed";
    return { valid: false, error: message };
  }
}
