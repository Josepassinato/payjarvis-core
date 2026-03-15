/**
 * WhatsApp Webhook Routes — Twilio Sandbox integration
 *
 * Receives WhatsApp messages via Twilio webhook, processes them through
 * the Jarvis AI (same Gemini logic as OpenClaw Telegram bot), and responds
 * with TwiML.
 *
 * Endpoint: POST /webhook/whatsapp
 * Content-Type: application/x-www-form-urlencoded (Twilio sends form data)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { processWhatsAppMessage } from "../services/jarvis-whatsapp.service.js";

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  // Encapsulated plugin with form-urlencoded parser for Twilio webhooks
  app.register(async function whatsappPlugin(fastify) {
    // Override content type parser for form-urlencoded (Twilio sends this)
    fastify.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 1048576 },
      (_req, body, done) => {
        try {
          const params = new URLSearchParams(body as string);
          const parsed: Record<string, string> = {};
          for (const [key, value] of params.entries()) {
            parsed[key] = value;
          }
          done(null, parsed);
        } catch (err) {
          done(err as Error, undefined);
        }
      }
    );

    // POST /webhook/whatsapp — Twilio sends messages here
    fastify.post("/webhook/whatsapp", async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, string>;
      const from = body.From || "";       // e.g. "whatsapp:+19546432431"
      const text = (body.Body || "").trim();
      const to = body.To || "";           // e.g. "whatsapp:+14155238886"

      request.log.info({ from, text: text.substring(0, 80) }, "[WhatsApp] Incoming message");

      if (!text) {
        return reply
          .header("Content-Type", "application/xml")
          .send(buildTwiml("", from));
      }

      try {
        const responseText = await processWhatsAppMessage(from, text);

        return reply
          .header("Content-Type", "application/xml")
          .send(buildTwiml(responseText, from));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        request.log.error({ err: msg }, "[WhatsApp] Processing error");

        return reply
          .header("Content-Type", "application/xml")
          .send(buildTwiml("Erro ao processar. Tente novamente.", from));
      }
    });

    // GET /webhook/whatsapp — health check / Twilio verification
    fastify.get("/webhook/whatsapp", async (_request, reply) => {
      return reply.send({ status: "ok", channel: "whatsapp", provider: "twilio" });
    });
  });
}

function buildTwiml(text: string, to: string): string {
  const safe = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const twilioNumber = process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message to="${to}" from="${twilioNumber}"><Body>${safe}</Body></Message></Response>`;
}
