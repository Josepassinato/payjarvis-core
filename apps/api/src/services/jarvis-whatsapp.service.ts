/**
 * Jarvis WhatsApp Service — processes WhatsApp messages through Gemini AI
 *
 * Reuses the same logic as OpenClaw (Telegram bot):
 * - Same PostgreSQL tables (openclaw_conversations, openclaw_user_facts)
 * - Same Gemini 2.5 Flash model with function calling
 * - Same tool handler (commerce, browse, payments, tracking, etc.)
 * - User identified by WhatsApp phone number (e.g. "whatsapp:+19546432431")
 *
 * Also checks for active onboarding sessions before processing.
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { prisma, Prisma } from "@payjarvis/database";

const prismaDbNull = Prisma.DbNull;
import QRCode from "qrcode";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  hasActiveSession,
  processStep,
  startOnboarding,
} from "./onboarding-bot.service.js";
import { consumeMessage } from "./credit.service.js";
import { markActive as markSequenceActive } from "./sequence.service.js";

// ─── Config ────────────────────────────────────────────
const PAYJARVIS_URL = process.env.PAYJARVIS_URL || "http://localhost:3001";
const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";
const BOT_API_KEY = process.env.BOT_API_KEY || process.env.PAYJARVIS_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ─── Memory: conversation history ──────────────────────

async function getHistory(userId: string, limit = 20) {
  const rows = await prisma.$queryRaw<{ role: string; content: string }[]>`
    SELECT role, content FROM openclaw_conversations
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}
  `;

  const raw = rows.reverse().map((r) => ({
    role: r.role as "user" | "model",
    parts: [{ text: r.content }],
  }));

  // Gemini requires strictly alternating user/model roles
  const history: typeof raw = [];
  for (const entry of raw) {
    if (history.length > 0 && history[history.length - 1].role === entry.role) {
      history[history.length - 1].parts[0].text += "\n" + entry.parts[0].text;
    } else {
      history.push(entry);
    }
  }

  // Must start with user, end with model
  while (history.length > 0 && history[0].role !== "user") history.shift();
  while (history.length > 0 && history[history.length - 1].role !== "model") history.pop();

  return history;
}

async function saveMessage(userId: string, role: string, content: string) {
  await prisma.$executeRaw`
    INSERT INTO openclaw_conversations (user_id, role, content) VALUES (${userId}, ${role}, ${content})
  `;
}

// ─── Memory: user facts ────────────────────────────────

async function getUserContext(userId: string) {
  const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string; category: string }[]>`
    SELECT fact_key, fact_value, category FROM openclaw_user_facts
    WHERE user_id = ${userId} ORDER BY category, updated_at DESC
  `;
  return facts;
}

async function upsertFact(userId: string, key: string, value: string, category = "general", source = "auto") {
  await prisma.$executeRaw`
    INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, updated_at)
    VALUES (${userId}, ${key}, ${value}, ${category}, ${source}, now())
    ON CONFLICT (user_id, fact_key) DO UPDATE SET
      fact_value = ${value}, category = ${category}, source = ${source}, updated_at = now()
  `;
}

// ─── System Prompt (same as openclaw/gemini.js) ────────

function buildSystemPrompt(userFacts: { fact_key: string; fact_value: string }[]) {
  const isNewUser = userFacts.length === 0;
  const knownKeys = userFacts.map((f) => f.fact_key.replace(/_/g, " ")).join(", ");

  // Extract user name from facts
  const nameFact = userFacts.find((f) => f.fact_key === "name" || f.fact_key === "first_name");
  const userName = nameFact ? nameFact.fact_value : "user";

  const userDataBlock = isNewUser
    ? "(New user — no profile data yet.)"
    : userFacts.map((f) => `- ${f.fact_key}: ${f.fact_value}`).join("\n");

  const today = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayStr = today.toISOString().split("T")[0];
  const dayOfWeek = dayNames[today.getDay()];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split("T")[0];

  return `You are Jarvis, personal executive assistant of ${userName}.

PERSONALITY
Discreet, precise, and proactive.
Speak like a high-level executive assistant — never like a generic chatbot.
No excess. No unnecessary emojis.
Short and objective responses.
Only speak when you have something relevant to say.

LANGUAGE
Automatically detect the user's language.
ALWAYS respond in the same language as the received message.
English, Português BR, or Español — never mix.

MEMORY
You remember absolutely everything:
- Products purchased and frequency
- Preferred and rejected brands
- Sizes, colors, specifications
- Usual budget per category
- Important dates mentioned
- Restrictions (dietary, allergies, etc)
- Preferred delivery addresses
Never ask for something that was already provided.
${knownKeys ? `\nData you ALREADY KNOW (DO NOT ask again): ${knownKeys}` : ""}

When the user provides ANY personal data → use save_user_fact IMMEDIATELY.

PROACTIVITY — GOLDEN RULES
Only reach out proactively when ONE of these conditions is true:
1. Favorite product with discount above 20%
2. Recurring item near reorder date
3. Important date in less than 7 days
4. Order with issue (delay, cancellation)
5. Exceptional opportunity (Prime Day, Black Friday)

NEVER reach out for:
- Generic marketing or promotions
- Confirming obvious things
- Asking for feedback without reason
- Saying you're available

FORMAT
Maximum 3 lines per message.
If listing options: maximum 3.
Never explain what you're going to do — just do it.
Use numbers for options, never bullets.

CHANNEL: WhatsApp — even more concise responses (WhatsApp truncates long messages).

SHOPPING
When receiving a purchase request:
1. Search Amazon simultaneously
2. Filter by user's preference history
3. Present THE BEST option directly — don't list 10
4. If user wants more: show up to 2 alternatives
5. Wait for confirmation and execute

If value below auto-approval limit: execute without asking and notify after.

FIRST 3 INTERACTIONS
Ask ONE question at a time to understand the profile.
Never more than one question per message.
After 3 interactions: stop asking, learn from usage.

LEARNING
With each interaction, silently update the profile.
Adjust recommendations based on approvals/rejections,
time patterns, explicit and implicit feedback.

---

TODAY: ${todayStr} (${dayOfWeek})
Tomorrow: ${tomorrowStr}

ABSOLUTE RULES
1. NEVER invent prices, products, or confirmations — only real data
2. NEVER say you did something you didn't
3. Payment ONLY with real transaction ID from PayJarvis
4. BEFORE PAYING — always confirm with complete summary

USER PROFILE
${userDataBlock}

Use ALL profile data automatically in every action.

TOOLS
- search_flights, search_hotels, search_restaurants, search_events
- browse, web_search, track_package
- search_products, compare_prices, find_stores, check_prescription
- search_transit, compare_transit, train_status, search_rental_cars
- find_home_service, find_mechanic
- request_payment, get_transactions, set_reminder, get_reminders, save_user_fact
- share_jarvis — generates a referral link + QR Code so the user can invite friends

SHARING
When the user wants to share, invite, refer friends, or asks for a QR code or link:
→ Use share_jarvis IMMEDIATELY. It generates the link and sends the QR Code automatically.
→ Then tell the user the link and QR were sent. Their friend gets free Beta access.

AUDIO/VOICE
When the user sends a voice message, it is automatically transcribed to text for you.
You receive the transcription (prefixed with [voice]) and should respond normally.
You fully understand voice messages. Never say you can't process audio, that you only work with text, or that you can't listen.
The user spoke to you — respond naturally as if they typed the message.
Keep voice responses concise (2-3 sentences max) since the response will be converted back to audio.

EXECUTION
1. User asks → USE THE TOOL IMMEDIATELY
2. Present THE BEST option (max 3)
3. Confirmation → request_payment
4. Done`;
}

// ─── Tool declarations (same as openclaw) ──────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: any[] = [
  {
    functionDeclarations: [
      {
        name: "web_search",
        description: "Search the web for information, news, answers.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Search query" },
            type: { type: SchemaType.STRING, description: "Type: general, news, shopping" },
          },
          required: ["query"],
        },
      },
      {
        name: "search_flights",
        description: "Search for flights (Amadeus).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            origin: { type: SchemaType.STRING, description: "Origin IATA code" },
            destination: { type: SchemaType.STRING, description: "Destination IATA code" },
            departureDate: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            returnDate: { type: SchemaType.STRING, description: "YYYY-MM-DD (optional)" },
            passengers: { type: SchemaType.NUMBER, description: "Number of passengers" },
          },
          required: ["origin", "destination", "departureDate"],
        },
      },
      {
        name: "search_hotels",
        description: "Search for hotels (Amadeus).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            city: { type: SchemaType.STRING, description: "City IATA code" },
            checkIn: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            checkOut: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            adults: { type: SchemaType.NUMBER, description: "Number of adults" },
          },
          required: ["city", "checkIn", "checkOut"],
        },
      },
      {
        name: "search_restaurants",
        description: "Search for restaurants (Yelp).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            location: { type: SchemaType.STRING, description: "City or address" },
            cuisine: { type: SchemaType.STRING, description: "Cuisine type" },
            covers: { type: SchemaType.NUMBER, description: "Number of people" },
          },
          required: ["location"],
        },
      },
      {
        name: "browse",
        description: "Navigate to a real URL in the browser.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            url: { type: SchemaType.STRING, description: "Full URL" },
            objetivo: { type: SchemaType.STRING, description: "What to find" },
          },
          required: ["url", "objetivo"],
        },
      },
      {
        name: "request_payment",
        description: "Request payment authorization. Use ONLY after explicit confirmation.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            merchantName: { type: SchemaType.STRING, description: "Store name" },
            amount: { type: SchemaType.NUMBER, description: "Amount" },
            currency: { type: SchemaType.STRING, description: "Currency (default: USD)" },
            category: { type: SchemaType.STRING, description: "Category" },
          },
          required: ["merchantName", "amount", "category"],
        },
      },
      {
        name: "get_transactions",
        description: "Get recent transactions.",
        parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
      },
      {
        name: "track_package",
        description: "Track a package by code. Auto-detects carrier.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            code: { type: SchemaType.STRING, description: "Tracking code" },
          },
          required: ["code"],
        },
      },
      {
        name: "search_products",
        description: "Search retail products (Walmart, Target, CVS, Amazon, etc).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Product search query" },
            zipCode: { type: SchemaType.STRING, description: "ZIP code" },
            platforms: { type: SchemaType.STRING, description: "Comma-separated: walmart,target,cvs,amazon" },
          },
          required: ["query"],
        },
      },
      {
        name: "set_reminder",
        description: "Create a reminder with date/time.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            text: { type: SchemaType.STRING, description: "Reminder text" },
            remindAt: { type: SchemaType.STRING, description: "ISO 8601 datetime" },
            category: { type: SchemaType.STRING, description: "health, finance, task, meeting, personal, general" },
            recurring: { type: SchemaType.STRING, description: "daily, weekly, monthly, or null" },
          },
          required: ["text", "remindAt"],
        },
      },
      {
        name: "get_reminders",
        description: "Get pending reminders.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            category: { type: SchemaType.STRING, description: "Filter by category" },
          },
          required: [],
        },
      },
      {
        name: "save_user_fact",
        description: "Save a permanent fact about the user. Use IMMEDIATELY when user shares personal data.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            key: { type: SchemaType.STRING, description: "Fact key in snake_case" },
            value: { type: SchemaType.STRING, description: "The fact value" },
            category: { type: SchemaType.STRING, description: "shopping, travel, food, personal, health, finance, general" },
          },
          required: ["key", "value", "category"],
        },
      },
      {
        name: "share_jarvis",
        description: "Generate a referral link and QR Code so the user can invite friends to Jarvis. Use when user wants to share, invite, refer a friend, or asks for QR code/link. The friend gets free Beta access.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: "amazon_search",
        description: "Search for products on Amazon. Use this when the user wants to buy something, find a product, compare prices, or asks about items on Amazon. Returns real product data with prices and direct purchase links. The user will click the link to buy on their own browser.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Search query for Amazon (e.g. 'iPhone 17 charger cable 6ft')" },
            max_results: { type: SchemaType.NUMBER, description: "Max products to return (default 3, max 5)" },
          },
          required: ["query"],
        },
      },
    ],
  },
];

// ─── Tool Handler ──────────────────────────────────────

async function handleTool(userId: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  switch (name) {
    case "web_search": {
      const query = encodeURIComponent(args.query as string);
      const searchUrl = args.type === "news"
        ? `https://www.google.com/search?q=${query}&tbm=nws`
        : `https://www.google.com/search?q=${query}`;
      try {
        const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: searchUrl }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!data.success) return { error: data.error || "Search failed" };
        return { query: args.query, content: data.content, url: data.url };
      } catch (err) {
        return { error: `Browser unavailable: ${(err as Error).message}` };
      }
    }

    case "browse": {
      try {
        const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: args.url }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!data.success) return { error: data.error || "Navigation failed" };
        return { title: data.title, url: data.url, content: data.content };
      } catch (err) {
        return { error: `Browser unavailable: ${(err as Error).message}` };
      }
    }

    case "search_flights":
    case "search_hotels":
    case "search_restaurants":
    case "search_events": {
      const service = name.replace("search_", "");
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/commerce/${service}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || `${service} search failed` };
      } catch (err) {
        return { error: `Commerce API unavailable: ${(err as Error).message}` };
      }
    }

    case "request_payment": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/payments/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Payment failed" };
      } catch (err) {
        return { error: `Payment API unavailable: ${(err as Error).message}` };
      }
    }

    case "get_transactions": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/transactions`, {
          headers: { "X-Bot-Api-Key": BOT_API_KEY },
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? { transactions: data.data } : { error: data.error || "No transactions" };
      } catch (err) {
        return { error: `Transaction API unavailable: ${(err as Error).message}` };
      }
    }

    case "track_package": {
      try {
        const code = encodeURIComponent(args.code as string);
        const res = await fetch(`${PAYJARVIS_URL}/api/tracking/${code}`, {
          headers: { "X-Bot-Api-Key": BOT_API_KEY },
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!data.success) return { error: (data as Record<string, unknown>).error || "Tracking failed" };
        return data.data as Record<string, unknown>;
      } catch (err) {
        return { error: `Tracking unavailable: ${(err as Error).message}` };
      }
    }

    case "search_products": {
      const platforms = args.platforms ? (args.platforms as string).split(",").map((p) => p.trim()) : [];
      const includesAmazon = platforms.length === 0 || platforms.includes("amazon");
      const isAmazonOnly = platforms.length === 1 && platforms[0] === "amazon";

      if (isAmazonOnly || (includesAmazon && platforms.length <= 1)) {
        try {
          const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(args.query as string)}`;
          const res = await fetch(`${BROWSER_AGENT_URL}/navigate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: searchUrl, searchTerm: args.query }),
            signal: AbortSignal.timeout(45000),
          });
          const data = await res.json() as Record<string, unknown>;
          if (!data.success) return { error: data.error || "Amazon search failed" };
          const products = data.products as Array<Record<string, unknown>> | undefined;
          if (products && products.length > 0) {
            return { platform: "amazon", totalProducts: products.length, products };
          }
          return { platform: "amazon", products: [], note: "No products found." };
        } catch (err) {
          return { error: `Amazon search failed: ${(err as Error).message}` };
        }
      }

      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/retail/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify({ query: args.query, zipCode: args.zipCode, platforms }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Search failed" };
      } catch (err) {
        return { error: `Retail API unavailable: ${(err as Error).message}` };
      }
    }

    case "set_reminder": {
      try {
        const result = await prisma.$queryRaw<{ id: number; remind_at: string }[]>`
          INSERT INTO openclaw_reminders (user_id, reminder_text, remind_at, category, recurring)
          VALUES (${userId}, ${args.text as string}, ${args.remindAt as string}::timestamptz, ${(args.category as string) || "general"}, ${(args.recurring as string) || null})
          RETURNING id, remind_at
        `;
        return { success: true, reminderId: result[0]?.id, remindAt: result[0]?.remind_at };
      } catch (err) {
        return { error: `Failed to set reminder: ${(err as Error).message}` };
      }
    }

    case "get_reminders": {
      try {
        const reminders = await prisma.$queryRaw<{ id: number; reminder_text: string; remind_at: string; category: string }[]>`
          SELECT id, reminder_text, remind_at, category FROM openclaw_reminders
          WHERE user_id = ${userId} AND completed = false ORDER BY remind_at LIMIT 20
        `;
        return { reminders };
      } catch (err) {
        return { error: `Failed to get reminders: ${(err as Error).message}` };
      }
    }

    case "save_user_fact": {
      try {
        await upsertFact(userId, args.key as string, args.value as string, (args.category as string) || "general", "gemini");
        console.log(`[WA SAVE_FACT] ${args.key} = ${args.value} (${args.category})`);
        return { success: true, key: args.key, value: args.value };
      } catch (err) {
        return { error: `Failed to save fact: ${(err as Error).message}` };
      }
    }

    case "share_jarvis": {
      try {
        return await generateShareForWhatsApp(userId);
      } catch (err) {
        return { error: `Failed to generate share link: ${(err as Error).message}` };
      }
    }

    case "amazon_search": {
      console.log(`[AMAZON-SEARCH] Tool called: amazon_search { query: "${args.query}" }`);
      try {
        const { searchAmazon } = await import("./amazon/search.service.js");
        // Determine Amazon domain from user's country
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
          select: { country: true },
        });
        const country = userRecord?.country || "US";
        const domainMap: Record<string, string> = { US: "amazon.com", BR: "amazon.com.br", UK: "amazon.co.uk", DE: "amazon.de", FR: "amazon.fr", ES: "amazon.es", CA: "amazon.ca", MX: "amazon.com.mx" };
        const domain = domainMap[country] || "amazon.com";
        const products = await searchAmazon(args.query as string, domain, (args.max_results as number) ?? 3);

        if (products.length === 0) {
          return { results: [], message: `No products found for "${args.query}"` };
        }

        return {
          results: products.map(p => ({
            title: p.title,
            price: p.price,
            rating: p.rating,
            reviews: p.reviewCount,
            prime: p.prime,
            url: p.url,
          })),
          message: `Found ${products.length} products. Present them to the user with the direct Amazon links so they can buy.`,
        };
      } catch (err) {
        return { error: `Amazon search failed: ${(err as Error).message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Share / Referral for WhatsApp ──────────────────────

const WA_NUMBER = "17547145921";
const PUBLIC_BASE = process.env.WEB_URL || "https://www.payjarvis.com";

async function generateShareForWhatsApp(userId: string): Promise<Record<string, unknown>> {
  const phone = userId.replace("whatsapp:", "");

  // Try to find formal user account
  const user = await prisma.user.findFirst({
    where: { OR: [{ telegramChatId: userId }, { phone }, { phone: phone.replace("+", "") }] },
    select: { id: true, clerkId: true, fullName: true },
  });

  let code: string;
  let firstName = "you";

  if (user) {
    firstName = user.fullName?.split(" ")[0] || "you";

    // Find user's bot for proper share link
    const bot = await prisma.bot.findFirst({
      where: { ownerId: user.id },
      select: { id: true },
    });

    if (bot) {
      const existing = await prisma.botShareLink.findFirst({
        where: { botId: bot.id, createdByUserId: user.id, active: true },
        orderBy: { createdAt: "desc" },
      });

      if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) {
        code = existing.code;
      } else {
        const { generateShareLink } = await import("./bot-share.service.js");
        const shareLink = await generateShareLink(bot.id, user.clerkId);
        code = shareLink.code;
      }
    } else {
      // User exists but no bot — generate anonymous code
      code = generateAnonCode(phone);
    }
  } else {
    // No formal account — get name from user facts
    const nameFact = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${userId} AND fact_key IN ('name', 'first_name')
      LIMIT 1
    `;
    if (nameFact.length > 0) firstName = nameFact[0].fact_value;

    // Generate anonymous referral code based on phone
    code = generateAnonCode(phone);
  }

  const whatsappLink = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(`START ${code}`)}`;
  const webLink = `${PUBLIC_BASE}/join/${code}`;

  // Generate QR Code PNG and save to public dir
  const qrFileName = `qr_${code}.png`;
  const qrDir = join(process.cwd(), "public", "qr");
  const qrFilePath = join(qrDir, qrFileName);
  const qrPublicUrl = `${PUBLIC_BASE}/public/qr/${qrFileName}`;

  // Ensure qr directory exists
  const { mkdir } = await import("fs/promises");
  await mkdir(qrDir, { recursive: true });

  await QRCode.toFile(qrFilePath, whatsappLink, {
    width: 512,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  // Send QR Code image via Twilio MMS (MediaUrl)
  const twilioMod = await import("twilio");
  const Twilio = twilioMod.default;
  const client = Twilio(
    process.env.TWILIO_ACCOUNT_SID || "",
    process.env.TWILIO_AUTH_TOKEN || ""
  );

  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || `whatsapp:+${WA_NUMBER}`;
  const toNumber = userId.startsWith("whatsapp:") ? userId : `whatsapp:${userId}`;

  await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: `📲 *Your referral link:*\n\n${whatsappLink}\n\nYour friend gets free Beta access!\nOr scan the QR Code above.`,
    mediaUrl: [qrPublicUrl],
  });

  console.log(`[WA SHARE] Generated referral for ${userId}: ${code} → ${whatsappLink}`);

  return {
    success: true,
    code,
    whatsappLink,
    webLink,
    qrCodeSent: true,
    message: `Referral link generated and sent to ${firstName}. Your friend gets free Beta access to Jarvis.`,
  };
}

// Generate a deterministic referral code for WhatsApp users without formal accounts
function generateAnonCode(phone: string): string {
  const SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  // Use last 6 digits of phone + random suffix for uniqueness
  const suffix = phone.replace(/\D/g, "").slice(-4);
  let code = "WA";
  for (let i = 0; i < 4; i++) {
    code += SAFE_CHARS[Math.floor(Math.random() * SAFE_CHARS.length)];
  }
  return code + suffix;
}

// ─── Gemini Chat ───────────────────────────────────────

async function chatWithGemini(
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  userId: string,
  userFacts: { fact_key: string; fact_value: string }[]
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "Jarvis is temporarily unavailable. Please try again in a moment.";
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const systemPrompt = buildSystemPrompt(userFacts);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    tools,
  });

  let chatSession = model.startChat({ history });
  let result;
  let response;

  try {
    result = await chatSession.sendMessage(userMessage);
    response = result.response;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400 || (e.message && e.message.includes("400"))) {
      console.error("[WA CHAT] 400 error, retrying with empty history");
      chatSession = model.startChat({ history: [] });
      result = await chatSession.sendMessage(userMessage);
      response = result.response;
    } else {
      throw err;
    }
  }

  // Function calling loop (max 8 iterations)
  let iterations = 0;
  while (response.functionCalls() && response.functionCalls()!.length > 0 && iterations < 8) {
    iterations++;
    const functionCalls = response.functionCalls()!;
    const functionResponses = [];

    for (const call of functionCalls) {
      console.log(`[WA TOOL] ${call.name}(${JSON.stringify(call.args).substring(0, 100)})`);
      let toolResult: Record<string, unknown>;
      try {
        toolResult = await handleTool(userId, call.name, call.args as Record<string, unknown>);
      } catch (err) {
        toolResult = { error: (err as Error).message || "Tool execution failed" };
      }
      // Sanitize
      toolResult = JSON.parse(JSON.stringify(toolResult));
      console.log(`[WA TOOL] ${call.name} =>`, JSON.stringify(toolResult).substring(0, 150));
      functionResponses.push({
        functionResponse: { name: call.name, response: toolResult },
      });
    }

    try {
      result = await chatSession.sendMessage(functionResponses);
      response = result.response;
    } catch (err) {
      console.error(`[WA CHAT] Error sending function response: ${(err as Error).message}`);
      return "Erro ao processar resultados. Tente novamente.";
    }
  }

  const text = response.text();
  if (!text && iterations > 0) {
    const followUp = await chatSession.sendMessage("Summarize what was done for the user. Reply in the same language they used.");
    return followUp.response.text() || "Pronto!";
  }
  return text || "Pronto!";
}

// ─── Fact Extraction (background) ──────────────────────

async function extractAndSaveFacts(userId: string, userMessage: string, modelResponse: string) {
  if (!GEMINI_API_KEY) return;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Analyze this conversation and extract permanent facts about the user.
Return ONLY a JSON array. Each fact: { key (snake_case), value, category (shopping|travel|food|personal|health|finance|general) }.
Only PERMANENT preferences, not temporary requests. Max 5 facts. If none, return [].

User said: "${userMessage.replace(/"/g, '\\"')}"
Assistant replied: "${modelResponse.substring(0, 300).replace(/"/g, '\\"')}"

JSON array:`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim().replace(/```json|```/g, "").trim();
    const facts = JSON.parse(text);
    if (Array.isArray(facts)) {
      for (const f of facts) {
        if (f.key && f.value) {
          console.log(`[WA LEARN] ${f.key} = ${f.value} (${f.category || "general"})`);
          await upsertFact(userId, f.key, f.value, f.category || "general", "auto");
        }
      }
    }
  } catch (err) {
    console.error("[WA FACT EXTRACT] Error:", (err as Error).message);
  }
}

// ─── Main Entry Point ──────────────────────────────────

export async function processWhatsAppMessage(from: string, text: string): Promise<string> {
  // User ID is the WhatsApp number (e.g. "whatsapp:+19546432431")
  const userId = from;

  console.log(`[WhatsApp] ${userId}: ${text.substring(0, 80)}`);

  // 0a. Handle START command (referral deep-link from wa.me/17547145921?text=START+CODE)
  // Also match "Quero começar CODE" as alternative link format
  const startMatch = text.match(/^(?:START|Quero\s+come[cç]ar)\s+(\S+)$/i);
  if (startMatch) {
    try {
      const result = await startOnboarding(userId, "whatsapp", startMatch[1]);
      return result.message;
    } catch (err) {
      console.error("[WA START] Error:", (err as Error).message);
      return "Erro ao iniciar. Tente novamente.";
    }
  }

  // 0b. Handle share/referral intent — detect before sending to Gemini
  const shareIntent = /\b(compartilh|indicar|indic[aá]|convidar|convid[aá]|share|invite|refer|qr\s*code|link.*(indic|refer|convit|compart)|amigo.*jarvis|jarvis.*amigo)\b/i;
  if (shareIntent.test(text)) {
    try {
      const result = await generateShareForWhatsApp(userId);
      if (result.success) {
        // QR + link already sent by generateShareForWhatsApp
        // Save conversation
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", `Referral link sent: ${result.whatsappLink}`);
        return `Your referral link and QR Code have been sent! 📲\n\nYour friend gets free Beta access to Jarvis.`;
      }
      // If error (no account, no bot), fall through to normal Gemini flow
      console.log(`[WA SHARE] Not eligible: ${result.error}`);
    } catch (err) {
      console.error("[WA SHARE] Error:", (err as Error).message);
      // Fall through to Gemini
    }
  }

  // 0. Mark sequence active + resolve user for credits
  let resolvedUserId: string | null = null;
  try {
    const cleanPhone = userId.replace("whatsapp:", "");
    const user = await prisma.user.findUnique({
      where: { phone: cleanPhone },
      select: { id: true },
    });
    if (user) {
      resolvedUserId = user.id;
      markSequenceActive(user.id).catch(() => {});
    }
  } catch { /* non-blocking */ }

  // 1. Check for active onboarding session
  try {
    const inOnboarding = await hasActiveSession(userId, "whatsapp");
    if (inOnboarding) {
      const result = await processStep(userId, "whatsapp", text);
      if (result.message) {
        return result.message;
      }
      return "Erro no onboarding. Tente novamente.";
    }
  } catch (err) {
    console.error("[WA ONBOARDING] Check error:", (err as Error).message);
    // Fall through to normal Jarvis flow
  }

  // 1b. Unknown user — no account, no onboarding session → check pending referrals
  if (!resolvedUserId) {
    const hasOnboarding = await hasActiveSession(userId, "whatsapp").catch(() => false);
    if (!hasOnboarding) {
      // Check if this number has a pending referral (from direct invite)
      const cleanPhone = userId.replace("whatsapp:", "");
      try {
        const pending = await prisma.$queryRaw<{ share_code: string | null; referrer_name: string; invitee_name: string; id: number }[]>`
          SELECT id, share_code, referrer_name, invitee_name FROM pending_referrals
          WHERE (phone = ${cleanPhone} OR phone = ${'+' + cleanPhone.replace('+', '')})
            AND used = false AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 1
        `;

        if (pending.length > 0) {
          const ref = pending[0];
          console.log(`[WhatsApp] Pending referral found for ${cleanPhone}: invited by ${ref.referrer_name}, code ${ref.share_code}`);

          // Mark as used
          await prisma.$executeRaw`UPDATE pending_referrals SET used = true WHERE id = ${ref.id}`;

          // Start onboarding with the share code
          try {
            const result = await startOnboarding(userId, "whatsapp", ref.share_code ?? undefined);
            return result.message;
          } catch (err) {
            console.error("[WA REFERRAL] Onboarding start error:", (err as Error).message);
            return "Erro ao iniciar. Tente novamente.";
          }
        }
      } catch (err) {
        console.error("[WA REFERRAL] Pending check error:", (err as Error).message);
      }

      // No pending referral — generic unknown user message
      console.log(`[WhatsApp] Unknown user ${userId} — no account, no onboarding, no pending referral`);
      return "Hi! 👋 I'm Jarvis, your personal assistant.\n\nIt looks like you don't have an account yet. To get started:\n\n1. Ask a friend who already uses Jarvis for an invite\n2. Or visit payjarvis.com to create your account\n\nWe're in Beta — access is completely free!";
    }
  }

  // 1c. Check for Amazon login confirmation — recover pending product
  if (resolvedUserId) {
    const amazonConfirmPattern = /\b(conectad[oa]|pronto|done|já\s*(fiz|fez)\s*login|logged\s*in|connected|já\s*conectei|entrei|logado|loguei)\b/i;
    if (amazonConfirmPattern.test(text)) {
      try {
        const pendingCtx = await prisma.storeContext.findFirst({
          where: { userId: resolvedUserId, store: "amazon", pendingProduct: { not: Prisma.DbNull } },
        });
        if (pendingCtx?.pendingProduct && typeof pendingCtx.pendingProduct === "object") {
          const product = pendingCtx.pendingProduct as { asin: string; name: string; price: number; url: string };
          console.log(`[AMAZON-CHECKOUT] Recovered pending product after login: ${JSON.stringify(product)}`);

          // Clear pending product
          await prisma.storeContext.update({
            where: { id: pendingCtx.id },
            data: { pendingProduct: prismaDbNull, updatedAt: new Date() },
          });

          // Check session first
          try {
            const sessionRes = await fetch(`${PAYJARVIS_URL}/api/amazon/checkout/check-session`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: resolvedUserId }),
              signal: AbortSignal.timeout(30_000),
            });
            const sessionData = await sessionRes.json() as { success: boolean; data?: { authenticated?: boolean } };

            if (sessionData.success && sessionData.data?.authenticated) {
              console.log(`[AMAZON-CHECKOUT] Session confirmed, auto-starting checkout for ASIN=${product.asin}`);
              // Auto-start checkout
              const user = await prisma.user.findUnique({
                where: { id: resolvedUserId },
                select: { bots: { select: { id: true }, take: 1 } },
              });
              const botId = user?.bots?.[0]?.id || "";
              const checkoutRes = await fetch(`${PAYJARVIS_URL}/api/amazon/checkout/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userId: resolvedUserId,
                  botId,
                  asin: product.asin,
                  title: product.name,
                  price: product.price,
                  quantity: 1,
                }),
                signal: AbortSignal.timeout(120_000),
              });
              const checkoutData = await checkoutRes.json() as { success: boolean; data?: any };

              if (checkoutData.success && checkoutData.data?.status === "READY_TO_CONFIRM") {
                const summary = checkoutData.data.summary;
                return `Amazon Connected! I found your product:\n\n🛒 *${product.name}*\n💰 $${product.price}\n\n${summary?.address ? `📦 Shipping to: ${summary.address}\n` : ""}${summary?.estimatedDelivery ? `🚚 Delivery: ${summary.estimatedDelivery}\n` : ""}\nShall I place the order?`;
              } else if (checkoutData.data?.status === "NEEDS_AUTH") {
                return `Thanks! But it seems the login didn't complete. Please try again:\n\n${checkoutData.data.authUrl}`;
              } else {
                return `Amazon Connected! But there was an issue starting the checkout: ${checkoutData.data?.message || "Unknown error"}. Please try again.`;
              }
            }
          } catch (err) {
            console.error(`[AMAZON-CHECKOUT] Auto-checkout error: ${(err as Error).message}`);
          }

          // If session check failed, tell user we recovered the product
          return `Amazon Connected! I had ${product.name} ($${product.price}) saved. Let me check your session and start the checkout...`;
        }
      } catch (err) {
        console.error(`[AMAZON-CHECKOUT] Pending product recovery error: ${(err as Error).message}`);
        // Fall through to normal flow
      }
    }
  }

  // 2. Check credits before processing
  if (resolvedUserId) {
    try {
      const creditCheck = await consumeMessage(resolvedUserId, "whatsapp", 0, 0);
      if (!creditCheck.allowed) {
        const lang = userId.includes("+55") ? "pt" : "en";
        return lang === "pt"
          ? "Suas mensagens acabaram.\n\nRecarregue para continuar:\n\n1. 15.000 msgs — $10\n2. 50.000 msgs — $25"
          : "Your messages have run out.\n\nRecharge to continue:\n\n1. 15,000 msgs — $10\n2. 50,000 msgs — $25";
      }
    } catch {
      // Non-blocking — allow message if credit check fails
    }
  }

  // 3. Determine tier: standard vs premium
  let userTier = "free";
  if (resolvedUserId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: { planType: true },
      });
      userTier = user?.planType || "free";
    } catch { /* default free */ }
  }

  // 4. Process message
  try {
    const [history, userFacts] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
    ]);

    let response: string;

    if (userTier === "premium") {
      // ═══ PREMIUM PIPELINE ═══
      // Call OpenClaw premium endpoint (runs adaptive agent layers)
      console.log(`[WA PREMIUM] Processing for ${userId}`);
      try {
        const premiumRes = await fetch(`http://localhost:4000/api/premium/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({ userId, text, platform: "whatsapp" }),
          signal: AbortSignal.timeout(30000),
        });
        const premiumData = await premiumRes.json() as { success: boolean; response: string };
        if (premiumData.success) {
          response = premiumData.response;
        } else {
          // Fallback to standard
          console.warn("[WA PREMIUM] Fallback to standard:", premiumData);
          response = await chatWithGemini(history, text, userId, userFacts);
          await saveMessage(userId, "user", text);
          await saveMessage(userId, "model", response);
        }
      } catch (err) {
        // Fallback to standard if premium service unavailable
        console.warn("[WA PREMIUM] Service unavailable, fallback:", (err as Error).message);
        response = await chatWithGemini(history, text, userId, userFacts);
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", response);
      }
    } else {
      // ═══ STANDARD PIPELINE ═══
      response = await chatWithGemini(history, text, userId, userFacts);
      await saveMessage(userId, "user", text);
      await saveMessage(userId, "model", response);
    }

    // Extract facts in background (both tiers — premium also does its own enhanced version)
    extractAndSaveFacts(userId, text, response).catch((err) =>
      console.error("[WA FACT] Background error:", err.message)
    );

    return response;
  } catch (err) {
    console.error("[WA CHAT] Error:", (err as Error).message);
    return "Erro ao processar. Tente novamente.";
  }
}
