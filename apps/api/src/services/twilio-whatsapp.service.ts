/**
 * Twilio WhatsApp Service — send messages and templates via REST API
 *
 * Uses Twilio Node SDK to send WhatsApp messages from the production number
 * whatsapp:+17547145921 (not sandbox).
 *
 * Templates use Twilio Content API (ContentSid) for pre-approved messages.
 */

import Twilio from "twilio";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const FROM_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+17547145921";
const FROM_NUMBER_BR = process.env.TWILIO_WHATSAPP_NUMBER_BR || "whatsapp:+551150395940";
const WELCOME_TEMPLATE_SID = process.env.TWILIO_WELCOME_TEMPLATE_SID || "";
const REFERRAL_TEMPLATE_SID = process.env.TWILIO_REFERRAL_TEMPLATE_SID || "";

/**
 * Auto-route sender: BR numbers (+55) must be sent from BR Twilio number
 * to avoid error 63058 (US number cannot deliver to BR destinations).
 */
function autoRouteSender(to: string, requestedFrom?: string): string {
  const cleanTo = to.replace("whatsapp:", "").replace("+", "");
  if (cleanTo.startsWith("55")) {
    return FROM_NUMBER_BR;
  }
  return requestedFrom || FROM_NUMBER;
}

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (!_client) {
    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
    }
    _client = Twilio(ACCOUNT_SID, AUTH_TOKEN);
  }
  return _client;
}

/**
 * Split a long message into chunks that fit Twilio's 1600-char WhatsApp limit.
 * Splits on paragraph breaks first, then sentence boundaries, then hard-cuts.
 */
function splitMessage(text: string, maxLen = 3800): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at double newline (paragraph)
    let splitIdx = remaining.lastIndexOf("\n\n", maxLen);
    // Try single newline
    if (splitIdx < maxLen * 0.3) splitIdx = remaining.lastIndexOf("\n", maxLen);
    // Try sentence boundary
    if (splitIdx < maxLen * 0.3) {
      const sentenceMatch = remaining.substring(0, maxLen).match(/.*[.!?]\s/s);
      splitIdx = sentenceMatch ? sentenceMatch[0].length : -1;
    }
    // Hard cut as last resort
    if (splitIdx < maxLen * 0.3) splitIdx = maxLen;

    chunks.push(remaining.substring(0, splitIdx).trimEnd());
    remaining = remaining.substring(splitIdx).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Send a free-form WhatsApp message via Twilio REST API.
 * Only works within the 24h session window (user must have messaged first).
 * Automatically splits messages that exceed Twilio's 1600-char limit.
 */
export async function sendWhatsAppMessage(to: string, body: string, replyFrom?: string): Promise<string> {
  const client = getClient();

  // Ensure whatsapp: prefix
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const sender = autoRouteSender(toNumber, replyFrom);

  const chunks = splitMessage(body);
  let lastSid = "";

  for (const chunk of chunks) {
    const message = await client.messages.create({
      from: sender,
      to: toNumber,
      body: chunk,
    });
    lastSid = message.sid;
    console.log(`[Twilio WA] Sent message ${message.sid} to ${toNumber}${chunks.length > 1 ? ` (part ${chunks.indexOf(chunk) + 1}/${chunks.length})` : ""}`);
  }

  return lastSid;
}

/**
 * Send a WhatsApp audio message via Twilio REST API.
 * Uses mediaUrl to send an OGG audio file hosted at a public URL.
 */
export async function sendWhatsAppAudio(to: string, audioUrl: string, replyFrom?: string): Promise<string> {
  const client = getClient();
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const sender = autoRouteSender(toNumber, replyFrom);

  const message = await client.messages.create({
    from: sender,
    to: toNumber,
    mediaUrl: [audioUrl],
    body: "",
  });

  console.log(`[Twilio WA] Sent audio ${message.sid} to ${toNumber}`);
  return message.sid;
}

/**
 * Send a WhatsApp document (PDF, etc.) via Twilio REST API.
 * Uses mediaUrl to send a document hosted at a public URL.
 */
export async function sendWhatsAppDocument(to: string, documentUrl: string, caption?: string, replyFrom?: string): Promise<string> {
  const client = getClient();
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  const sender = autoRouteSender(toNumber, replyFrom);

  const message = await client.messages.create({
    from: sender,
    to: toNumber,
    mediaUrl: [documentUrl],
    body: caption || "",
  });

  console.log(`[Twilio WA] Sent document ${message.sid} to ${toNumber}`);
  return message.sid;
}

/**
 * Send a WhatsApp reaction emoji on a specific message.
 * Uses Twilio's reaction API (persistentAction).
 * Non-blocking — fire-and-forget, errors are swallowed.
 */
export async function sendWhatsAppReaction(
  to: string,
  messageSid: string,
  emoji: string,
  replyFrom?: string,
): Promise<void> {
  try {
    const client = getClient();
    const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
    const sender = autoRouteSender(toNumber, replyFrom);

    await client.messages.create({
      from: sender,
      to: toNumber,
      body: emoji,
      persistentAction: [`react/${messageSid}`],
    });
  } catch {
    // Non-blocking — swallow errors silently
  }
}

/**
 * Get Twilio credentials for downloading media (Basic Auth).
 */
export function getTwilioCredentials() {
  return { accountSid: ACCOUNT_SID, authToken: AUTH_TOKEN };
}

/**
 * Send a welcome template message.
 * Uses ContentSid for pre-approved template (works outside 24h window).
 *
 * Template variable {{1}} = user's name
 */
export async function sendWelcomeTemplate(to: string, userName: string): Promise<string> {
  if (!WELCOME_TEMPLATE_SID) {
    throw new Error("TWILIO_WELCOME_TEMPLATE_SID not configured");
  }

  const client = getClient();
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const message = await client.messages.create({
    from: FROM_NUMBER,
    to: toNumber,
    contentSid: WELCOME_TEMPLATE_SID,
    contentVariables: JSON.stringify({ "1": userName }),
  });

  console.log(`[Twilio WA] Sent welcome template ${message.sid} to ${toNumber} (name: ${userName})`);
  return message.sid;
}

/**
 * Send a referral template message.
 * Uses ContentSid for pre-approved template (works outside 24h window).
 *
 * Template variables: {{1}} = invitee name, {{2}} = referrer name
 */
export async function sendReferralTemplate(to: string, inviteeName: string, referrerName: string): Promise<string> {
  if (!REFERRAL_TEMPLATE_SID) {
    throw new Error("TWILIO_REFERRAL_TEMPLATE_SID not configured");
  }

  const client = getClient();
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const message = await client.messages.create({
    from: FROM_NUMBER,
    to: toNumber,
    contentSid: REFERRAL_TEMPLATE_SID,
    contentVariables: JSON.stringify({ "1": inviteeName, "2": referrerName }),
  });

  console.log(`[Twilio WA] Sent referral template ${message.sid} to ${toNumber} (invitee: ${inviteeName}, referrer: ${referrerName})`);
  return message.sid;
}
