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
const WELCOME_TEMPLATE_SID = process.env.TWILIO_WELCOME_TEMPLATE_SID || "";
const REFERRAL_TEMPLATE_SID = process.env.TWILIO_REFERRAL_TEMPLATE_SID || "";

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
 * Send a free-form WhatsApp message via Twilio REST API.
 * Only works within the 24h session window (user must have messaged first).
 */
export async function sendWhatsAppMessage(to: string, body: string): Promise<string> {
  const client = getClient();

  // Ensure whatsapp: prefix
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const message = await client.messages.create({
    from: FROM_NUMBER,
    to: toNumber,
    body,
  });

  console.log(`[Twilio WA] Sent message ${message.sid} to ${toNumber}`);
  return message.sid;
}

/**
 * Send a WhatsApp audio message via Twilio REST API.
 * Uses mediaUrl to send an OGG audio file hosted at a public URL.
 */
export async function sendWhatsAppAudio(to: string, audioUrl: string): Promise<string> {
  const client = getClient();
  const toNumber = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const message = await client.messages.create({
    from: FROM_NUMBER,
    to: toNumber,
    mediaUrl: [audioUrl],
    body: "",
  });

  console.log(`[Twilio WA] Sent audio ${message.sid} to ${toNumber}`);
  return message.sid;
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
