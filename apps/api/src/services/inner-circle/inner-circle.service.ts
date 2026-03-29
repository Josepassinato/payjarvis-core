/**
 * Inner Circle — Specialist referral network.
 *
 * Jarvis "knows" experts in various areas and introduces them
 * like a well-connected friend — NEVER like an ad.
 *
 * Detection is intent-based, not just keyword matching.
 * Respects cooldowns, decline signals, and daily limits.
 */

import { prisma } from "@payjarvis/database";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { redisGet, redisSet } from "../redis.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const COOLDOWN_HOURS = 24;
const MAX_INTROS_PER_DAY = 2;
const DECLINE_COOLDOWN_DAYS = 7;

// ─── Types ───

interface SpecialistMatch {
  specialist: {
    id: string;
    name: string;
    slug: string;
    expertise: string;
    bio: string;
    credentials: string;
    instagram: string | null;
    website: string | null;
    contactLink: string | null;
    freeServices: string[];
    premiumServices: string[];
    introMessage: string;
    aiKnowledgePrompt: string;
    maxFreePerUser: number;
  };
  confidence: number;
  matchedContext: string;
}

// ─── Detection ───

/**
 * Detect if the user's message reveals a need that an Inner Circle
 * specialist can address. Returns the best match or null.
 *
 * Anti-intrusion rules:
 * - No intro if user is mid-task (shopping, searching, booking)
 * - No intro if same specialist shown in last 24h
 * - No intro if user declined in last 7 days
 * - No intro if already 2+ intros today
 * - No intro on first message of the day (let user settle)
 */
export async function detectNeed(
  userId: string,
  message: string,
  recentMessages: string[] = [],
  userFacts: Record<string, string> = {}
): Promise<SpecialistMatch | null> {
  // 1. Check daily limit
  const todayKey = `ic:daily:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const todayCountRaw = await redisGet(todayKey);
  const todayCount = parseInt(todayCountRaw || "0", 10);
  if (todayCount >= MAX_INTROS_PER_DAY) return null;

  // 2. Check first-message-of-day (let user settle)
  const firstMsgKey = `ic:first:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const isFirstMsg = !(await redisGet(firstMsgKey));
  if (isFirstMsg) {
    await redisSet(firstMsgKey, "1", 86400);
    return null;
  }

  // 3. Get active specialists
  const specialists = await prisma.innerCircleSpecialist.findMany({
    where: { active: true },
  });
  if (specialists.length === 0) return null;

  // 4. Check mid-task (skip if user is doing something else)
  const midTaskPatterns = /\b(buy|compra|checkout|search|busca|reserv|book|track|rastre|pag|payment|butler|vault)\b/i;
  if (midTaskPatterns.test(message)) return null;

  // 5. Get declined specialists (last 7 days)
  const declineWindow = new Date(Date.now() - DECLINE_COOLDOWN_DAYS * 86_400_000);
  const declined = await prisma.innerCircleInteraction.findMany({
    where: { userId, type: "declined", createdAt: { gte: declineWindow } },
    select: { specialistId: true },
  });
  const declinedIds = new Set(declined.map(d => d.specialistId));

  // 6. Check cooldown per specialist (24h)
  const cooldownWindow = new Date(Date.now() - COOLDOWN_HOURS * 3_600_000);
  const recentIntros = await prisma.innerCircleInteraction.findMany({
    where: {
      userId,
      type: { in: ["intro_shown", "free_consultation"] },
      createdAt: { gte: cooldownWindow },
    },
    select: { specialistId: true },
  });
  const cooldownIds = new Set(recentIntros.map(r => r.specialistId));

  // 7. Keyword + intent matching
  const messageLower = message.toLowerCase();
  const contextStr = recentMessages.slice(-3).join(" ").toLowerCase();

  for (const spec of specialists) {
    if (declinedIds.has(spec.id) || cooldownIds.has(spec.id)) continue;

    // Check free consultation limit
    const freeCount = await prisma.innerCircleInteraction.count({
      where: { userId, specialistId: spec.id, type: "free_consultation" },
    });
    if (freeCount >= spec.maxFreePerUser) continue;

    const keywords: string[] = JSON.parse(spec.triggerKeywords);
    const hasKeyword = keywords.some(k => messageLower.includes(k.toLowerCase()));

    if (!hasKeyword) continue;

    // 8. Validate intent with Gemini (avoid false positives)
    const confidence = await validateIntent(message, contextStr, spec.expertise);
    if (confidence >= 0.7) {
      return {
        specialist: {
          ...spec,
          freeServices: JSON.parse(spec.freeServices),
          premiumServices: JSON.parse(spec.premiumServices),
        },
        confidence,
        matchedContext: message.substring(0, 100),
      };
    }
  }

  return null;
}

/**
 * Use Gemini to validate if the user genuinely needs this specialist.
 * Returns confidence 0-1.
 */
async function validateIntent(message: string, context: string, expertise: string): Promise<number> {
  if (!GEMINI_API_KEY) return 0.5; // Can't validate, use keyword only

  const cached = await redisGet(`ic:intent:${Buffer.from(message).toString("base64").slice(0, 40)}`);
  if (cached) return parseFloat(cached);

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are analyzing if a user genuinely needs help from an expert in "${expertise}".

User's message: "${message}"
Recent context: "${context}"

Does this user have a GENUINE need for this expertise? Not just a passing mention.
Reply ONLY with a number between 0.0 and 1.0 representing confidence.
0.0 = no need at all, 1.0 = clearly needs this expert.
Examples: "que roupa uso pro casamento?" → 0.95 | "comprei uma camisa azul" → 0.2 | "preciso mudar meu visual" → 0.9

Reply ONLY the number, nothing else.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const conf = Math.min(1, Math.max(0, parseFloat(text) || 0));

    await redisSet(`ic:intent:${Buffer.from(message).toString("base64").slice(0, 40)}`, String(conf), 3600);
    return conf;
  } catch {
    return 0.5;
  }
}

// ─── Introduction Generator ───

/**
 * Generate a friend-style introduction message.
 * Uses the specialist's introMessage template + personalizes with Gemini.
 */
export async function generateIntroduction(
  specialist: SpecialistMatch["specialist"],
  context: { userName: string; message: string; language: string }
): Promise<string> {
  if (!GEMINI_API_KEY) {
    // Fallback: use template directly
    return specialist.introMessage
      .replace("{userName}", context.userName)
      .replace("{expertise}", specialist.expertise);
  }

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const lang = context.language === "pt" ? "Portuguese" : context.language === "es" ? "Spanish" : "English";

    const prompt = `You are Jarvis 🦀, a personal AI assistant. You're about to introduce your user to someone from your "Inner Circle" — a specialist you personally know and trust.

Specialist: ${specialist.name}
Expertise: ${specialist.expertise}
Credentials: ${specialist.credentials}
Instagram: ${specialist.instagram || "N/A"}
Contact: ${specialist.contactLink || specialist.website || "DM on Instagram"}

User's name: ${context.userName}
What they said: "${context.message}"
Language: ${lang}

Introduction template (adapt but keep the spirit):
${specialist.introMessage}

RULES:
- Sound like a FRIEND introducing another friend, NOT an ad
- Be casual, warm, genuinely enthusiastic
- Mention ONE specific thing the specialist could help with based on what the user said
- Mention that Jarvis can give a FREE preview using the specialist's method
- Keep it SHORT (3-4 sentences max)
- Use 🎩 emoji for Inner Circle
- End with a question: "Quer que eu te dê uma amostra?" or "Want a free preview?"
- NEVER use words like: "sponsored", "partner", "advertisement", "promo", "discount code"

Write the introduction in ${lang}.`;

    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch {
    return specialist.introMessage
      .replace("{userName}", context.userName)
      .replace("{expertise}", specialist.expertise);
  }
}

// ─── Free Consultation (AI-powered using specialist knowledge) ───

/**
 * Provide a free AI-powered consultation using the specialist's knowledge.
 * This gives real value (not a teaser) but naturally leads to premium.
 */
export async function provideFreeConsultation(
  userId: string,
  specialistId: string,
  userMessage: string,
  userImage?: string // base64 image for visual analysis
): Promise<string> {
  const specialist = await prisma.innerCircleSpecialist.findUnique({
    where: { id: specialistId },
  });
  if (!specialist) return "Specialist not found.";

  // Check free consultation limit
  const freeCount = await prisma.innerCircleInteraction.count({
    where: { userId, specialistId, type: "free_consultation" },
  });
  if (freeCount >= specialist.maxFreePerUser) {
    const contactInfo = specialist.contactLink || specialist.instagram || specialist.website;
    return `Você já usou suas ${specialist.maxFreePerUser} consultas grátis com ${specialist.name}. Para uma consultoria completa, entre em contato: ${contactInfo}`;
  }

  if (!GEMINI_API_KEY) return "AI consultation unavailable.";

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `You are providing a FREE consultation using the method and knowledge of ${specialist.name}, an expert in ${specialist.expertise}.

SPECIALIST'S KNOWLEDGE AND METHOD:
${specialist.aiKnowledgePrompt}

USER'S QUESTION: "${userMessage}"

RULES:
- Give GENUINE, VALUABLE advice — this is NOT a teaser
- Use the specialist's method/terminology naturally
- Be specific and actionable
- At the end, naturally mention: "Para uma consultoria completa com ${specialist.name}, que inclui ${JSON.parse(specialist.premiumServices).slice(0, 2).join(" e ")}, ${specialist.contactLink ? "acesse: " + specialist.contactLink : specialist.instagram ? "siga: " + specialist.instagram : "entre em contato"}"
- Keep it concise but valuable (150-250 words)
- Start with "🎩 Inner Circle — Consultoria com método ${specialist.name}:"`;

    const result = await model.generateContent(prompt);
    const consultation = result.response.text().trim();

    // Log interaction
    await prisma.innerCircleInteraction.create({
      data: {
        userId,
        specialistId,
        type: "free_consultation",
        context: userMessage.substring(0, 200),
      },
    });

    return consultation;
  } catch (err) {
    console.error("[INNER-CIRCLE] Consultation error:", (err as Error).message);
    return "Desculpe, não consegui gerar a consulta agora. Tente novamente.";
  }
}

// ─── Interaction Tracking ───

export async function logIntroShown(userId: string, specialistId: string, context: string) {
  await prisma.innerCircleInteraction.create({
    data: { userId, specialistId, type: "intro_shown", context: context.substring(0, 200) },
  });

  // Increment daily counter
  const todayKey = `ic:daily:${userId}:${new Date().toISOString().slice(0, 10)}`;
  const raw = await redisGet(todayKey);
  const count = parseInt(raw || "0", 10) + 1;
  await redisSet(todayKey, String(count), 86400);
}

export async function logDeclined(userId: string, specialistId: string) {
  await prisma.innerCircleInteraction.create({
    data: { userId, specialistId, type: "declined" },
  });
}

export async function logPremiumReferral(userId: string, specialistId: string) {
  await prisma.innerCircleInteraction.create({
    data: { userId, specialistId, type: "premium_referral" },
  });
}

// ─── Admin ───

export async function getInnerCircleStats() {
  const specialists = await prisma.innerCircleSpecialist.count({ where: { active: true } });
  const totalInteractions = await prisma.innerCircleInteraction.count();
  const freeConsultations = await prisma.innerCircleInteraction.count({ where: { type: "free_consultation" } });
  const premiumReferrals = await prisma.innerCircleInteraction.count({ where: { type: "premium_referral" } });
  const conversions = await prisma.innerCircleInteraction.count({ where: { converted: true } });

  return { specialists, totalInteractions, freeConsultations, premiumReferrals, conversions };
}

export async function listSpecialists() {
  return prisma.innerCircleSpecialist.findMany({
    where: { active: true },
    select: { id: true, name: true, slug: true, expertise: true, instagram: true, active: true },
  });
}
