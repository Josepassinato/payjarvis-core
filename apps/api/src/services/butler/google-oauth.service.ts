/**
 * Butler Google OAuth — Connect user's Google account (Gmail, Calendar, Contacts).
 *
 * Flow:
 * 1. GET /api/butler/connect-gmail?userId=xxx → redirect to Google consent
 * 2. User authorizes → Google redirects to callback with code
 * 3. Callback exchanges code for tokens → stores encrypted in DB
 * 4. gmail.service.ts uses per-user tokens instead of global ones
 */

import { google } from "googleapis";
import { prisma } from "@payjarvis/database";
import { encryptPII, decryptPII } from "../vault/crypto.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
const CALLBACK_URL = process.env.GOOGLE_OAUTH_CALLBACK_URL || "https://www.payjarvis.com/api/butler/gmail-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

function getOAuth2Client() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET)");
  }
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL);
}

/**
 * Generate the authorization URL for a user.
 */
export function getAuthUrl(userId: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: userId, // Pass userId in state param
  });
}

/**
 * Exchange authorization code for tokens and store them.
 */
export async function handleCallback(code: string, userId: string): Promise<{ email: string; scopes: string[] }> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("Failed to get tokens from Google");
  }

  // Get user's email
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email || "";

  // Store encrypted tokens
  await prisma.butlerConnectedAccount.upsert({
    where: { userId_provider: { userId, provider: "google" } },
    create: {
      userId,
      provider: "google",
      email,
      accessToken: encryptPII(tokens.access_token),
      refreshToken: encryptPII(tokens.refresh_token),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope?.split(" ") || SCOPES,
    },
    update: {
      email,
      accessToken: encryptPII(tokens.access_token),
      refreshToken: encryptPII(tokens.refresh_token),
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope?.split(" ") || SCOPES,
      active: true,
    },
  });

  // Log
  await prisma.butlerAuditLog.create({
    data: { userId, action: "connect_google", service: "google", status: "success", details: JSON.stringify({ email, scopes: SCOPES }) },
  });

  return { email, scopes: SCOPES };
}

/**
 * Get authenticated OAuth2 client for a user (with auto-refresh).
 */
export async function getUserAuth(userId: string) {
  const account = await prisma.butlerConnectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!account || !account.active) return null;

  const client = getOAuth2Client();
  const accessToken = decryptPII(account.accessToken);
  const refreshToken = decryptPII(account.refreshToken);

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: account.tokenExpiry?.getTime(),
  });

  // Auto-refresh if expired
  client.on("tokens", async (newTokens) => {
    const updates: Record<string, any> = {};
    if (newTokens.access_token) updates.accessToken = encryptPII(newTokens.access_token);
    if (newTokens.refresh_token) updates.refreshToken = encryptPII(newTokens.refresh_token);
    if (newTokens.expiry_date) updates.tokenExpiry = new Date(newTokens.expiry_date);

    if (Object.keys(updates).length > 0) {
      await prisma.butlerConnectedAccount.update({
        where: { id: account.id },
        data: updates,
      }).catch(() => {});
    }
  });

  return client;
}

/**
 * Disconnect Google account.
 */
export async function disconnectGoogle(userId: string): Promise<boolean> {
  const account = await prisma.butlerConnectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
  });

  if (!account) return false;

  // Revoke token at Google
  try {
    const client = getOAuth2Client();
    const accessToken = decryptPII(account.accessToken);
    await client.revokeToken(accessToken);
  } catch {
    // Token may already be invalid, continue
  }

  // Deactivate in DB
  await prisma.butlerConnectedAccount.update({
    where: { id: account.id },
    data: { active: false },
  });

  await prisma.butlerAuditLog.create({
    data: { userId, action: "disconnect_google", service: "google", status: "success" },
  });

  return true;
}

/**
 * Check if user has Google connected.
 */
export async function isGoogleConnected(userId: string): Promise<{ connected: boolean; email?: string }> {
  const account = await prisma.butlerConnectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "google" } },
    select: { active: true, email: true },
  });

  return { connected: !!account?.active, email: account?.email };
}

/**
 * Check if Google OAuth is configured on the server.
 */
export function isGoogleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}
