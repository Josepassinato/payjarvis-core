/**
 * PAYJARVIS — Onboarding Routes
 *
 * Helps developers identify their platform and find the correct
 * integration guide without manual navigation.
 *
 * GET  /v1/onboarding/guides          — list all available guides
 * POST /v1/onboarding/detect-platform — detect platform from userAgent / code snippet
 */

import type { FastifyInstance } from "fastify";
import { prisma, Prisma } from "@payjarvis/database";
import { requireAuth, getKycLevel, getInitialTrustScore } from "../middleware/auth.js";
import { createAuditLog } from "../services/audit.js";
import { createAgent } from "../services/agent-identity.js";
import { activateUserBot } from "../services/bot-provisioning.js";
import { createHash, randomBytes } from "node:crypto";
import { chatWithGemini } from "../services/gemini.js";
import type { GeminiResult } from "../services/gemini.js";
import { getAmazonDomain } from "../services/amazon/domains.js";
import { saveStoreCredentials, deleteStoreCredentials, normalizeStoreName } from "../services/vault/credentials.js";

// ─────────────────────────────────────────
// PLATFORM DEFINITIONS
// ─────────────────────────────────────────

type Platform =
  | "telegram"
  | "whatsapp"
  | "langchain"
  | "openai-agents"
  | "crewai"
  | "n8n"
  | "flowise"
  | "custom";

type Confidence = "high" | "medium" | "low";

interface PlatformGuide {
  platform: Platform;
  title: string;
  estimatedMinutes: number;
  docsUrl: string;
  description: string;
}

const GUIDES: PlatformGuide[] = [
  {
    platform: "telegram",
    title: "Add PayJarvis to your Telegram bot",
    estimatedMinutes: 5,
    docsUrl: "https://docs.payjarvis.com/integrations/telegram",
    description: "Supports Telegraf and node-telegram-bot-api. Inject tool + system prompt.",
  },
  {
    platform: "whatsapp",
    title: "Add PayJarvis to your WhatsApp bot",
    estimatedMinutes: 7,
    docsUrl: "https://docs.payjarvis.com/integrations/whatsapp",
    description: "Supports Evolution API webhooks and Baileys direct integration.",
  },
  {
    platform: "langchain",
    title: "Add PayJarvis to your LangChain agent",
    estimatedMinutes: 3,
    docsUrl: "https://docs.payjarvis.com/integrations/langchain",
    description: "DynamicStructuredTool ready to add to any LangChain agent.",
  },
  {
    platform: "openai-agents",
    title: "Add PayJarvis to your OpenAI Agents",
    estimatedMinutes: 3,
    docsUrl: "https://docs.payjarvis.com/integrations/openai-agents",
    description: "Native tool for openai.chat.completions.create() with tool_choice.",
  },
  {
    platform: "crewai",
    title: "Add PayJarvis to your CrewAI agent",
    estimatedMinutes: 4,
    docsUrl: "https://docs.payjarvis.com/integrations/crewai",
    description: "BaseTool subclass compatible with any CrewAI crew.",
  },
  {
    platform: "n8n",
    title: "Add PayJarvis to your n8n workflow",
    estimatedMinutes: 5,
    docsUrl: "https://docs.payjarvis.com/integrations/n8n",
    description: "Community node. Install via npm and use in any workflow.",
  },
  {
    platform: "flowise",
    title: "Add PayJarvis to your Flowise chatflow",
    estimatedMinutes: 3,
    docsUrl: "https://docs.payjarvis.com/integrations/flowise",
    description: "Custom tool node for Flowise. Drag into any chatflow.",
  },
  {
    platform: "custom",
    title: "Add PayJarvis to a custom bot",
    estimatedMinutes: 10,
    docsUrl: "https://docs.payjarvis.com/integrations/existing-bot",
    description: "Framework-agnostic guide: system prompt injection + HTTP tool call.",
  },
];

// ─────────────────────────────────────────
// DETECTION RULES — pure string matching
// ─────────────────────────────────────────

interface DetectionRule {
  platform: Platform;
  confidence: Confidence;
  keywords: string[];
  source: "userAgent" | "codeSnippet" | "both";
}

const DETECTION_RULES: DetectionRule[] = [
  { platform: "telegram",       confidence: "high",   keywords: ["telegraf", "node-telegram-bot-api", "telegrambot"], source: "both" },
  { platform: "whatsapp",       confidence: "high",   keywords: ["baileys", "evolution-api", "@evolution", "whatsapp-web", "wweb.js"], source: "both" },
  { platform: "langchain",      confidence: "high",   keywords: ["langchain", "dynamicstructuredtool", "agentexecutor"], source: "both" },
  { platform: "openai-agents",  confidence: "high",   keywords: ["openai.chat.completions", "tool_choice", "openai/resources"], source: "both" },
  { platform: "crewai",         confidence: "high",   keywords: ["crewai", "crew-ai", "basetool", "from crewai"], source: "both" },
  { platform: "n8n",            confidence: "high",   keywords: ["n8n", "n8n-nodes", "inodefunctions"], source: "both" },
  { platform: "flowise",        confidence: "high",   keywords: ["flowise", "flowise-components"], source: "both" },
  { platform: "telegram",       confidence: "medium", keywords: ["bot.on(", "ctx.reply", "ctx.telegram", "telegram"], source: "codeSnippet" },
  { platform: "whatsapp",       confidence: "medium", keywords: ["remotejid", "messages.upsert", "whatsapp", "wpp"], source: "codeSnippet" },
  { platform: "openai-agents",  confidence: "medium", keywords: ["openai", "gpt-4", "tool_calls", "function_call"], source: "codeSnippet" },
];

function detectPlatform(
  userAgent: string,
  codeSnippet?: string
): { platform: Platform; confidence: Confidence } {
  const ua = userAgent.toLowerCase();
  const code = (codeSnippet ?? "").toLowerCase();

  for (const rule of DETECTION_RULES) {
    const searchIn =
      rule.source === "userAgent" ? ua
      : rule.source === "codeSnippet" ? code
      : `${ua} ${code}`;

    if (rule.keywords.some((kw) => searchIn.includes(kw))) {
      return { platform: rule.platform, confidence: rule.confidence };
    }
  }

  return { platform: "custom", confidence: "low" };
}

function getNextStep(platform: Platform): string {
  const steps: Record<Platform, string> = {
    telegram:        "npm install @payjarvis/agent-sdk — then import from @payjarvis/agent-sdk/integrations/telegram",
    whatsapp:        "npm install @payjarvis/agent-sdk — then import from @payjarvis/agent-sdk/integrations/whatsapp",
    langchain:       "npm install @payjarvis/agent-sdk — then use PAYJARVIS_TOOL_SCHEMA with your LangChain agent",
    "openai-agents": "npm install @payjarvis/agent-sdk — then add PAYJARVIS_TOOL_SCHEMA to your tools array",
    crewai:          "pip install payjarvis — then import PayJarvisTool from payjarvis.crewai",
    n8n:             "npm install @payjarvis/n8n-node in your n8n custom nodes directory, then restart n8n",
    flowise:         "Add the PayJarvis Tool node to your Flowise chatflow from the Tools panel",
    custom:          "npm install @payjarvis/agent-sdk — then inject PAYJARVIS_SYSTEM_PROMPT and register PAYJARVIS_TOOL_SCHEMA in your LLM call",
  };
  return steps[platform];
}

// ─────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────

export async function onboardingRoutes(app: FastifyInstance) {

  app.get("/v1/onboarding/guides", async (_req, reply) => {
    return reply.send({ success: true, data: GUIDES });
  });

  app.post("/v1/onboarding/detect-platform", async (request, reply) => {
    const body = request.body as {
      userAgent?: string;
      codeSnippet?: string;
    };

    if (!body?.userAgent && !body?.codeSnippet) {
      return reply.status(400).send({
        success: false,
        error: "Provide at least one of: userAgent, codeSnippet",
      });
    }

    const { platform, confidence } = detectPlatform(
      body.userAgent ?? "",
      body.codeSnippet
    );

    const guide = GUIDES.find((g) => g.platform === platform)!;

    return reply.send({
      success: true,
      data: {
        platform,
        confidence,
        guide: guide.docsUrl,
        estimatedMinutes: guide.estimatedMinutes,
        nextStep: getNextStep(platform),
      },
    });
  });

  // ─────────────────────────────────────────
  // USER ONBOARDING FLOW
  // ─────────────────────────────────────────

  // GET /onboarding/status — current onboarding state
  app.get("/api/onboarding/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) {
      request.log.warn({ clerkId: userId }, "[ONBOARDING] User not found for status check");
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    request.log.info({ clerkId: userId, step: user.onboardingStep, status: user.status, kycLevel: user.kycLevel }, "[ONBOARDING] Status check");
    return { success: true, data: { onboardingStep: user.onboardingStep, status: user.status, kycLevel: user.kycLevel } };
  });

  // POST /onboarding/ocr — Extract document data via Claude Vision
  app.post("/api/onboarding/ocr", { preHandler: [requireAuth] }, async (request, reply) => {
    const body = request.body as { image: string; mimeType?: string };
    const userId = (request as any).userId as string;

    request.log.info({ userId, mimeType: body?.mimeType, imageLength: body?.image?.length }, "[OCR] Request received");

    if (!body?.image) {
      request.log.warn({ userId }, "[OCR] No image provided");
      return reply.status(400).send({ success: false, error: "image (base64) is required" });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      request.log.error("[OCR] ANTHROPIC_API_KEY not configured");
      return reply.status(503).send({ success: false, error: "OCR service not configured" });
    }

    try {
      request.log.info({ userId, model: "claude-sonnet-4-20250514", imageSize: body.image.length }, "[OCR] Calling Claude Vision API");
      const startTime = Date.now();

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: body.mimeType || "image/jpeg", data: body.image },
              },
              {
                type: "text",
                text: `You are a document OCR extractor. Extract the following fields from this ID document image and return ONLY a valid JSON object with these exact keys:
{"fullName": "full name as printed on document or null", "dateOfBirth": "date in YYYY-MM-DD format or null", "documentNumber": "ID/CPF/passport number or null", "country": "2-letter ISO country code or null"}
Rules: Return ONLY the JSON, no explanation, no markdown fences. If a field is not visible or readable, set it to null. For names, use proper capitalization. For dates, convert any format to YYYY-MM-DD. For country, use ISO 3166-1 alpha-2 (BR, US, PT, etc).`,
              },
            ],
          }],
        }),
      });

      const elapsed = Date.now() - startTime;

      if (!res.ok) {
        const errText = await res.text();
        request.log.error({ status: res.status, body: errText, elapsed }, "[OCR] Claude Vision API error");
        return reply.status(502).send({ success: false, error: "OCR service error" });
      }

      const data = await res.json();
      const rawText = (data as any).content?.[0]?.text || "{}";
      request.log.info({ userId, elapsed, rawResponse: rawText }, "[OCR] Claude Vision raw response");

      const text = rawText.replace(/```json|```/g, "").trim();
      const extracted = JSON.parse(text);

      const filledFields = Object.entries(extracted).filter(([, v]) => v !== null).map(([k]) => k);
      const missedFields = Object.entries(extracted).filter(([, v]) => v === null).map(([k]) => k);
      request.log.info({ userId, elapsed, filled: filledFields, missed: missedFields, extracted }, "[OCR] Extraction result");

      return { success: true, data: extracted };
    } catch (err) {
      request.log.error(err, "[OCR] Processing failed");
      return reply.status(500).send({ success: false, error: "OCR processing failed" });
    }
  });

  // POST /onboarding/step/1 — Basic user data + auto-create bot
  app.post("/api/onboarding/step/1", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = request.body as {
      fullName: string;
      phone?: string;
      country?: string;
    };

    request.log.info({ clerkId: userId, fullName: body.fullName, country: body.country }, "[STEP1] Basic data received");

    if (!body.fullName) {
      return reply.status(400).send({ success: false, error: "fullName is required" });
    }

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        fullName: body.fullName,
        phone: body.phone ?? null,
        country: body.country ?? "BR",
        onboardingStep: 1,
      },
    });

    // Auto-create bot if user doesn't have one yet
    const existingBot = await prisma.bot.findFirst({ where: { ownerId: user.id } });
    if (!existingBot) {
      const apiKey = `pj_bot_${randomBytes(32).toString("hex")}`;
      const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
      const kycLevelNum = getKycLevel(user.kycLevel);
      const initialTrustScore = getInitialTrustScore(kycLevelNum);

      const bot = await prisma.bot.create({
        data: {
          name: "JARVIS",
          platform: "TELEGRAM",
          ownerId: user.id,
          apiKeyHash,
          trustScore: initialTrustScore,
        },
      });

      await prisma.policy.create({
        data: {
          botId: bot.id,
          maxPerTransaction: 50,
          maxPerDay: 200,
          maxPerWeek: 500,
          maxPerMonth: 2000,
          autoApproveLimit: 50,
          requireApprovalUp: 200,
          allowedDays: [1, 2, 3, 4, 5],
          allowedHoursStart: 6,
          allowedHoursEnd: 22,
          allowedCategories: [],
          blockedCategories: [],
          merchantWhitelist: [],
          merchantBlacklist: [],
        },
      });

      await createAgent(bot.id, user.id, "JARVIS", user.kycLevel);
      request.log.info({ botId: bot.id }, "[STEP1] Auto-created JARVIS bot");
    }

    request.log.info({ clerkId: userId }, "[STEP1] Step 1 complete");
    return { success: true, data: { onboardingStep: 1 } };
  });

  // POST /onboarding/step/2 — Payment method selection
  app.post("/api/onboarding/step/2", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = request.body as { method?: "sdk" | "stripe_card" };

    request.log.info({ clerkId: userId, method: body.method }, "[STEP2] Payment method selection");

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    if (user.onboardingStep < 1) {
      return reply.status(400).send({ success: false, error: "Complete step 1 first" });
    }

    // If stripe_card, verify card was actually saved
    if (body.method === "stripe_card") {
      const pm = await prisma.paymentMethod.findFirst({
        where: { userId: user.id, provider: "STRIPE", status: "CONNECTED" },
      });
      if (!pm) {
        return reply.status(400).send({ success: false, error: "No Stripe card connected. Add a card first." });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardingStep: 2 },
    });

    request.log.info({ clerkId: userId }, "[STEP2] Step 2 complete");
    return { success: true, data: { onboardingStep: 2 } };
  });

  // POST /onboarding/step/3 — Select integrations (providers)
  app.post("/api/onboarding/step/3", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = request.body as {
      skipped?: boolean;
      integrations?: Array<{ provider: string; category: string }>;
    };

    request.log.info({ clerkId: userId, skipped: body.skipped, count: body.integrations?.length ?? 0 }, "[STEP3] Integrations selection");

    const user = await prisma.user.findUnique({ where: { clerkId: userId }, include: { bots: { take: 1 } } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    if (user.onboardingStep < 2) {
      request.log.warn({ clerkId: userId, currentStep: user.onboardingStep }, "[STEP3] Step 2 not completed");
      return reply.status(400).send({ success: false, error: "Complete step 2 first" });
    }

    // Save selected integrations to the user's first bot
    if (!body.skipped && body.integrations && body.integrations.length > 0 && user.bots.length > 0) {
      const botId = user.bots[0].id;
      for (const item of body.integrations) {
        await prisma.botIntegration.upsert({
          where: { botId_provider: { botId, provider: item.provider } },
          create: {
            botId,
            provider: item.provider,
            category: item.category,
            enabled: true,
          },
          update: {
            enabled: true,
            category: item.category,
          },
        });
      }
      request.log.info({ clerkId: userId, botId, integrations: body.integrations.map(i => i.provider) }, "[STEP3] Integrations saved");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardingStep: 3 },
    });

    request.log.info({ clerkId: userId }, "[STEP3] Step 3 complete");
    return { success: true, data: { onboardingStep: 3 } };
  });

  // POST /onboarding/step/4 — Payment method choice
  app.post("/api/onboarding/step/4", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = request.body as { method: "sdk" | "stripe_card" };

    request.log.info({ clerkId: userId, method: body.method }, "[STEP4] Payment method selection");

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    if (user.onboardingStep < 3) {
      request.log.warn({ clerkId: userId, currentStep: user.onboardingStep }, "[STEP4] Step 3 not completed");
      return reply.status(400).send({ success: false, error: "Complete step 3 first" });
    }

    if (body.method === "stripe_card") {
      const pm = await prisma.paymentMethod.findFirst({
        where: { userId: user.id, provider: "STRIPE", status: "CONNECTED" },
      });
      if (!pm) {
        request.log.warn({ clerkId: userId }, "[STEP4] Stripe card not connected");
        return reply.status(400).send({ success: false, error: "No Stripe card connected. Add a card first." });
      }
      request.log.info({ clerkId: userId, paymentMethodId: pm.id }, "[STEP4] Stripe card verified");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { onboardingStep: 4 },
    });

    request.log.info({ clerkId: userId }, "[STEP4] Step 4 complete");
    return { success: true, data: { onboardingStep: 4 } };
  });

  // POST /onboarding/step/5 — Accept terms and complete onboarding
  app.post("/api/onboarding/step/5", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    request.log.info({ clerkId: userId }, "[STEP5] Accept terms request");

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });
    if (user.onboardingStep < 4) {
      request.log.warn({ clerkId: userId, currentStep: user.onboardingStep }, "[STEP5] Step 4 not completed");
      return reply.status(400).send({ success: false, error: "Complete step 4 first" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        onboardingStep: 6,
        status: "ACTIVE",
        kycLevel: "VERIFIED",
        termsAcceptedAt: new Date(),
      },
    });

    // Auto-assign user to an OpenClaw instance
    let instanceAssignment: { instanceName?: string; port?: number; error?: string } = {};
    try {
      const { assignUserToInstance } = await import("../services/instance-manager.js");
      const result = await assignUserToInstance(user.id);
      if (result.success) {
        instanceAssignment = { instanceName: result.instanceName, port: result.port };
        request.log.info({ userId: user.id, instance: result.instanceName }, "[STEP5] User assigned to OpenClaw instance");
      } else {
        instanceAssignment = { error: result.error };
        request.log.warn({ userId: user.id, error: result.error }, "[STEP5] Failed to assign instance");
      }
    } catch (err) {
      request.log.error({ err }, "[STEP5] Instance assignment error");
    }

    await createAuditLog({
      entityType: "user",
      entityId: user.id,
      action: "user.onboarding_completed",
      actorType: "user",
      actorId: user.id,
      payload: { termsAcceptedAt: new Date().toISOString(), instanceAssignment },
      ipAddress: request.ip,
    });

    request.log.info({ clerkId: userId, userId: user.id }, "[STEP5] Onboarding COMPLETED — user is now ACTIVE");
    return { success: true, data: { onboardingStep: 6, status: "ACTIVE", instance: instanceAssignment } };
  });

  // ─────────────────────────────────────────
  // TELEGRAM BOT TOKEN MANAGEMENT
  // ─────────────────────────────────────────

  // POST /api/bots/:botId/telegram/connect — Validate & save user's Telegram bot token
  app.post("/api/bots/:botId/telegram/connect", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };
    const { telegramBotToken } = request.body as { telegramBotToken: string };

    if (!telegramBotToken || typeof telegramBotToken !== "string" || !telegramBotToken.trim()) {
      return reply.status(400).send({ success: false, error: "telegramBotToken is required" });
    }

    const token = telegramBotToken.trim();

    // Verify bot ownership
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    // Validate token by calling Telegram getMe
    let telegramBot: { id: number; is_bot: boolean; first_name: string; username?: string };
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const getMeData = await getMeRes.json() as { ok: boolean; result?: typeof telegramBot; description?: string };

      if (!getMeData.ok || !getMeData.result) {
        request.log.warn({ botId }, "[TELEGRAM] Invalid bot token — getMe failed");
        return reply.status(400).send({
          success: false,
          error: getMeData.description || "Invalid Telegram Bot Token. Please check and try again.",
        });
      }
      telegramBot = getMeData.result;
    } catch (err) {
      request.log.error(err, "[TELEGRAM] Failed to reach Telegram API");
      return reply.status(502).send({ success: false, error: "Could not reach Telegram API. Try again later." });
    }

    // Set webhook pointing to PayJarvis
    const webhookUrl = `https://www.payjarvis.com/api/bots/${botId}/telegram/webhook`;
    const webhookSecret = randomBytes(32).toString("hex");

    try {
      const setWebhookRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: webhookSecret,
          allowed_updates: ["message", "callback_query"],
        }),
      });
      const webhookData = await setWebhookRes.json() as { ok: boolean; description?: string };

      if (!webhookData.ok) {
        request.log.warn({ botId, error: webhookData.description }, "[TELEGRAM] setWebhook failed");
        return reply.status(400).send({
          success: false,
          error: `Failed to set webhook: ${webhookData.description || "Unknown error"}`,
        });
      }
    } catch (err) {
      request.log.error(err, "[TELEGRAM] setWebhook request failed");
      return reply.status(502).send({ success: false, error: "Could not set Telegram webhook. Try again later." });
    }

    // Save token and bot info in BotIntegration
    const config = {
      telegramBotToken: token,
      telegramBotId: telegramBot.id,
      telegramBotUsername: telegramBot.username || null,
      telegramBotName: telegramBot.first_name,
      webhookUrl,
      webhookSecret,
      connectedAt: new Date().toISOString(),
    };

    await prisma.botIntegration.upsert({
      where: { botId_provider: { botId, provider: "telegram_bot" } },
      create: {
        botId,
        provider: "telegram_bot",
        category: "messaging",
        enabled: true,
        connectedAt: new Date(),
        config,
      },
      update: {
        enabled: true,
        connectedAt: new Date(),
        config,
      },
    });

    await createAuditLog({
      entityType: "bot",
      entityId: botId,
      action: "bot.telegram_connected",
      actorType: "user",
      actorId: user.id,
      payload: { telegramBotUsername: telegramBot.username, telegramBotId: telegramBot.id },
      ipAddress: request.ip,
    });

    request.log.info({ botId, telegramUsername: telegramBot.username }, "[TELEGRAM] Bot token saved and webhook configured");

    return {
      success: true,
      data: {
        username: telegramBot.username,
        name: telegramBot.first_name,
        botId: telegramBot.id,
        webhookUrl,
      },
    };
  });

  // GET /api/bots/:botId/telegram/status — Check Telegram bot connection status
  app.get("/api/bots/:botId/telegram/status", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const integration = await prisma.botIntegration.findUnique({
      where: { botId_provider: { botId, provider: "telegram_bot" } },
    });

    if (!integration || !integration.enabled || !integration.config) {
      return { success: true, data: { connected: false } };
    }

    const config = integration.config as Record<string, unknown>;
    return {
      success: true,
      data: {
        connected: true,
        username: config.telegramBotUsername || null,
        name: config.telegramBotName || null,
        connectedAt: integration.connectedAt?.toISOString() || null,
      },
    };
  });

  // POST /api/bots/:botId/telegram/disconnect — Remove Telegram bot token
  app.post("/api/bots/:botId/telegram/disconnect", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const { botId } = request.params as { botId: string };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    const bot = await prisma.bot.findFirst({ where: { id: botId, ownerId: user.id } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const integration = await prisma.botIntegration.findUnique({
      where: { botId_provider: { botId, provider: "telegram_bot" } },
    });

    if (integration?.config) {
      const config = integration.config as Record<string, unknown>;
      const token = config.telegramBotToken as string;

      // Remove webhook from Telegram
      if (token) {
        try {
          await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
        } catch {
          // Non-critical — webhook will just stop receiving
        }
      }
    }

    if (integration) {
      await prisma.botIntegration.update({
        where: { id: integration.id },
        data: { enabled: false, config: Prisma.DbNull },
      });
    }

    await createAuditLog({
      entityType: "bot",
      entityId: botId,
      action: "bot.telegram_disconnected",
      actorType: "user",
      actorId: user.id,
      ipAddress: request.ip,
    });

    request.log.info({ botId }, "[TELEGRAM] Bot token removed");
    return { success: true };
  });

  // POST /api/bots/:botId/telegram/webhook — Receive updates from user's Telegram bot
  app.post("/api/bots/:botId/telegram/webhook", async (request, reply) => {
    const { botId } = request.params as { botId: string };

    // Look up the bot's Telegram integration to validate the secret
    const integration = await prisma.botIntegration.findUnique({
      where: { botId_provider: { botId, provider: "telegram_bot" } },
    });

    if (!integration || !integration.enabled || !integration.config) {
      return reply.status(404).send({ success: false, error: "Telegram not configured for this bot" });
    }

    const config = integration.config as Record<string, unknown>;
    const expectedSecret = config.webhookSecret as string;

    // Validate webhook secret
    const receivedSecret = request.headers["x-telegram-bot-api-secret-token"] as string;
    if (expectedSecret && receivedSecret !== expectedSecret) {
      request.log.warn({ botId }, "[TELEGRAM:WEBHOOK] Invalid secret token");
      return reply.status(403).send({ success: false, error: "Invalid secret" });
    }

    const update = request.body as Record<string, unknown>;
    request.log.info({ botId, updateId: (update as any)?.update_id }, "[TELEGRAM:WEBHOOK] Received update");

    // Extract message from update
    const message = (update.message ?? update.edited_message) as Record<string, unknown> | undefined;
    if (!message || !message.text || !message.chat) {
      // Non-text update (photo, sticker, etc.) — acknowledge silently
      return { ok: true };
    }

    const chatId = String((message.chat as Record<string, unknown>).id);
    const text = String(message.text);
    const botToken = config.telegramBotToken as string;

    if (!botToken) {
      request.log.error({ botId }, "[TELEGRAM:WEBHOOK] No bot token in integration config");
      return { ok: true };
    }

    // Look up bot + owner for personalized AI prompt
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      include: { owner: { select: { fullName: true, country: true } } },
    });

    const fromUser = (message.from as Record<string, unknown> | undefined);
    const firstName = fromUser?.first_name ? String(fromUser.first_name) : undefined;
    const userLangCode = fromUser?.language_code ? String(fromUser.language_code) : undefined;

    // Bot display name: custom > bot name in DB > Telegram username from integration > generic
    const telegramUsername = config.telegramBotUsername as string | undefined;
    const botDisplayName = bot?.botDisplayName || bot?.name || (telegramUsername ? `@${telegramUsername}` : "Assistant");
    const botCaps = bot?.capabilities || [];
    // Bot language: configured > infer from Telegram user's language > default english
    const botLang = bot?.language || userLangCode || "en";

    // Handle /start command — welcome message without AI
    if (text.trim() === "/start") {
      let welcome: string;
      if (botCaps.length > 0) {
        const capsList = botCaps.map(c => `  - ${c}`).join("\n");
        welcome = botLang.startsWith("es")
          ? `¡Hola${firstName ? ` ${firstName}` : ""}! 👋\n\nSoy ${botDisplayName}, tu asistente personal.\n\n🔒 Tus datos están protegidos con encriptación Zero-Knowledge. Ni siquiera nosotros podemos verlos.\n\nPuedo ayudarte con:\n${capsList}\n\n¡Solo envíame un mensaje y comencemos!`
          : `Hi${firstName ? ` ${firstName}` : ""}! 👋\n\nI'm ${botDisplayName}, your personal assistant.\n\n🔒 Your data is protected with Zero-Knowledge encryption. Not even we can see it.\n\nI can help you with:\n${capsList}\n\nJust send me a message and let's get started!`;
      } else {
        welcome = botLang.startsWith("es")
          ? `¡Hola${firstName ? ` ${firstName}` : ""}! 👋\n\nSoy ${botDisplayName}.\n\n🔒 Tus datos están protegidos con encriptación Zero-Knowledge.\n\n¡Envíame un mensaje y conversemos!`
          : `Hi${firstName ? ` ${firstName}` : ""}! 👋\n\nI'm ${botDisplayName}.\n\n🔒 Your data is protected with Zero-Knowledge encryption.\n\nSend me a message and let's chat!`;
      }

      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: welcome }),
        });
        request.log.info({ botId, chatId, firstName }, "[TELEGRAM:WEBHOOK] Welcome message sent");
      } catch (err) {
        request.log.error(err, "[TELEGRAM:WEBHOOK] Failed to send welcome");
      }
      return { ok: true };
    }

    // Send "typing" indicator so user knows bot is processing
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, action: "typing" }),
      });
    } catch { /* non-blocking */ }

    // Process the message through the AI engine
    try {
      const geminiResult = await chatWithGemini(chatId, text, {
        botId,
        ownerName: bot?.owner?.fullName || undefined,
        botName: botDisplayName,
        systemPrompt: bot?.systemPrompt || undefined,
        capabilities: botCaps,
        language: botLang,
        amazonDomain: getAmazonDomain(bot?.owner?.country),
      });

      // Handle function calls from Gemini
      if (geminiResult.functionCall) {
        const fc = geminiResult.functionCall;
        let confirmationMsg: string;

        if (fc.name === "save_store_credentials") {
          const args = fc.args as { store_name: string; email: string; password: string };
          const { provider, displayName, known } = normalizeStoreName(args.store_name);

          // Find the bot owner's userId for vault storage
          const ownerUserId = bot?.ownerId;
          if (!ownerUserId) {
            confirmationMsg = "Could not save credentials — user not found.";
          } else {
            await saveStoreCredentials({
              userId: ownerUserId,
              provider,
              email: args.email,
              password: args.password,
              storeName: displayName,
            });

            const lang = botLang;
            const disclaimer_en = `\n\n🔐 *Privacy notice:* Your credentials are encrypted with AES-256 and stored securely. You can delete them anytime by saying "remove my ${displayName} login". See payjarvis.com/privacy for details.`;
            const disclaimer_pt = `\n\n🔐 *Aviso de privacidade:* Suas credenciais são criptografadas com AES-256 e armazenadas com segurança. Você pode deletá-las a qualquer momento dizendo "remover meu login da ${displayName}". Veja payjarvis.com/privacy para detalhes.`;
            const disclaimer_es = `\n\n🔐 *Aviso de privacidad:* Tus credenciales están cifradas con AES-256 y almacenadas de forma segura. Puedes eliminarlas en cualquier momento diciendo "eliminar mi login de ${displayName}". Consulta payjarvis.com/privacy.`;
            if (lang.startsWith("pt")) {
              confirmationMsg = known
                ? `✅ ${displayName} credentials saved successfully in your Account Vault! I can now shop and search on ${displayName} for you.` + disclaimer_pt
                : `✅ Saved your "${displayName}" credentials as generic login. When we add official support, it will already be set up!` + disclaimer_pt;
            } else if (lang.startsWith("es")) {
              confirmationMsg = known
                ? `✅ Credenciales de ${displayName} guardadas en tu Account Vault. Ahora puedo hacer compras en ${displayName} por ti.` + disclaimer_es
                : `✅ Guardé tus credenciales de "${displayName}" como login genérico.` + disclaimer_es;
            } else {
              confirmationMsg = known
                ? `✅ ${displayName} credentials saved to your Account Vault! I can now shop and search ${displayName} for you.` + disclaimer_en
                : `✅ Saved your "${displayName}" credentials as a generic login. When we add official support, you'll be all set!` + disclaimer_en;
            }
          }
        } else if (fc.name === "remove_store_credentials") {
          const args = fc.args as { store_name: string };
          const { provider, displayName } = normalizeStoreName(args.store_name);
          const ownerUserId = bot?.ownerId;

          if (ownerUserId) {
            await deleteStoreCredentials(ownerUserId, provider);
          }

          const lang = botLang;
          confirmationMsg = lang.startsWith("pt")
            ? `✅ Login da ${displayName} removido com sucesso.`
            : lang.startsWith("es")
            ? `✅ Login de ${displayName} eliminado.`
            : `✅ ${displayName} login removed successfully.`;
        } else if (fc.name === "amazon_search") {
          const args = fc.args as { query: string; max_results?: number };
          const { searchAmazon } = await import("../services/amazon/search.service.js");
          const amazonDomain = getAmazonDomain(bot?.owner?.country) || "amazon.com";
          const products = await searchAmazon(args.query, amazonDomain, args.max_results ?? 3);

          if (products.length === 0) {
            confirmationMsg = botLang.startsWith("pt")
              ? `Não encontrei produtos para "${args.query}" na Amazon. Tente outra busca.`
              : `No products found for "${args.query}" on Amazon. Try a different search.`;
          } else {
            // Format products with links
            const lines = products.map((p, i) => {
              const stars = p.rating ? ` ⭐ ${p.rating}` : "";
              const reviews = p.reviewCount ? ` (${p.reviewCount})` : "";
              const prime = p.prime ? " 🚀 Prime" : "";
              return `${i + 1}. *${p.title}*\n💰 ${p.price || "Price not available"}${stars}${reviews}${prime}\n👉 ${p.url}`;
            });

            const header = botLang.startsWith("pt")
              ? `🛒 Encontrei ${products.length} produto(s) para "${args.query}":\n\n`
              : `🛒 Found ${products.length} product(s) for "${args.query}":\n\n`;
            const footer = botLang.startsWith("pt")
              ? `\n\n_Clique no link para comprar direto na Amazon._`
              : `\n\n_Click the link to buy directly on Amazon._`;

            confirmationMsg = header + lines.join("\n\n") + footer;

            // Send top product image
            const topProduct = products[0];
            if (topProduct.imageUrl) {
              try {
                await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    photo: topProduct.imageUrl,
                    caption: `⭐ ${topProduct.title?.slice(0, 100)}\n💰 ${topProduct.price}\n👉 ${topProduct.url}`,
                  }),
                });
              } catch { /* image optional */ }
            }
          }
        } else if (fc.name === "share_bot") {
          const args = fc.args as { channel?: string };
          const channel = (args.channel || "telegram").toLowerCase();
          const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
          const platformForApi = channel === "telegram" ? "telegram" : "whatsapp";

          try {
            const shareRes = await fetch(
              `${process.env.WEB_URL || "https://www.payjarvis.com"}/api/bots/${botId}/share/generate?telegramId=${chatId}&platform=${platformForApi}`,
              {
                headers: { "x-internal-secret": INTERNAL_SECRET },
                signal: AbortSignal.timeout(10_000),
              },
            );
            const shareData = (await shareRes.json()) as { success: boolean; data?: any; error?: string };

            if (!shareData.success || !shareData.data) {
              confirmationMsg = botLang.startsWith("pt")
                ? `❌ Não consegui gerar o link. Tente novamente.`
                : `❌ Could not generate share link. Try again.`;
            } else {
              const { code, qrCodeBase64 } = shareData.data;
              const botUsername = (config as any).telegramBotUsername || "Jarvis12Brain_bot";
              let link: string;
              if (channel === "telegram") {
                link = `https://t.me/${botUsername}?start=${code}`;
              } else if (channel === "whatsapp_br") {
                link = `https://wa.me/17547145921?text=${encodeURIComponent("START " + code)}`;
              } else {
                link = `https://wa.me/17547145921?text=${encodeURIComponent("START " + code)}`;
              }

              // Send QR code as photo
              if (qrCodeBase64) {
                try {
                  const base64Data = qrCodeBase64.replace(/^data:image\/png;base64,/, "");
                  const qrBuffer = Buffer.from(base64Data, "base64");
                  const FormData = (await import("node:buffer")).Buffer;
                  // Send via multipart (Telegram requires file upload for buffer)
                  const boundary = "----FormBoundary" + Date.now();
                  const body = [
                    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`,
                    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n📱 QR Code para indicar amigo!\n\nOu envie o link: ${link}`,
                    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="qrcode.png"\r\nContent-Type: image/png\r\n\r\n`,
                  ].join("\r\n");
                  const bodyEnd = `\r\n--${boundary}--\r\n`;
                  const bodyBuffer = Buffer.concat([Buffer.from(body), qrBuffer, Buffer.from(bodyEnd)]);

                  await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
                    method: "POST",
                    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
                    body: bodyBuffer,
                  });
                } catch (qrErr) {
                  request.log.error(qrErr, "[SHARE] QR send failed");
                }
              }

              confirmationMsg = botLang.startsWith("pt")
                ? `🔗 Link de indicação:\n${link}\n\nQuando seu amigo clicar, o bot vai recepcionar automaticamente! 🎉`
                : `🔗 Referral link:\n${link}\n\nWhen your friend clicks, the bot will welcome them automatically! 🎉`;
            }
          } catch (err) {
            confirmationMsg = botLang.startsWith("pt")
              ? `❌ Erro ao gerar link. Tente novamente.`
              : `❌ Error generating link. Try again.`;
          }
        } else {
          confirmationMsg = geminiResult.text || "Done.";
        }

        // Send confirmation
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: confirmationMsg, parse_mode: "Markdown", disable_web_page_preview: false }),
        });

        // Security: delete the user's message that contained the password
        if (fc.name === "save_store_credentials") {
          const messageId = (message as any).message_id;
          if (messageId) {
            try {
              await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
              });
              // Notify user about deletion
              const deletionNote = botLang.startsWith("pt")
                ? "🔒 Your message with the password was deleted for security."
                : botLang.startsWith("es")
                ? "🔒 Tu mensaje con la contraseña fue eliminado por seguridad."
                : "🔒 Your message containing the password was deleted for security.";
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: deletionNote }),
              });
            } catch {
              // Bot may not have permission to delete messages — that's OK
            }
          }
        }

        request.log.info({ botId, chatId, functionCall: fc.name, store: (fc.args as Record<string, unknown>).store_name }, "[TELEGRAM:WEBHOOK] Function call executed");
        return { ok: true };
      }

      // Regular text response (no function call)
      const aiResponse = geminiResult.text;

      const sendRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: aiResponse,
          parse_mode: "Markdown",
        }),
      });

      if (!sendRes.ok) {
        const errBody = await sendRes.text();
        request.log.error({ botId, chatId, error: errBody }, "[TELEGRAM:WEBHOOK] Failed to send reply");

        // Retry without parse_mode in case Markdown broke
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: aiResponse,
          }),
        });
      } else {
        request.log.info({ botId, chatId }, "[TELEGRAM:WEBHOOK] Reply sent");
      }
    } catch (err) {
      request.log.error(err, "[TELEGRAM:WEBHOOK] Error processing message");
    }

    return { ok: true };
  });

  // ─────────────────────────────────────────
  // BOT INTEGRATIONS MANAGEMENT (dashboard)
  // ─────────────────────────────────────────

  // GET /api/integrations/available — list all providers with server-side availability
  app.get("/api/integrations/available", { preHandler: [requireAuth] }, async () => {
    const providers = [
      { provider: "amadeus", label: "Amadeus", description: "Flights & Hotels", category: "travel", envKey: "AMADEUS_CLIENT_ID" },
      { provider: "airbnb", label: "Airbnb", description: "Vacation Rentals", category: "travel", envKey: "" },
      { provider: "yelp", label: "Yelp", description: "Restaurant Search", category: "restaurants", envKey: "YELP_API_KEY" },
      { provider: "opentable", label: "OpenTable", description: "Reservations", category: "restaurants", envKey: "OPENTABLE_CLIENT_ID" },
      { provider: "ticketmaster", label: "Ticketmaster", description: "Events & Tickets", category: "events", envKey: "TICKETMASTER_API_KEY" },
      { provider: "stubhub", label: "StubHub", description: "Resale Tickets", category: "events", envKey: "" },
      { provider: "amazon", label: "Amazon", description: "Products", category: "marketplace", envKey: "__always__" },
      { provider: "mercado_livre", label: "Mercado Livre", description: "Products", category: "marketplace", envKey: "" },
      { provider: "uber", label: "Uber", description: "Rides", category: "transport", envKey: "UBER_CLIENT_ID" },
      { provider: "lyft", label: "Lyft", description: "Rides", category: "transport", envKey: "" },
      { provider: "uber_eats", label: "Uber Eats", description: "Food Delivery", category: "delivery", envKey: "" },
      { provider: "doordash", label: "DoorDash", description: "Food Delivery", category: "delivery", envKey: "" },
      { provider: "ifood", label: "iFood", description: "Food Delivery (BR/LATAM)", category: "delivery", envKey: "IFOOD_CLIENT_ID" },
    ];

    const data = providers.map((p) => ({
      provider: p.provider,
      label: p.label,
      description: p.description,
      category: p.category,
      available: p.envKey === "__always__" ? true : p.envKey ? !!process.env[p.envKey] : false,
    }));

    return { success: true, data };
  });

  // GET /bots/:botId/integrations — list integrations for a bot
  app.get("/api/bots/:botId/integrations", { preHandler: [requireAuth] }, async (request, reply) => {
    const { botId } = request.params as { botId: string };
    const userId = (request as any).userId as string;

    const bot = await prisma.bot.findFirst({ where: { id: botId, owner: { clerkId: userId } } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const integrations = await prisma.botIntegration.findMany({ where: { botId } });
    return { success: true, data: integrations };
  });

  // POST /bots/:botId/integrations/toggle — toggle a single provider
  app.post("/api/bots/:botId/integrations/toggle", { preHandler: [requireAuth] }, async (request, reply) => {
    const { botId } = request.params as { botId: string };
    const userId = (request as any).userId as string;
    const body = request.body as { provider: string; category: string; enabled: boolean };

    if (!body.provider) {
      return reply.status(400).send({ success: false, error: "provider is required" });
    }

    const bot = await prisma.bot.findFirst({ where: { id: botId, owner: { clerkId: userId } } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    const integration = await prisma.botIntegration.upsert({
      where: { botId_provider: { botId, provider: body.provider } },
      create: {
        botId,
        provider: body.provider,
        category: body.category || "other",
        enabled: body.enabled,
        connectedAt: body.enabled ? new Date() : null,
      },
      update: {
        enabled: body.enabled,
        connectedAt: body.enabled ? new Date() : null,
      },
    });

    return { success: true, data: integration };
  });

  // PUT /bots/:botId/integrations — bulk update integrations
  app.put("/api/bots/:botId/integrations", { preHandler: [requireAuth] }, async (request, reply) => {
    const { botId } = request.params as { botId: string };
    const userId = (request as any).userId as string;
    const body = request.body as { integrations: Array<{ provider: string; category: string; enabled: boolean }> };

    const bot = await prisma.bot.findFirst({ where: { id: botId, owner: { clerkId: userId } } });
    if (!bot) return reply.status(404).send({ success: false, error: "Bot not found" });

    for (const item of body.integrations) {
      await prisma.botIntegration.upsert({
        where: { botId_provider: { botId, provider: item.provider } },
        create: { botId, provider: item.provider, category: item.category, enabled: item.enabled },
        update: { enabled: item.enabled, category: item.category },
      });
    }

    const integrations = await prisma.botIntegration.findMany({ where: { botId } });
    return { success: true, data: integrations };
  });

  // ─────────────────────────────────────────
  // JARVIS ACTIVATION (deep link flow)
  // ─────────────────────────────────────────

  // POST /api/onboarding/generate-link — Generate Telegram deep link code
  app.post("/api/onboarding/generate-link", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const body = request.body as { approvalThreshold?: number };

    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    // Update threshold
    if (body.approvalThreshold !== undefined) {
      await prisma.user.update({
        where: { id: user.id },
        data: { approvalThreshold: body.approvalThreshold },
      });
    }

    // Generate or refresh link code (reuse TelegramLinkCode table)
    const code = `act_${randomBytes(16).toString("hex")}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await prisma.telegramLinkCode.upsert({
      where: { userId: user.id },
      create: { userId: user.id, code, expiresAt },
      update: { code, expiresAt },
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "Jarvis12Brain_bot";
    const url = `https://t.me/${botUsername}?start=${code}`;

    request.log.info({ clerkId: userId, code }, "[LINK] Activation link generated");
    return { success: true, data: { url, code, expiresAt: expiresAt.toISOString() } };
  });

  // GET /api/onboarding/activation-status — Poll whether Telegram was connected
  app.get("/api/onboarding/activation-status", { preHandler: [requireAuth] }, async (request) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { telegramChatId: true, onboardingCompleted: true, botActivatedAt: true },
    });

    return {
      success: true,
      data: {
        connected: !!user?.telegramChatId,
        activated: !!user?.botActivatedAt,
      },
    };
  });

  // POST /api/onboarding/complete-activation — Called by OpenClaw when user clicks deep link
  app.post("/api/onboarding/complete-activation", async (request, reply) => {
    const body = request.body as { code: string; telegramId: string; name?: string };

    if (!body.code || !body.telegramId) {
      return reply.status(400).send({ success: false, error: "code and telegramId are required" });
    }

    const linkCode = await prisma.telegramLinkCode.findUnique({ where: { code: body.code } });
    if (!linkCode) {
      return reply.status(404).send({ success: false, error: "Invalid activation code" });
    }
    if (linkCode.expiresAt < new Date()) {
      return reply.status(410).send({ success: false, error: "Activation code expired" });
    }

    // Activate the user
    await prisma.user.update({
      where: { id: linkCode.userId },
      data: {
        telegramChatId: body.telegramId,
        onboardingCompleted: true,
        botActivatedAt: new Date(),
        onboardingStep: 4,
        status: "ACTIVE",
      },
    });

    // Delete used code
    await prisma.telegramLinkCode.delete({ where: { id: linkCode.id } });

    request.log.info({ userId: linkCode.userId, telegramId: body.telegramId }, "[ACTIVATE] Deep link activation complete");
    return { success: true };
  });

  // GET /api/users/telegram/:telegramId — Resolve user info by Telegram ID
  app.get("/api/users/telegram/:telegramId", async (request, reply) => {
    const { telegramId } = request.params as { telegramId: string };

    const user = await prisma.user.findFirst({
      where: { telegramChatId: telegramId },
      select: {
        fullName: true,
        email: true,
        approvalThreshold: true,
        onboardingCompleted: true,
        botActivatedAt: true,
        bots: { take: 1, select: { id: true, name: true } },
      },
    });

    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    return {
      success: true,
      data: {
        name: user.fullName,
        email: user.email,
        approvalThreshold: user.approvalThreshold,
        onboardingCompleted: user.onboardingCompleted,
        botActivatedAt: user.botActivatedAt,
        botId: user.bots[0]?.id ?? null,
        botName: user.bots[0]?.name ?? null,
      },
    };
  });
}
