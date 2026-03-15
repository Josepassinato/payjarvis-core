/**
 * Stripe Webhook Routes — handles Stripe events
 *
 * Currently handles:
 * - setup_intent.succeeded — completes onboarding when card is added
 *
 * Uses Fastify encapsulation to override the JSON body parser for raw buffer access
 * (needed for Stripe signature verification).
 */

import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { completeOnboarding } from "../services/onboarding-bot.service.js";
import Stripe from "stripe";

export async function stripeWebhookRoutes(app: FastifyInstance) {
  // Encapsulated plugin with raw body parser for Stripe signature verification
  app.register(async function stripeWebhookPlugin(fastify) {
    fastify.removeContentTypeParser("application/json");
    fastify.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1048576 },
      (_req, body, done) => {
        done(null, body);
      }
    );

    fastify.post("/api/webhooks/stripe", async (request, reply) => {
      const sig = request.headers["stripe-signature"] as string;
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        console.warn("[Stripe Webhook] STRIPE_WEBHOOK_SECRET not configured");
        return reply.status(500).send({ error: "Webhook secret not configured" });
      }

      let event: Stripe.Event;
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
        event = stripe.webhooks.constructEvent(request.body as Buffer, sig, webhookSecret);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error("[Stripe Webhook] Signature verification failed:", msg);
        return reply.status(400).send({ error: `Webhook signature verification failed: ${msg}` });
      }

      console.log(`[Stripe Webhook] Received event: ${event.type}`);

      switch (event.type) {
        case "setup_intent.succeeded": {
          const setupIntent = event.data.object as Stripe.SetupIntent;
          const sessionId = setupIntent.metadata?.onboardingSessionId;

          if (sessionId) {
            const session = await prisma.onboardingSession.findFirst({
              where: { stripeSetupIntent: setupIntent.id },
            });

            if (session && session.step !== "complete") {
              await prisma.onboardingSession.update({
                where: { id: session.id },
                data: { paymentSetup: true },
              });

              // Save payment method to user
              if (session.userId) {
                const pmId = typeof setupIntent.payment_method === "string"
                  ? setupIntent.payment_method
                  : (setupIntent.payment_method as any)?.id;

                if (pmId) {
                  await prisma.paymentMethod.upsert({
                    where: { userId_provider: { userId: session.userId, provider: "STRIPE" } },
                    create: {
                      userId: session.userId,
                      provider: "STRIPE",
                      status: "CONNECTED",
                      accountId: "Card (via onboarding)",
                      credentials: { paymentMethodId: pmId } as any,
                    },
                    update: {
                      status: "CONNECTED",
                      credentials: { paymentMethodId: pmId } as any,
                    },
                  });
                }
              }

              // Complete the onboarding
              const response = await completeOnboarding(session.id);

              // Send completion message via Telegram
              if (session.telegramChatId) {
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                if (botToken) {
                  try {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        chat_id: session.telegramChatId,
                        text: response.message,
                      }),
                    });
                  } catch (err) {
                    console.error("[Stripe Webhook] Failed to send Telegram message:", err);
                  }
                }
              }

              console.log(`[Stripe Webhook] Onboarding session ${session.id} completed via webhook`);
            }
          }
          break;
        }

        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      }

      return { received: true };
    });
  });
}
