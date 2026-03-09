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
}
