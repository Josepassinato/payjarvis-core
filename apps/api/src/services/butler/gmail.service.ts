/**
 * Butler Gmail Service — Read emails, find confirmation links, mark as read.
 *
 * Uses per-user OAuth2 tokens from ButlerConnectedAccount table.
 * Falls back to env vars (GMAIL_CLIENT_ID etc.) for owner-only legacy mode.
 */

import { google } from "googleapis";
import { getUserAuth } from "./google-oauth.service.js";

/**
 * Get Gmail client for a specific user (via stored OAuth tokens).
 * Falls back to env-var tokens if userId not provided.
 */
async function getGmailForUser(userId?: string) {
  // Try per-user OAuth first
  if (userId) {
    const auth = await getUserAuth(userId);
    if (auth) return google.gmail({ version: "v1", auth });
  }

  // Fallback: env var tokens (legacy)
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || "";
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || "";
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || "";

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Gmail not connected. Use 'Jarvis, conecta meu Gmail' to connect your Google account.");
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, "urn:ietf:wg:oauth:2.0:oob");
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// ─── Search Emails ───

export interface EmailResult {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
}

/**
 * Search emails with Gmail query syntax.
 * Examples: "from:bestbuy.com subject:confirm", "is:unread after:2026/03/26"
 */
export async function searchEmails(query: string, maxResults = 5, userId?: string): Promise<EmailResult[]> {
  const gmail = await getGmailForUser(userId);

  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = res.data.messages || [];
  const results: EmailResult[] = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || "";

    results.push({
      id: msg.id!,
      threadId: msg.threadId!,
      from: getHeader("From"),
      subject: getHeader("Subject"),
      date: getHeader("Date"),
      snippet: detail.data.snippet || "",
    });
  }

  return results;
}

/**
 * Get full email body (HTML or plain text).
 */
export async function getEmailBody(messageId: string, userId?: string): Promise<string> {
  const gmail = await getGmailForUser(userId);

  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const parts = res.data.payload?.parts || [];
  const payload = res.data.payload;

  // Try HTML first, then plain text
  for (const mime of ["text/html", "text/plain"]) {
    // Check top-level body
    if (payload?.mimeType === mime && payload.body?.data) {
      return Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }
    // Check parts
    const part = parts.find(p => p.mimeType === mime);
    if (part?.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    // Check nested parts
    for (const p of parts) {
      const sub = (p.parts || []).find(sp => sp.mimeType === mime);
      if (sub?.body?.data) {
        return Buffer.from(sub.body.data, "base64url").toString("utf-8");
      }
    }
  }

  return res.data.snippet || "";
}

/**
 * Extract confirmation/verification links from an email.
 * Looks for common patterns: confirm, verify, activate, click here.
 */
export async function getConfirmationLink(messageId: string): Promise<string | null> {
  const body = await getEmailBody(messageId);

  // Common confirmation link patterns
  const patterns = [
    /href=["'](https?:\/\/[^"']*(?:confirm|verify|activate|validate|click)[^"']*?)["']/i,
    /href=["'](https?:\/\/[^"']*(?:token|code|key)=[^"']*?)["']/i,
    /(https?:\/\/[^\s<>"']*(?:confirm|verify|activate)[^\s<>"']*)/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Mark email as read.
 */
export async function markAsRead(messageId: string, userId?: string): Promise<void> {
  const gmail = await getGmailForUser(userId);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

/**
 * Wait for a confirmation email from a service (polls every 10s for up to timeout).
 */
export async function waitForConfirmationEmail(
  service: string,
  timeoutMs = 60000
): Promise<{ link: string | null; emailId: string | null }> {
  const startTime = Date.now();
  const query = `from:${service} is:unread newer_than:5m`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const emails = await searchEmails(query, 1);
      if (emails.length > 0) {
        const link = await getConfirmationLink(emails[0].id);
        return { link, emailId: emails[0].id };
      }
    } catch {
      // Retry
    }
    await new Promise(r => setTimeout(r, 10000)); // Poll every 10s
  }

  return { link: null, emailId: null };
}

/**
 * Get recent unread emails summary.
 */
export async function getUnreadSummary(maxResults = 5, userId?: string): Promise<EmailResult[]> {
  return searchEmails("is:unread", maxResults, userId);
}

/**
 * Check if Gmail is configured and working.
 */
export async function isGmailConfigured(userId?: string): Promise<boolean> {
  try {
    if (userId) {
      const auth = await getUserAuth(userId);
      if (auth) return true;
    }
    if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) return false;
    const gmail = await getGmailForUser();
    const res = await gmail.users.getProfile({ userId: "me" });
    return !!res.data.emailAddress;
  } catch {
    return false;
  }
}
