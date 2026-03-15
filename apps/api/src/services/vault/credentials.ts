/**
 * Store Credentials Service — Save/retrieve/delete store login credentials
 * Uses the existing UserAccountVault with AES-256 encryption from crypto.ts
 */

import { prisma } from "@payjarvis/database";
import { encryptCookies, decryptCookies } from "./crypto.js";

// Normalized store names → provider keys
const STORE_ALIASES: Record<string, string> = {
  "amazon": "amazon",
  "macy's": "macys",
  "macys": "macys",
  "walmart": "walmart",
  "target": "target",
  "best buy": "bestbuy",
  "bestbuy": "bestbuy",
  "ebay": "ebay",
  "costco": "costco",
  "nordstrom": "nordstrom",
  "home depot": "homedepot",
  "homedepot": "homedepot",
  "lowe's": "lowes",
  "lowes": "lowes",
};

/** Normalize a store name to a provider key */
export function normalizeStoreName(storeName: string): { provider: string; displayName: string; known: boolean } {
  const lower = storeName.toLowerCase().trim();
  const provider = STORE_ALIASES[lower];
  if (provider) {
    // Build display name from provider
    const displayNames: Record<string, string> = {
      amazon: "Amazon", macys: "Macy's", walmart: "Walmart",
      target: "Target", bestbuy: "Best Buy", ebay: "eBay",
      costco: "Costco", nordstrom: "Nordstrom",
      homedepot: "Home Depot", lowes: "Lowe's",
    };
    return { provider, displayName: displayNames[provider] || storeName, known: true };
  }
  // Unknown store — save as generic with slugified name
  const slug = lower.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return { provider: `generic_${slug}`, displayName: storeName, known: false };
}

export interface SaveCredentialsParams {
  userId: string;
  provider: string;
  email: string;
  password: string;
  storeName?: string;
}

export async function saveStoreCredentials(params: SaveCredentialsParams) {
  const { userId, provider, email, password, storeName } = params;

  // Encrypt the credentials object (reuse the existing AES-256 encrypt)
  const credentialsEnc = encryptCookies({ email, password, storeName: storeName || provider });

  const result = await prisma.userAccountVault.upsert({
    where: { userId_provider: { userId, provider } },
    update: {
      cookiesEnc: credentialsEnc,
      userAgent: "credentials", // marker to distinguish from cookie sessions
      isValid: true,
      lastVerified: new Date(),
    },
    create: {
      userId,
      provider,
      cookiesEnc: credentialsEnc,
      userAgent: "credentials",
      isValid: true,
    },
  });

  return { id: result.id, provider: result.provider, savedAt: result.updatedAt };
}

export async function getStoreCredentials(
  userId: string,
  provider: string
): Promise<{ email: string; password: string; storeName?: string } | null> {
  const vault = await prisma.userAccountVault.findUnique({
    where: { userId_provider: { userId, provider } },
  });
  if (!vault) return null;

  try {
    const data = decryptCookies(vault.cookiesEnc) as { email: string; password: string; storeName?: string };
    return data;
  } catch {
    return null;
  }
}

export async function deleteStoreCredentials(userId: string, provider: string) {
  await prisma.userAccountVault.deleteMany({
    where: { userId, provider },
  });
  return { success: true };
}

export async function listStoreCredentials(userId: string) {
  const sessions = await prisma.userAccountVault.findMany({
    where: { userId },
    select: {
      provider: true,
      isValid: true,
      lastVerified: true,
      userAgent: true,
    },
  });
  return sessions;
}
