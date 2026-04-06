import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { randomUUID } from "crypto";
import { prisma } from "@payjarvis/database";
import { requireAuth } from "../middleware/auth.js";
import {
  getHistory,
  saveMessage,
  getUserContext,
  upsertFact,
  chatWithGemini,
  chatWithGeminiMultimodal,
  extractAndSaveFacts,
  summarizeOldConversations,
} from "../services/jarvis-whatsapp.service.js";
import { consumeMessage } from "../services/credit.service.js";
import { transcribeAudio } from "../services/audio/stt.service.js";
import { textToSpeech } from "../services/audio/tts.service.js";

// ── Temp audio store for serving TTS responses ──
const webAudioStore = new Map<string, { path: string; createdAt: number }>();

// Cleanup expired entries every 60s (2 min TTL)
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of webAudioStore) {
    if (now - entry.createdAt > 2 * 60 * 1000) {
      try { if (existsSync(entry.path)) unlinkSync(entry.path); } catch {}
      webAudioStore.delete(id);
    }
  }
}, 60_000);

// ── Helpers ──

/** Web userId format for openclaw tables */
function webUserId(clerkId: string): string {
  return `web:${clerkId}`;
}

const PUBLIC_URL = process.env.PAYJARVIS_PUBLIC_URL || process.env.WEB_URL || "https://www.payjarvis.com";

/**
 * Core processing pipeline — same as WhatsApp/Telegram:
 * 1. Resolve user by clerkId
 * 2. Check credits
 * 3. Load history + facts
 * 4. Seed facts from users table if empty
 * 5. Route to premium or standard (Gemini + function calling + 30+ tools)
 * 6. Save conversation
 * 7. Extract facts + summarize (background)
 */
async function processWebMessage(clerkId: string, text: string): Promise<string> {
  const userId = webUserId(clerkId);
  console.log(`[WebChat] ${userId}: ${text.substring(0, 80)}`);

  // 1. Resolve internal user ID (from Clerk-created user)
  let internalUserId: string | null = null;
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    internalUserId = user?.id ?? null;
  } catch { /* non-blocking */ }

  if (!internalUserId) {
    return "Please complete your account setup first. Go to payjarvis.com to get started.";
  }

  // 2. Check credits
  try {
    const creditCheck = await consumeMessage(internalUserId, "web", 0, 0);
    if (!creditCheck.allowed) {
      return "Your messages have run out.\n\nRecharge to continue:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25";
    }
  } catch { /* allow if credit check fails */ }

  // 3. Determine tier
  let userTier = "free";
  try {
    const user = await prisma.user.findUnique({
      where: { id: internalUserId },
      select: { planType: true },
    });
    userTier = user?.planType || "free";
  } catch { /* default free */ }

  // 4. Load history + facts
  try {
    let [history, userFacts] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
    ]);

    // Seed facts from users table if empty (first time web user)
    if (userFacts.length === 0) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: internalUserId },
          select: { fullName: true, email: true, botNickname: true },
        });
        if (dbUser?.fullName) {
          const seedFacts: [string, string, string][] = [];
          seedFacts.push(["user_name", dbUser.fullName, "identity"]);
          const firstName = dbUser.fullName.split(" ")[0];
          if (firstName) seedFacts.push(["first_name", firstName, "identity"]);
          if (dbUser.botNickname) seedFacts.push(["bot_nickname", dbUser.botNickname, "identity"]);
          if (dbUser.email) seedFacts.push(["email", dbUser.email, "identity"]);
          seedFacts.push(["channel", "web", "general"]);

          for (const [key, value, category] of seedFacts) {
            await upsertFact(userId, key, value, category, "recovery");
          }
          console.log(`[WebChat] Seeded ${seedFacts.length} facts for ${userId}`);
          userFacts = await getUserContext(userId);
        }
      } catch (err) {
        console.error("[WebChat] Fact seed error:", (err as Error).message);
      }
    }

    let response: string;

    if (userTier === "premium") {
      // ═══ PREMIUM PIPELINE ═══
      console.log(`[WebChat PREMIUM] Processing for ${userId}`);
      try {
        const premiumRes = await fetch(`http://localhost:4000/api/premium/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({ userId, text, platform: "web" }),
          signal: AbortSignal.timeout(30000),
        });
        const premiumData = await premiumRes.json() as {
          success: boolean;
          response: string;
          documents?: { pdfPath: string; title: string }[];
        };
        if (premiumData.success) {
          response = premiumData.response;
          // Note: PDFs from premium pipeline — include download links in response
          if (premiumData.documents?.length) {
            for (const doc of premiumData.documents) {
              if (existsSync(doc.pdfPath)) {
                response += `\n\n📄 Document: ${doc.title}`;
              }
            }
          }
        } else {
          // Fallback to standard
          console.warn("[WebChat PREMIUM] Fallback:", premiumData);
          response = await chatWithGemini(history, text, userId, userFacts);
          await saveMessage(userId, "user", text);
          await saveMessage(userId, "model", response);
        }
      } catch (err) {
        // Fallback to standard
        console.warn("[WebChat PREMIUM] Unavailable:", (err as Error).message);
        response = await chatWithGemini(history, text, userId, userFacts);
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", response);
      }
    } else {
      // ═══ STANDARD PIPELINE ═══
      // Gemini 2.5 Flash + function calling + 30+ tools (same as WhatsApp)
      response = await chatWithGemini(history, text, userId, userFacts);
      await saveMessage(userId, "user", text);
      await saveMessage(userId, "model", response);
    }

    // Background: extract facts + summarize
    extractAndSaveFacts(userId, text, response).catch((err) =>
      console.error("[WebChat FACT] Background error:", err.message)
    );
    summarizeOldConversations(userId).catch((err) =>
      console.error("[WebChat SUMMARY] Background error:", err.message)
    );

    return response;
  } catch (err) {
    console.error("[WebChat] Pipeline error:", (err as Error).message);
    return "Sorry, something went wrong. Please try again.";
  }
}

/** Process image message through Gemini Vision multimodal */
async function processWebImageMessage(
  clerkId: string,
  imageBase64: string,
  mimeType: string,
  caption: string
): Promise<string> {
  const userId = webUserId(clerkId);
  console.log(`[WebChat Image] ${userId}: caption="${(caption || "").substring(0, 80)}"`);

  // Resolve user
  let internalUserId: string | null = null;
  try {
    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    internalUserId = user?.id ?? null;
  } catch { /* non-blocking */ }

  if (!internalUserId) {
    return "Please complete your account setup first.";
  }

  // Check credits
  try {
    const creditCheck = await consumeMessage(internalUserId, "web", 0, 0);
    if (!creditCheck.allowed) {
      return "Your messages have run out. Recharge to continue.";
    }
  } catch { /* allow */ }

  try {
    let [history, userFacts] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
    ]);

    // Seed facts if empty
    if (userFacts.length === 0) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: internalUserId },
          select: { fullName: true, email: true },
        });
        if (dbUser?.fullName) {
          await upsertFact(userId, "user_name", dbUser.fullName, "identity", "recovery");
          const firstName = dbUser.fullName.split(" ")[0];
          if (firstName) await upsertFact(userId, "first_name", firstName, "identity", "recovery");
          userFacts = await getUserContext(userId);
        }
      } catch { /* non-blocking */ }
    }

    const response = await chatWithGeminiMultimodal(history, caption, imageBase64, mimeType, userId, userFacts);
    await saveMessage(userId, "user", `[photo] ${caption || "image sent"}`);
    await saveMessage(userId, "model", response);

    extractAndSaveFacts(userId, caption || "image sent", response).catch((err) =>
      console.error("[WebChat IMAGE FACT] Background error:", err.message)
    );

    return response;
  } catch (err) {
    console.error("[WebChat Image] Error:", (err as Error).message);
    return "Failed to analyze image. Please try again.";
  }
}

// ── Route Registration ──

export async function webChatRoutes(app: FastifyInstance) {
  app.register(async function webChatPlugin(fastify) {

    // ════════════════════════════════════════════════════════
    // POST /api/web-chat/send — Send text (+ optional image)
    // ════════════════════════════════════════════════════════
    fastify.post(
      "/api/web-chat/send",
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireAuth(request, reply);
        if (reply.sent) return;

        const clerkId = (request as any).userId as string;
        const body = request.body as {
          text?: string;
          message?: string;
          image?: string;
          imageMimeType?: string;
        };

        const text = (body.text || body.message || "").trim();
        if (!text && !body.image) {
          return reply.status(400).send({
            success: false,
            error: "text or image is required",
          });
        }

        try {
          let response: string;

          if (body.image) {
            response = await processWebImageMessage(
              clerkId,
              body.image,
              body.imageMimeType || "image/jpeg",
              text || "image sent"
            );
          } else {
            response = await processWebMessage(clerkId, text);
          }

          const cleanResponse = response.replace(/\[FORMAT:(TEXT|AUDIO)\]\s*/gi, '').trim();
          return reply.send({
            success: true,
            data: { reply: cleanResponse },
          });
        } catch (err) {
          console.error("[WebChat] Send error:", (err as Error).message);
          return reply.status(500).send({
            success: false,
            error: "Failed to process message",
          });
        }
      }
    );

    // ════════════════════════════════════════════════════════
    // GET /api/web-chat/history — Load conversation history
    // ════════════════════════════════════════════════════════
    fastify.get(
      "/api/web-chat/history",
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireAuth(request, reply);
        if (reply.sent) return;

        const clerkId = (request as any).userId as string;
        const query = request.query as { limit?: string };
        const limit = Math.min(parseInt(query.limit || "50", 10) || 50, 200);
        const userId = webUserId(clerkId);

        try {
          const rows = await prisma.$queryRaw<
            { role: string; content: string; created_at: Date }[]
          >`
            SELECT role, content, created_at FROM openclaw_conversations
            WHERE user_id = ${userId}
            ORDER BY created_at DESC LIMIT ${limit}
          `;

          const messages = rows.reverse().map((r) => ({
            role: r.role === "model" ? "assistant" : "user",
            content: r.content,
            timestamp: r.created_at,
          }));

          return reply.send({ success: true, data: { messages } });
        } catch (err) {
          console.error("[WebChat] History error:", (err as Error).message);
          return reply.status(500).send({
            success: false,
            error: "Failed to load history",
          });
        }
      }
    );

    // ════════════════════════════════════════════════════════
    // POST /api/web-chat/audio — Voice message (STT → process → TTS)
    // ════════════════════════════════════════════════════════
    fastify.post(
      "/api/web-chat/audio",
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireAuth(request, reply);
        if (reply.sent) return;

        const clerkId = (request as any).userId as string;
        const body = request.body as {
          audio: string;
          mimeType?: string;
        };

        if (!body.audio) {
          return reply.status(400).send({
            success: false,
            error: "audio (base64) is required",
          });
        }

        const userId = webUserId(clerkId);
        const mimeType = body.mimeType || "audio/webm";

        try {
          // 1. Speech-to-Text via Gemini
          const transcription = await transcribeAudio(body.audio, mimeType);
          if (!transcription) {
            return reply.status(422).send({
              success: false,
              error: "Could not transcribe audio",
            });
          }

          console.log(`[WebChat Audio] ${clerkId}: transcribed "${transcription.substring(0, 80)}"`);

          // 2. Process through full Jarvis pipeline (same as text)
          const response = await processWebMessage(clerkId, transcription);

          // 3. Text-to-Speech for response
          let audioUrl: string | undefined;
          try {
            const langFact = await prisma.$queryRaw<{ fact_value: string }[]>`
              SELECT fact_value FROM openclaw_user_facts
              WHERE user_id = ${userId} AND fact_key = 'preferred_language'
              LIMIT 1
            `;
            const lang = langFact?.[0]?.fact_value || "en";

            const audioPath = await textToSpeech(response, lang);
            if (audioPath && existsSync(audioPath)) {
              const audioId = `web_${Date.now()}_${randomUUID().slice(0, 8)}`;
              webAudioStore.set(audioId, { path: audioPath, createdAt: Date.now() });
              audioUrl = `${PUBLIC_URL}/api/web-chat/audio-file/${audioId}`;
            }
          } catch (ttsErr) {
            console.error("[WebChat TTS] Error:", (ttsErr as Error).message);
          }

          const cleanAudioResponse = response.replace(/\[FORMAT:(TEXT|AUDIO)\]\s*/gi, '').trim();
          return reply.send({
            success: true,
            data: {
              response: cleanAudioResponse,
              transcription,
              audioUrl,
            },
          });
        } catch (err) {
          console.error("[WebChat Audio] Error:", (err as Error).message);
          return reply.status(500).send({
            success: false,
            error: "Failed to process audio",
          });
        }
      }
    );

    // ════════════════════════════════════════════════════════
    // POST /api/web-chat/vision — Live camera vision analysis
    // ════════════════════════════════════════════════════════
    fastify.post(
      "/api/web-chat/vision",
      async (request: FastifyRequest, reply: FastifyReply) => {
        await requireAuth(request, reply);
        if (reply.sent) return;

        const clerkId = (request as any).userId as string;
        const body = request.body as {
          image: string;
          mode?: "live" | "capture";
          question?: string;
        };

        if (!body.image) {
          return reply.status(400).send({
            success: false,
            error: "image (base64) is required",
          });
        }

        const userId = webUserId(clerkId);

        // Resolve user
        let internalUserId: string | null = null;
        try {
          const user = await prisma.user.findUnique({
            where: { clerkId },
            select: { id: true },
          });
          internalUserId = user?.id ?? null;
        } catch { /* non-blocking */ }

        if (!internalUserId) {
          return reply.status(401).send({
            success: false,
            error: "Account setup required",
          });
        }

        // Check credits (1 credit per vision frame)
        try {
          const creditCheck = await consumeMessage(internalUserId, "web", 0, 0);
          if (!creditCheck.allowed) {
            return reply.status(402).send({
              success: false,
              error: "Credits exhausted",
            });
          }
        } catch { /* allow if credit check fails */ }

        try {
          const prompt = body.question
            ? `The user is showing you something via their camera and asking: "${body.question}". Describe what you see and answer their question. Be concise (2-3 sentences max).`
            : "Describe what you see in this image concisely (2-3 sentences). Identify any products, text, prices, brands, or notable objects. Be specific and useful.";

          const response = await chatWithGeminiMultimodal(
            [], // no history for live mode — fast response
            prompt,
            body.image,
            "image/jpeg",
            userId,
            [] // no facts for live mode — speed priority
          );

          const cleanVisionResponse = response.replace(/\[FORMAT:(TEXT|AUDIO)\]\s*/gi, '').trim();
          return reply.send({
            success: true,
            data: { description: cleanVisionResponse },
          });
        } catch (err) {
          console.error("[WebChat Vision] Error:", (err as Error).message);
          return reply.status(500).send({
            success: false,
            error: "Vision analysis failed",
          });
        }
      }
    );

    // ════════════════════════════════════════════════════════
    // GET /api/web-chat/audio-file/:id — Serve temp TTS audio
    // ════════════════════════════════════════════════════════
    fastify.get(
      "/api/web-chat/audio-file/:id",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const entry = webAudioStore.get(id);

        if (!entry || !existsSync(entry.path)) {
          return reply.status(404).send({ error: "Audio not found or expired" });
        }

        const buffer = readFileSync(entry.path);
        return reply
          .header("Content-Type", "audio/ogg")
          .header("Content-Length", buffer.length)
          .header("Cache-Control", "no-store")
          .send(buffer);
      }
    );
  });
}
