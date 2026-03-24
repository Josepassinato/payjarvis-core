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

export async function getHistory(userId: string, limit = 50) {
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

export async function saveMessage(userId: string, role: string, content: string) {
  await prisma.$executeRaw`
    INSERT INTO openclaw_conversations (user_id, role, content) VALUES (${userId}, ${role}, ${content})
  `;
}

// ─── Memory: user facts ────────────────────────────────

export async function getUserContext(userId: string) {
  const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string; category: string }[]>`
    SELECT fact_key, fact_value, category FROM openclaw_user_facts
    WHERE user_id = ${userId} ORDER BY category, updated_at DESC
  `;
  return facts;
}

export async function upsertFact(userId: string, key: string, value: string, category = "general", source = "auto") {
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

  // Separate summaries from regular facts
  const summaryFacts = userFacts.filter((f) => f.fact_key.startsWith("conversation_summary_"));
  const regularFacts = userFacts.filter((f) => !f.fact_key.startsWith("conversation_summary_"));

  const userDataBlock = isNewUser
    ? "(New user — no profile data yet.)"
    : regularFacts.map((f) => `- ${f.fact_key}: ${f.fact_value}`).join("\n");

  const longTermMemory = summaryFacts.length > 0
    ? `\n\nLONG-TERM MEMORY (summaries of past conversations):\n${summaryFacts.map((f) => f.fact_value).join("\n")}\nUse this context for continuity. Never ask for information already here.`
    : "";

  const today = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayStr = today.toISOString().split("T")[0];
  const dayOfWeek = dayNames[today.getDay()];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split("T")[0];

  return `You are Jarvis, personal executive assistant of ${userName}.

CORE RULE — SELF-AWARENESS
Before responding to ANY request, mentally check your available tools. NEVER say "I can't", "I don't know", or "I don't have that information" when you have a tool that can help.

YOUR CAPABILITIES:
- VISION: You can analyze images — identify products, brands, text, labels, food, places, documents. If user sends a photo, ALWAYS analyze it. NEVER ask "what is this?" — look at it yourself.
- VOICE: Audio messages are transcribed for you. Respond naturally.
- SEARCH: search_restaurants, search_hotels, search_flights, search_events, search_products (Amazon, Walmart, Google Shopping — use platform='all' to compare prices), search_products_latam (Mercado Livre), search_products_global (eBay+retailers), find_stores, find_home_service, find_mechanic, compare_prices, web_search, browse (visit websites)
- NAVIGATION: get_directions (routes+ETA+Google Maps link), geocode_address (validate addresses). ALWAYS include Google Maps links.
- DOCUMENTS: generate_document (PDF: contracts, letters, reports, invoices), fill_form (website forms), export_transactions (spending reports)
- COMMERCE: request_payment, track_package (USPS+Correios), amazon_search, get_transactions, get_payment_methods
- VAULT: setup_vault, save_card, list_vault_items, delete_vault_item — Zero-Knowledge encrypted storage
- MEMORY: save_user_fact (save ANY user data immediately), set_reminder, get_reminders, complete_reminder
- SOCIAL: share_jarvis (invite friends), request_handoff (escalate to human)
- PHONE CALLS: make_phone_call — Call restaurants, hotels, doctors, stores, airlines on behalf of the user. You conduct the conversation autonomously and report the result. ALWAYS confirm before calling: show the number and objective, ask "Shall I proceed?" CONTACTS are saved automatically — if the user says "call Adriane" without a number, look up the contact first. If not found, ask for the number. The user should NEVER have to give you the same number twice.
- VOICE CALL WITH USER: call_user — Call the user directly for a live voice conversation. Use when user says "me liga", "call me", "quero falar por voz". You can use ALL your tools during the call.
- CONTACTS: list_contacts (show saved contacts), delete_contact (remove a contact), update_contact (change phone number). Contacts are auto-saved when making calls.
- PHONE CALLER ID — When the user wants to verify their phone number for caller ID, send them to the dashboard: https://www.payjarvis.com/setup-phone — Say: "Click here to verify your phone number. It takes 1 minute!" NEVER collect verification codes in the chat.
- PWA APP — PayJarvis can be installed as an app on the user's phone. When the user asks about an app, or says "I want the app", "how do I install", "quero o app", "tem app?", or during onboarding after setup is complete, tell them: "You can install Jarvis as an app on your phone! Open this link in your browser: https://www.payjarvis.com/chat — iPhone: Open in Safari, tap Share, Add to Home Screen. Android: Open in Chrome, tap the 3 dots menu, Add to Home Screen. The Jarvis icon will appear on your home screen like a real app!"

DECISION PROCESS (EVERY message):
1. Image sent? → ANALYZE IT, identify contents, search for prices if it's a product
2. Audio sent? → Already transcribed, process normally
3. Have a TOOL for this? → USE IT
4. Can combine tool + knowledge? → DO IT
5. ONLY if truly nothing works → explain what you CAN do instead
NEVER give up on first try. If one tool fails, try another approach.
ALWAYS include prices+links for products, Google Maps links for locations.

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

CHANNEL AWARENESS
You are currently talking on WhatsApp.
When the user asks you to set up routines, reminders, or scheduled messages, they will be delivered on WhatsApp.
Keep responses extra concise — WhatsApp truncates long messages.
Never mention or reference Telegram unless the user asks.

SHOPPING SETUP
When the user wants to configure shopping, spending limits, add a payment card, or set up purchases, ALWAYS send them to the dashboard page instead of doing it in chat. Say: 'Click here to set up shopping — it takes 2 minutes! 🛒 https://www.payjarvis.com/dashboard/setup-shopping Your card info is protected by Stripe 🔒'. NEVER collect card numbers in the chat.

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

IMAGE ANALYSIS
When the user sends an image (photo), ALWAYS analyze it thoroughly.
Identify products, text, labels, brands, barcodes, locations, or any relevant content.
If the user asks about the image or sends it with a question, combine your visual analysis with the question to give a complete answer.
NEVER ignore an image or ask "what is it?" if you can see it yourself.
If you identify a product: immediately search for prices and availability.

ABSOLUTE RULES
1. NEVER invent prices, products, or confirmations — only real data
2. NEVER say you did something you didn't
3. Payment ONLY with real transaction ID from PayJarvis
4. BEFORE PAYING — always confirm with complete summary

USER PROFILE
${userDataBlock}${longTermMemory}

Use ALL profile data automatically in every action.

LOCATION AWARENESS — NEVER ASK FOR INFORMATION YOU ALREADY HAVE
You have access to the user's saved GPS coordinates (latitude/longitude in their profile), plus their city, state, zip_code, and country in their facts.
NEVER ask for ZIP code, CEP, address, city, or location when you already have it in the USER PROFILE above.
When the user asks for something "near me", "perto de mim", "aqui perto", "nearby", "cerca de mí":
→ Use their saved coordinates automatically in search tools.
→ The coordinates are injected automatically into tool calls — just use the tool normally.
When the user mentions a city name (like "Boca Raton", "Miami", "São Paulo"):
→ Use that city directly — you have geocode_address to convert city names to coordinates if needed.
→ NEVER ask the user for ZIP code or coordinates when they already gave you a city name.
If no location is saved and the user asks for nearby results:
→ Ask them to share their location by sending a location pin in WhatsApp.
→ NEVER guess or assume a location.

CULTURAL CONTEXT — ADAPT TO USER'S COUNTRY, NOT LANGUAGE
You MUST adapt all terminology, currency, units, and references to the user's COUNTRY of residence, regardless of what language they speak. A Brazilian living in the US should receive US-contextual responses in Portuguese.

Rules:
1. TERMINOLOGY: Use the local term for the user's country
   - US: ZIP code (not CEP), Social Security (not CPF), driver's license (not CNH), county (not município)
   - Brazil: CEP (not ZIP code), CPF (not Social Security), CNH (not driver's license)
2. CURRENCY: Always use the local currency FIRST
   - US resident: "$299" or "US$ 299" (not "R$ 1.500")
   - Brazil resident: "R$ 1.500" (not "$299")
   - Show conversion in parentheses if relevant: "$299 (~R$ 1.500)"
3. UNITS: Use the user's country system
   - US: miles, Fahrenheit, pounds, feet/inches, gallons
   - Brazil/Portugal: kilometers, Celsius, kilos, meters, liters
   - "O restaurante fica a 2 miles daqui" (not "3.2 km") for US resident speaking Portuguese
4. DATE FORMAT: US = MM/DD/YYYY, Brazil = DD/MM/YYYY
5. PHONE FORMAT: US = (305) 555-1234, Brazil = (11) 99999-9999
6. SHOPPING: Default to LOCAL platforms
   - US: Amazon.com, Best Buy, Walmart, Target, DoorDash, Uber
   - Brazil: Mercado Livre, Magazine Luiza, Americanas, iFood, 99
7. LEGAL/TAX: US = IRS, LLC, EIN, W-2, sales tax | Brazil = Receita Federal, MEI, CNPJ, nota fiscal, ICMS
8. HEALTHCARE: US = insurance, copay, deductible, urgent care | Brazil = SUS, plano de saúde, UBS
9. DETERMINE COUNTRY: Check 'country' fact FIRST → GPS → ZIP/CEP → if unknown, ASK and save as fact
10. NEVER assume country from language alone

Respond in whatever LANGUAGE the user speaks, but use the COUNTRY's conventions.

TOOLS
- search_flights, search_hotels, search_restaurants, search_events
- browse, web_search, track_package
- search_products, compare_prices, find_stores, check_prescription
- search_transit, compare_transit, train_status, search_rental_cars
- find_home_service, find_mechanic
- request_payment, get_transactions, set_reminder, get_reminders, save_user_fact
- share_jarvis — generates a referral link + QR Code so the user can invite friends
- generate_document — generates PDF documents (contracts, letters, reports, resumes, proposals, invoices). Use when the user asks to write, create, draft any document.
- export_transactions — exports the user's transaction statement as PDF
- fill_form — navigates to a website and fills a form with provided data
- get_directions — driving/walking/transit directions with distance, time, and route steps
- geocode_address — convert address to coordinates, validate addresses
- setup_vault — configure Zero-Knowledge encrypted vault with a user PIN. Use when user wants to save cards or sensitive data for the first time.
- save_card — save a credit/debit card encrypted with the user's PIN. Requires vault setup first.
- list_vault_items — list vault items (cards, credentials) WITHOUT sensitive data
- delete_vault_item — remove an item from the vault

SECURITY & VAULT
You have access to a Zero-Knowledge encrypted vault for each user.
When the user wants to save sensitive data (credit cards, passwords, credentials), ALWAYS use the vault tools.
NEVER store card numbers, CVVs, or passwords in plain text in the conversation history.
After the user provides card details, save them to the vault and inform that the data is encrypted.
Always explain that the data is encrypted with THEIR personal PIN and that not even the PayJarvis team can access it.
When making a purchase that requires card details, ask for the PIN first, retrieve the card, use it, and clear from memory.
If the user hasn't set up their vault yet, guide them to create a PIN first using setup_vault.

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

PERSONAL ASSISTANT — 12 AREAS OF EXPERTISE
You are a COMPLETE personal assistant. You help with ALL of these areas using your tools AND your training knowledge:

1. TRAVEL PLANNING — Create full itineraries, suggest destinations, find flights/hotels, plan day-by-day schedules, visa requirements, packing lists, local tips. Use search_flights, search_hotels, or your knowledge.
2. SHOPPING — Find products, compare prices across Amazon/Walmart/Google Shopping, track orders, suggest gifts, find deals. Use search_products with platform='all' to compare prices. ALWAYS present results as a PRICE RANKING (cheapest first) with: rank number, product name, price, rating, and clickable link. Highlight the BEST VALUE (best price-to-rating ratio).
3. FOOD & DINING — Find restaurants, suggest recipes, meal planning, dietary advice, reservations. Use search_restaurants or your knowledge.
4. HEALTH & WELLNESS — General health info, find pharmacies, check prescriptions, fitness tips, mental health resources. Use check_prescription, find_stores, or your knowledge.
5. FINANCE — Budget tips, expense tracking, investment basics, tax deadlines, currency conversion. Use your knowledge.
6. EDUCATION — Course recommendations, study tips, language learning, skill development, tutoring resources. Use web_search or your knowledge.
7. PRODUCTIVITY — Time management, goal setting, habit tracking, workflow optimization, app recommendations. Use set_reminder or your knowledge.
8. ENTERTAINMENT — Movie/show recommendations, event tickets, book suggestions, game recommendations, streaming guides. Use search_events or your knowledge.
9. HOME & SERVICES — Find plumbers, electricians, cleaners, movers, home improvement tips. Use find_home_service or your knowledge.
10. LEGAL & DOCUMENTS — General legal info, document templates, visa/immigration basics, contract tips. Use your knowledge.
11. TRANSPORT — Route planning, car rentals, public transit, ride-sharing, mechanic services. Use search_transit, search_rental_cars, find_mechanic, or your knowledge.
12. SOCIAL & EVENTS — Party planning, gift ideas, invitation wording, event coordination, etiquette tips. Use your knowledge.

IMPORTANT: You NEVER say "I don't have a specific tool for that" or "I can't do that". You ALWAYS help using your extensive training knowledge when no specific tool is available. You are knowledgeable about virtually everything — use that knowledge confidently.

FALLBACK RULE
If ANY search tool returns an error, times out, or returns no results:
- NEVER just say "não foi possível", "ocorreu um erro", or "I couldn't find that"
- ALWAYS use your training knowledge to provide the best answer you can
- Include approximate prices marked as "preço aproximado" or "approximate price"
- Include known retailers and direct URLs (amazon.com, bestbuy.com, mercadolivre.com.br, etc.)
- Mark knowledge-based info as "baseado em informações recentes" or "based on recent information"
- Example: "Os óculos Meta Ray-Ban custam aproximadamente $299. Disponível em: amazon.com, bestbuy.com, ray-ban.com/meta"
- The user must ALWAYS get a useful answer, even if tools fail

ACTION FIRST — CALL TOOLS IMMEDIATELY
When the user asks you to do something, CALL THE TOOL IMMEDIATELY in your response. Do NOT send a text acknowledgment first — the system automatically sends a quick "searching..." message when you call a tool. If you respond with only text like "Vou buscar..." WITHOUT calling a tool, the search NEVER happens. ALWAYS call the tool in the same response as the user's request.
WRONG: User asks to search → you reply "Vou buscar!" (text only, no tool call) → search never happens
RIGHT: User asks to search → you call search_products/find_stores/web_search → results come back → you present them

NEWS RULE
When user asks for news/notícias/noticias: ALWAYS call web_search with type="news" and a SINGLE broad query (e.g. "top news today" or "últimas notícias"). Do NOT make 5+ separate searches — ONE search is enough. Keep your FINAL response under 1000 characters total. The user is on WhatsApp with a 1600-char limit per message.

EXECUTION
1. User asks → CALL THE TOOL IMMEDIATELY (system sends auto-acknowledge)
2. If tool fails → USE YOUR KNOWLEDGE as fallback (NEVER leave user without answer)
3. Present THE BEST option (max 3)
4. Confirmation → request_payment
5. Done`;
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
            city: { type: SchemaType.STRING, description: "City IATA code (optional if using coordinates)" },
            checkIn: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            checkOut: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            adults: { type: SchemaType.NUMBER, description: "Number of adults" },
            latitude: { type: SchemaType.NUMBER, description: "User latitude (auto-injected)" },
            longitude: { type: SchemaType.NUMBER, description: "User longitude (auto-injected)" },
          },
          required: ["checkIn", "checkOut"],
        },
      },
      {
        name: "search_restaurants",
        description: "Search for restaurants (Yelp). When user asks for 'near me'/'nearby'/'perto de mim', coordinates are auto-injected.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            location: { type: SchemaType.STRING, description: "City or address (optional if using coordinates)" },
            cuisine: { type: SchemaType.STRING, description: "Cuisine type" },
            covers: { type: SchemaType.NUMBER, description: "Number of people" },
            latitude: { type: SchemaType.NUMBER, description: "User latitude (auto-injected)" },
            longitude: { type: SchemaType.NUMBER, description: "User longitude (auto-injected)" },
          },
          required: [],
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
        description: "Search products across multiple platforms (Amazon, Walmart, Google Shopping). Returns products sorted by price (cheapest first) with title, price, rating, link, and platform. Use platform='all' to compare prices across stores.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Product search query (e.g. 'iPhone 16 case', 'running shoes Nike')" },
            platform: { type: SchemaType.STRING, description: "Platform: amazon, walmart, google_shopping, or all (default: amazon)" },
            max_results: { type: SchemaType.NUMBER, description: "Max products per platform (default 5, max 10)" },
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
      {
        name: "generate_document",
        description: "Generate a PDF document (contract, letter, report, resume, proposal, invoice, receipt, or any document) and send it to the user. Use when the user asks to write, create, draft, or generate any document.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            title: { type: SchemaType.STRING, description: "Document title" },
            content: { type: SchemaType.STRING, description: "Full document content in Markdown. Use ## for headings, **bold** for emphasis, - for lists. Write the COMPLETE document, not a summary." },
            type: { type: SchemaType.STRING, description: "Type: contract, letter, report, resume, proposal, invoice, receipt, general" },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "export_transactions",
        description: "Export the user's transaction statement as PDF. Use when the user asks for a statement, purchase history, spending report, or transaction export.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            period: { type: SchemaType.STRING, description: "Period: last_week, last_month, last_3months, all" },
          },
          required: [],
        },
      },
      {
        name: "fill_form",
        description: "Navigate to a website and fill a form with provided data. Use when the user asks to fill a form, registration, signup, or submit data on a website. Does NOT submit automatically — waits for user confirmation.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            url: { type: SchemaType.STRING, description: "URL of the website with the form" },
            fields: { type: SchemaType.STRING, description: "JSON string with fields to fill. Ex: {\"name\": \"José\", \"email\": \"jose@email.com\"}" },
            instructions: { type: SchemaType.STRING, description: "Additional instructions: which button to click, which tab to select, etc." },
          },
          required: ["url", "fields"],
        },
      },
      {
        name: "get_directions",
        description: "Get driving/walking/transit directions between two locations with distance and travel time. Use when the user asks how to get somewhere, travel time, distance, route, or directions.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            origin: { type: SchemaType.STRING, description: "Starting location (address, city, or place name). Use user's saved location if they say 'from here'." },
            destination: { type: SchemaType.STRING, description: "Destination (address, city, or place name)" },
            mode: { type: SchemaType.STRING, description: "Travel mode: driving, walking, bicycling, transit (default: driving)" },
          },
          required: ["origin", "destination"],
        },
      },
      {
        name: "geocode_address",
        description: "Convert an address to GPS coordinates, or validate/normalize an address. Use when you need to look up a location, validate an address, or get coordinates.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            address: { type: SchemaType.STRING, description: "Address, ZIP code, city name, or place name to geocode" },
          },
          required: ["address"],
        },
      },
      {
        name: "setup_vault",
        description: "Configure the user's Zero-Knowledge secure vault with a PIN. Use when the user wants to save sensitive data like credit cards or credentials for the first time.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            pin: { type: SchemaType.STRING, description: "PIN of 4-32 characters chosen by the user" },
          },
          required: ["pin"],
        },
      },
      {
        name: "save_card",
        description: "Save a credit/debit card to the user's Zero-Knowledge encrypted vault. Requires vault to be set up first.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            pin: { type: SchemaType.STRING, description: "User's vault PIN" },
            card_number: { type: SchemaType.STRING, description: "Card number" },
            expiry: { type: SchemaType.STRING, description: "Expiry date MM/YY" },
            cvv: { type: SchemaType.STRING, description: "CVV code" },
            cardholder_name: { type: SchemaType.STRING, description: "Name on card" },
            label: { type: SchemaType.STRING, description: "Nickname for the card" },
          },
          required: ["pin", "card_number", "expiry", "cvv", "cardholder_name"],
        },
      },
      {
        name: "list_vault_items",
        description: "List items in the user's secure vault (cards, credentials) WITHOUT sensitive data.",
        parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
      },
      {
        name: "delete_vault_item",
        description: "Remove an item from the user's secure vault.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            item_id: { type: SchemaType.STRING, description: "ID of the item to remove" },
          },
          required: ["item_id"],
        },
      },
      {
        name: "make_phone_call",
        description: "Make a phone call on behalf of the user. Use when the user asks to call a restaurant, hotel, store, doctor, airline, or any person. You conduct the conversation autonomously and report the result. Always confirm before calling. If the user gives a name without a number (e.g. 'call Adriane'), the system will auto-lookup from saved contacts. If not found, ask for the number.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            phone_number: { type: SchemaType.STRING, description: "Phone number (international format, e.g. +13056959999). Optional if business_name matches a saved contact." },
            business_name: { type: SchemaType.STRING, description: "Name of the person or business being called" },
            objective: { type: SchemaType.STRING, description: "What to accomplish: 'make reservation', 'ask about hours', 'check availability', 'invite to beach', etc." },
            details: { type: SchemaType.STRING, description: "Specifics: '2 people, 8pm tonight, name José Passinato'" },
            language: { type: SchemaType.STRING, description: "Language to speak on the call: 'en', 'pt', 'es'" },
          },
          required: ["objective"],
        },
      },
      {
        name: "verify_caller_id",
        description: "Verify the user's phone number so it appears as caller ID when Jarvis makes calls on their behalf. Twilio will call the user with a 6-digit verification code. Use when the user wants their number to show up on outgoing calls.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            phone_number: { type: SchemaType.STRING, description: "User's phone number with country code (e.g. +19546432431)" },
          },
          required: ["phone_number"],
        },
      },
      {
        name: "call_user",
        description: "Call the user directly for a live voice conversation. Use when the user says 'me liga', 'quero falar por voz', 'call me', 'voice call', or similar. The user answers their phone and talks to you in real-time. You can use ALL your tools during the call. Always confirm before calling.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reason: { type: SchemaType.STRING, description: "Why calling: 'user requested', 'complex discussion', 'urgent notification'" },
          },
          required: ["reason"],
        },
      },
      {
        name: "list_contacts",
        description: "List all saved contacts from the user's personal phone book. Use when user says 'show my contacts', 'mostra meus contatos', 'who do I have saved?'",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
        },
      },
      {
        name: "delete_contact",
        description: "Delete a contact from the user's personal phone book. Use when user says 'remove contact', 'delete contact', 'remove o contato do João'",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: "Name of the contact to delete" },
          },
          required: ["name"],
        },
      },
      {
        name: "update_contact",
        description: "Update a contact's phone number. Use when user says 'change number', 'update contact', 'muda o número da Adriane'",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: "Name of the contact to update" },
            phone: { type: SchemaType.STRING, description: "New phone number (international format)" },
          },
          required: ["name", "phone"],
        },
      },
    ],
  },
];

// ─── Acknowledge messages for slow tools (BUG 2 fix) ──────────

const TOOL_ACKNOWLEDGE: Record<string, { pt: string; en: string; es: string }> = {
  search_products:       { pt: "Buscando as melhores ofertas pra você! 🔍", en: "Searching for the best deals for you! 🔍", es: "Buscando las mejores ofertas para ti! 🔍" },
  amazon_search:         { pt: "Buscando na Amazon pra você! 🔍", en: "Searching Amazon for you! 🔍", es: "Buscando en Amazon para ti! 🔍" },
  search_products_latam: { pt: "Buscando no Mercado Livre! 🔍", en: "Searching Mercado Livre! 🔍", es: "Buscando en Mercado Libre! 🔍" },
  search_products_global:{ pt: "Buscando em várias lojas! 🔍", en: "Searching multiple stores! 🔍", es: "Buscando en varias tiendas! 🔍" },
  make_phone_call:       { pt: "Vou ligar agora! 📞", en: "Calling now! 📞", es: "Llamando ahora! 📞" },
  call_user:             { pt: "Te ligando agora! 📞", en: "Calling you now! 📞", es: "Llamándote ahora! 📞" },
  generate_document:     { pt: "Preparando seu documento! 📄", en: "Preparing your document! 📄", es: "Preparando tu documento! 📄" },
  export_transactions:   { pt: "Gerando seu extrato! 📊", en: "Generating your statement! 📊", es: "Generando tu extracto! 📊" },
  search_restaurants:    { pt: "Procurando os melhores restaurantes! 🍽️", en: "Searching for the best restaurants! 🍽️", es: "Buscando los mejores restaurantes! 🍽️" },
  search_hotels:         { pt: "Buscando hotéis pra você! 🏨", en: "Searching hotels for you! 🏨", es: "Buscando hoteles para ti! 🏨" },
  search_flights:        { pt: "Procurando voos! ✈️", en: "Searching flights! ✈️", es: "Buscando vuelos! ✈️" },
  search_events:         { pt: "Buscando eventos! 🎫", en: "Searching events! 🎫", es: "Buscando eventos! 🎫" },
  get_directions:        { pt: "Calculando a rota! 🗺️", en: "Calculating the route! 🗺️", es: "Calculando la ruta! 🗺️" },
  fill_form:             { pt: "Preenchendo o formulário! 📝", en: "Filling the form! 📝", es: "Rellenando el formulario! 📝" },
  compare_prices:        { pt: "Comparando preços! 💰", en: "Comparing prices! 💰", es: "Comparando precios! 💰" },
  find_stores:           { pt: "Procurando lojas perto de você! 🏪", en: "Finding stores near you! 🏪", es: "Buscando tiendas cerca de ti! 🏪" },
  find_home_service:     { pt: "Procurando profissionais! 🔧", en: "Finding professionals! 🔧", es: "Buscando profesionales! 🔧" },
  find_mechanic:         { pt: "Procurando mecânicos! 🔧", en: "Finding mechanics! 🔧", es: "Buscando mecánicos! 🔧" },
  web_search:            { pt: "Pesquisando na web! 🌐", en: "Searching the web! 🌐", es: "Buscando en la web! 🌐" },
  track_package:         { pt: "Rastreando seu pacote! 📦", en: "Tracking your package! 📦", es: "Rastreando tu paquete! 📦" },
};

async function sendToolAcknowledge(userId: string, toolName: string, userFacts: { fact_key: string; fact_value: string }[]) {
  const ack = TOOL_ACKNOWLEDGE[toolName];
  if (!ack) return;
  if (!userId.startsWith("whatsapp:")) return; // Only for WhatsApp

  // Detect language from user facts
  const langFact = userFacts.find(f => f.fact_key === "language" || f.fact_key === "preferred_language");
  const lang = langFact?.fact_value?.toLowerCase() || "en";
  const msg = lang.includes("portu") || lang.includes("pt") ? ack.pt
    : lang.includes("espa") || lang.includes("es") ? ack.es
    : ack.en;

  try {
    const { sendWhatsAppMessage } = await import("./twilio-whatsapp.service.js");
    await sendWhatsAppMessage(userId, msg);
  } catch (err) {
    console.error(`[WA ACK] Failed to send acknowledge for ${toolName}:`, (err as Error).message);
  }
}

// Store user facts reference for acknowledge messages
let _currentUserFacts: { fact_key: string; fact_value: string }[] = [];

// ─── Tool Handler ──────────────────────────────────────

async function handleTool(userId: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  // DISABLED: sendToolAcknowledge causes message spam loop (2026-03-24)
  // await sendToolAcknowledge(userId, name, _currentUserFacts);
  // Auto-inject user coordinates for location-aware searches
  const locationTools = ["search_restaurants", "search_hotels", "search_events", "find_stores", "search_products"];
  if (locationTools.includes(name) && !args.latitude && !args.longitude) {
    const loc = await getUserLocation(userId);
    if (loc) {
      args.latitude = loc.latitude;
      args.longitude = loc.longitude;
    }
  }

  switch (name) {
    case "web_search": {
      // Use Gemini's native Google Search grounding instead of browser scraping
      try {
        const searchGenAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        const searchModel = searchGenAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          tools: [{ googleSearch: {} } as any],
        });

        const isNews = args.type === "news";
        const typeHint = isNews ? " (latest news)" : args.type === "shopping" ? " (shopping/prices)" : "";
        const searchPrompt = isNews
          ? `Search for the latest news about: ${args.query}. Return ONLY a brief bullet-point summary (max 5 items). Each item: one sentence with the key fact + source name. No introductions, no conclusions. Keep total response under 500 characters. Use plain text, no markdown.`
          : `Search the web for: ${args.query}${typeHint}. Return a concise summary of the most relevant results. Include key facts and source names. Keep response under 600 characters. Use plain text, no markdown.`;

        const searchResult = await Promise.race([
          searchModel.generateContent(searchPrompt),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Search timeout after 15s")), 15000)),
        ]);
        const searchText = searchResult.response.text().substring(0, 800);

        const groundingMeta = (searchResult.response.candidates?.[0] as any)?.groundingMetadata;
        const sources = groundingMeta?.groundingChunks?.map((c: any) => c.web?.uri).filter(Boolean) || [];

        return {
          query: args.query,
          content: searchText,
          sources: sources.length > 0 ? sources.slice(0, 3) : undefined,
          method: "google_search_grounding",
        };
      } catch (err) {
        console.error("[web_search] Grounding failed:", (err as Error).message);
        return { error: `Web search failed: ${(err as Error).message}` };
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
      console.log(`[APIFY-SEARCH] Tool called: search_products { query: "${args.query}", platform: "${args.platform || "amazon"}" }`);
      try {
        const { searchProducts } = await import("./apify-ecommerce.service.js");
        // Determine user country for localized results
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
          select: { country: true },
        });
        const country = userRecord?.country || "US";

        const result = await searchProducts({
          query: args.query as string,
          platform: (args.platform as string) || "amazon",
          maxResults: Math.min((args.max_results as number) || 5, 10),
          country,
        }, userId);

        if (result.products.length === 0) {
          return {
            products: [],
            message: `No products found for "${args.query}". USE YOUR TRAINING KNOWLEDGE to tell the user about this product — approximate price, where to buy, and direct retailer URLs.`,
          };
        }

        // Format with price ranking
        const formatted = result.products.map((p, i) => ({
          rank: i + 1,
          title: p.title,
          price: p.price ? `${p.currency} ${p.price.toFixed(2)}` : "Price unavailable",
          rating: p.rating ? `${p.rating}/5` : null,
          reviews: p.reviewCount,
          platform: p.platform,
          url: p.url,
          discounted: p.isDiscounted || false,
          asin: p.asin,
        }));

        return {
          totalProducts: result.totalResults,
          platforms: result.platforms,
          products: formatted,
          instruction: "Present products as a RANKED LIST by price (cheapest first). Include: rank number, product name, price, rating, and clickable link. Highlight the BEST VALUE option.",
        };
      } catch (err) {
        console.error("[APIFY-SEARCH] Error:", err);
        return {
          error: `Product search failed: ${(err as Error).message}`,
          fallback_instruction: "IMPORTANT: The search tool failed but you MUST still help the user. Use your training knowledge to provide: approximate price, known retailers (Amazon, Best Buy, Walmart, Mercado Livre), and direct URLs. Mark prices as approximate.",
        };
      }
    }

    case "set_reminder": {
      try {
        // Detect channel from userId format
        const reminderChannel = userId.startsWith("whatsapp:") ? "whatsapp" : "telegram";
        const result = await prisma.$queryRaw<{ id: number; remind_at: string }[]>`
          INSERT INTO openclaw_reminders (user_id, reminder_text, remind_at, category, recurring, channel, channel_id)
          VALUES (${userId}, ${args.text as string}, ${args.remindAt as string}::timestamptz, ${(args.category as string) || "general"}, ${(args.recurring as string) || null}, ${reminderChannel}, ${userId})
          RETURNING id, remind_at
        `;
        return { success: true, reminderId: result[0]?.id, remindAt: result[0]?.remind_at, channel: reminderChannel };
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
          return { results: [], message: `No products found for "${args.query}". USE YOUR TRAINING KNOWLEDGE to tell the user about this product — approximate price, where to buy, and direct retailer URLs.` };
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
        return { error: `Amazon search failed: ${(err as Error).message}`, fallback_instruction: "IMPORTANT: The search tool failed but you MUST still help the user. Use your training knowledge to provide: approximate price, known retailers (Amazon, Best Buy, Walmart, Mercado Livre), and direct URLs. Mark prices as approximate." };
      }
    }

    // ─── CAP 1: Generate PDF Document ─────────────────────
    case "generate_document": {
      console.log(`[GENERATE_DOC] Tool called: generate_document { title: "${args.title}", type: "${args.type || "general"}" }`);
      try {
        const { writeFile, unlink } = await import("fs/promises");
        const { execSync } = await import("child_process");
        const { randomUUID } = await import("crypto");

        const docId = randomUUID();
        const mdPath = `/tmp/doc_${docId}.md`;
        const htmlPath = `/tmp/doc_${docId}.html`;
        const pdfPath = `/tmp/doc_${docId}.pdf`;

        // Write markdown content
        const mdContent = `# ${args.title}\n\n${args.content}`;
        await writeFile(mdPath, mdContent, "utf-8");

        // Convert: Markdown → HTML → PDF (pandoc + wkhtmltopdf)
        execSync(`pandoc "${mdPath}" -o "${htmlPath}" --standalone --metadata title="${(args.title as string).replace(/"/g, '\\"')}"`, { timeout: 15000 });
        execSync(`wkhtmltopdf --quiet --enable-local-file-access "${htmlPath}" "${pdfPath}"`, { timeout: 30000 });

        // Cleanup temp files
        await unlink(mdPath).catch(() => {});
        await unlink(htmlPath).catch(() => {});

        // Store PDF for serving via /api/docs/temp/:id
        const { docStore } = await import("../routes/whatsapp-webhook.js");
        const fileId = `${Date.now()}_${docId.slice(0, 8)}`;
        const filename = `${(args.title as string).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)}.pdf`;
        docStore.set(fileId, { path: pdfPath, mimeType: "application/pdf", filename, createdAt: Date.now() });

        const publicUrl = `${process.env.PAYJARVIS_PUBLIC_URL || process.env.WEB_URL || "https://www.payjarvis.com"}/api/docs/temp/${fileId}`;

        // Send document to WhatsApp user via Twilio
        if (userId.startsWith("whatsapp:")) {
          const { sendWhatsAppDocument } = await import("./twilio-whatsapp.service.js");
          await sendWhatsAppDocument(userId, publicUrl, `📄 ${args.title}`);
        }

        return { success: true, title: args.title, pdfUrl: publicUrl, message: `Document "${args.title}" generated and sent as PDF.` };
      } catch (err) {
        console.error("[GENERATE_DOC] Error:", (err as Error).message);
        return { error: `Failed to generate document: ${(err as Error).message}` };
      }
    }

    // ─── CAP 4: Export Transactions PDF ──────────────────
    case "export_transactions": {
      console.log(`[EXPORT_TX] Tool called: export_transactions { period: "${args.period || "all"}" }`);
      try {
        const { randomUUID } = await import("crypto");

        // Resolve user to get their formal account
        const cleanPhone = userId.replace("whatsapp:", "");
        const user = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: cleanPhone }, { phone: cleanPhone.replace("+", "") }] },
          select: { id: true, clerkId: true, bots: { select: { id: true }, take: 1 } },
        });

        if (!user) return { error: "No account found. Create an account at payjarvis.com first." };

        // Calculate date range from period
        const now = new Date();
        let dateFrom: string | undefined;
        const period = (args.period as string) || "all";
        if (period === "last_week") {
          dateFrom = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
        } else if (period === "last_month") {
          dateFrom = new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0];
        } else if (period === "last_3months") {
          dateFrom = new Date(now.getTime() - 90 * 86400000).toISOString().split("T")[0];
        }

        const botId = user.bots?.[0]?.id;

        // Fetch transactions directly
        const where: Record<string, unknown> = { ownerId: user.id };
        if (botId) where.botId = botId;
        if (dateFrom) where.createdAt = { gte: new Date(dateFrom) };

        const transactions = await prisma.transaction.findMany({
          where: where as any,
          orderBy: { createdAt: "desc" },
        });

        if (transactions.length === 0) {
          return { success: true, message: "No transactions found for this period.", count: 0 };
        }

        // Generate PDF using pdfkit
        const PDFDocument = (await import("pdfkit")).default;
        const doc = new PDFDocument({ margin: 50, size: "A4" });
        const chunks: Buffer[] = [];
        doc.on("data", (chunk: Buffer) => chunks.push(chunk));

        doc.fontSize(22).font("Helvetica-Bold").text("PayJarvis", 50, 50);
        doc.fontSize(8).font("Helvetica").fillColor("#888888").text("Transaction Statement", 50, 75);
        doc.fillColor("#000000").moveDown(2);
        doc.fontSize(9).font("Helvetica");
        doc.text(`Period: ${dateFrom || "all time"} to ${now.toISOString().split("T")[0]}`);
        doc.text(`Generated: ${now.toLocaleDateString("en-US")} ${now.toLocaleTimeString("en-US")}`);
        doc.moveDown(1.5);

        const tableTop = doc.y;
        doc.fontSize(8).font("Helvetica-Bold");
        doc.text("Date", 50, tableTop, { width: 70 });
        doc.text("Merchant", 120, tableTop, { width: 110 });
        doc.text("Category", 230, tableTop, { width: 70 });
        doc.text("Amount", 300, tableTop, { width: 70, align: "right" });
        doc.text("Decision", 380, tableTop, { width: 80 });
        doc.moveDown();
        doc.moveTo(50, doc.y).lineTo(460, doc.y).strokeColor("#cccccc").stroke();
        doc.moveDown(0.3);

        doc.font("Helvetica").fontSize(7.5);
        let totalApproved = 0, totalBlocked = 0;

        for (const tx of transactions) {
          if (doc.y > 720) doc.addPage();
          const y = doc.y;
          doc.text(new Date(tx.createdAt).toLocaleDateString("en-US"), 50, y, { width: 70 });
          doc.text(tx.merchantName.slice(0, 20), 120, y, { width: 110 });
          doc.text(tx.category, 230, y, { width: 70 });
          doc.text(`${tx.currency} ${tx.amount.toFixed(2)}`, 300, y, { width: 70, align: "right" });
          const color = tx.decision === "APPROVED" ? "#22c55e" : tx.decision === "BLOCKED" ? "#ef4444" : "#eab308";
          doc.fillColor(color).text(tx.decision, 380, y, { width: 80 });
          doc.fillColor("#000000").moveDown(0.3);
          if (tx.decision === "APPROVED") totalApproved += tx.amount;
          if (tx.decision === "BLOCKED") totalBlocked += tx.amount;
        }

        doc.moveDown(2);
        doc.fontSize(9).font("Helvetica-Bold");
        doc.text(`Total Approved: $${totalApproved.toFixed(2)} | Total Blocked: $${totalBlocked.toFixed(2)} | Transactions: ${transactions.length}`, 50);
        doc.end();

        const pdfBuffer = await new Promise<Buffer>((resolve) => {
          doc.on("end", () => resolve(Buffer.concat(chunks)));
        });

        // Save PDF to temp file and serve
        const { writeFile } = await import("fs/promises");
        const docId = randomUUID().slice(0, 8);
        const pdfPath = `/tmp/extrato_${docId}.pdf`;
        await writeFile(pdfPath, pdfBuffer);

        const { docStore } = await import("../routes/whatsapp-webhook.js");
        const fileId = `extrato_${Date.now()}_${docId}`;
        docStore.set(fileId, { path: pdfPath, mimeType: "application/pdf", filename: `payjarvis-extrato.pdf`, createdAt: Date.now() });

        const publicUrl = `${process.env.PAYJARVIS_PUBLIC_URL || process.env.WEB_URL || "https://www.payjarvis.com"}/api/docs/temp/${fileId}`;

        // Send to WhatsApp
        if (userId.startsWith("whatsapp:")) {
          const { sendWhatsAppDocument } = await import("./twilio-whatsapp.service.js");
          await sendWhatsAppDocument(userId, publicUrl, `📊 Transaction Statement — ${transactions.length} transactions`);
        }

        return { success: true, count: transactions.length, totalApproved, totalBlocked, pdfUrl: publicUrl, message: `Statement with ${transactions.length} transactions generated and sent.` };
      } catch (err) {
        console.error("[EXPORT_TX] Error:", (err as Error).message);
        return { error: `Failed to export transactions: ${(err as Error).message}` };
      }
    }

    // ─── CAP 2: Fill Form on Website ─────────────────────
    case "fill_form": {
      console.log(`[FILL_FORM] Tool called: fill_form { url: "${args.url}" }`);
      try {
        const res = await fetch(`${BROWSER_AGENT_URL}/fill-form`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: args.url,
            fields: typeof args.fields === "string" ? JSON.parse(args.fields as string) : args.fields,
            instructions: args.instructions || "",
          }),
          signal: AbortSignal.timeout(60000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (!data.success) return { error: data.error || "Form filling failed" };
        return { success: true, url: data.url, message: data.message || "Form filled. Ask the user to confirm before submitting.", screenshotAvailable: !!data.screenshot };
      } catch (err) {
        return { error: `Form filling failed: ${(err as Error).message}` };
      }
    }

    // ─── Google Maps: Directions ──────────────────────
    case "get_directions": {
      console.log(`[DIRECTIONS] ${args.origin} → ${args.destination} (${args.mode || "driving"})`);
      try {
        const { getDirections } = await import("./commerce/google-maps.js");
        const result = await getDirections({
          origin: args.origin as string,
          destination: args.destination as string,
          mode: (args.mode as "driving" | "walking" | "transit") || "driving",
        });
        if (result.error) return { error: result.error };
        return {
          origin: result.origin,
          destination: result.destination,
          distance: result.distance,
          duration: result.duration,
          durationInTraffic: result.durationInTraffic,
          steps: result.steps.slice(0, 5),
        };
      } catch (err) {
        return { error: `Directions failed: ${(err as Error).message}` };
      }
    }

    // ─── Google Maps: Geocoding ───────────────────────
    case "geocode_address": {
      console.log(`[GEOCODE] ${args.address}`);
      try {
        const { geocode } = await import("./commerce/google-maps.js");
        const result = await geocode(args.address as string);
        if (result.error) return { error: result.error };
        return {
          address: result.formattedAddress,
          latitude: result.latitude,
          longitude: result.longitude,
          city: result.components.locality || result.components.administrative_area_level_2,
          state: result.components.administrative_area_level_1,
          country: result.components.country,
          zipCode: result.components.postal_code,
        };
      } catch (err) {
        return { error: `Geocoding failed: ${(err as Error).message}` };
      }
    }

    case "setup_vault": {
      console.log(`[ZK-VAULT] setup_vault for userId=${userId}`);
      const PAYJARVIS_URL = process.env.API_URL || "http://localhost:3001";
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/vault/zk/setup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, pin: args.pin as string }),
        });
        const result = await res.json() as { success: boolean; error?: string };
        if (result.success) return { success: true, message: "Vault configured with Zero-Knowledge encryption" };
        return { error: result.error || "Failed to set up vault" };
      } catch (err) {
        return { error: `Vault setup failed: ${(err as Error).message}` };
      }
    }

    case "save_card": {
      console.log(`[ZK-VAULT] save_card for userId=${userId}`);
      const PAYJARVIS_URL = process.env.API_URL || "http://localhost:3001";
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/vault/zk/store`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            pin: args.pin as string,
            itemType: "card",
            label: (args.label as string) || "",
            data: {
              number: args.card_number as string,
              expiry: args.expiry as string,
              cvv: args.cvv as string,
              name: args.cardholder_name as string,
            },
          }),
        });
        const result = await res.json() as { success: boolean; label?: string; error?: string };
        if (result.success) return { success: true, label: result.label, message: "Card saved with Zero-Knowledge encryption" };
        return { error: result.error || "Failed to save card" };
      } catch (err) {
        return { error: `Card save failed: ${(err as Error).message}` };
      }
    }

    case "list_vault_items": {
      console.log(`[ZK-VAULT] list_vault_items for userId=${userId}`);
      const PAYJARVIS_URL = process.env.API_URL || "http://localhost:3001";
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/vault/zk/items/${userId}`);
        const result = await res.json() as { success: boolean; hasVault: boolean; items: { id: string; itemType: string; label: string }[] };
        return { hasVault: result.hasVault, items: result.items };
      } catch (err) {
        return { error: `List failed: ${(err as Error).message}` };
      }
    }

    case "delete_vault_item": {
      console.log(`[ZK-VAULT] delete_vault_item ${args.item_id} for userId=${userId}`);
      const PAYJARVIS_URL = process.env.API_URL || "http://localhost:3001";
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/vault/zk/items/${args.item_id}?userId=${userId}`, { method: "DELETE" });
        const result = await res.json() as { success: boolean; error?: string };
        return result;
      } catch (err) {
        return { error: `Delete failed: ${(err as Error).message}` };
      }
    }

    case "make_phone_call": {
      console.log(`[VOICE] make_phone_call for userId=${userId}: ${args.phone_number} → ${args.objective}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        let phoneNumber = args.phone_number as string | undefined;
        const contactName = (args.business_name as string) || "";

        // Auto-lookup contact if name provided and no phone number
        if (!phoneNumber && contactName) {
          const lookupRes = await fetch(`${VOICE_API_URL}/api/voice/contacts/lookup?userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(contactName)}`, {
            headers: { "x-internal-secret": VOICE_SECRET },
          });
          if (lookupRes.ok) {
            const lookupData = await lookupRes.json() as { success: boolean; contact?: { phone: string; name: string } };
            if (lookupData.success && lookupData.contact) {
              phoneNumber = lookupData.contact.phone;
              console.log(`[VOICE] Auto-resolved contact "${contactName}" → ${phoneNumber}`);
            }
          }
          if (!phoneNumber) {
            return { error: `I don't have ${contactName}'s phone number saved. What's their number?`, needsNumber: true, contactName };
          }
        }

        if (!phoneNumber) {
          return { error: "I need a phone number or a contact name to make the call." };
        }

        // Auto-save contact if name + phone provided
        if (contactName && phoneNumber) {
          try {
            await fetch(`${VOICE_API_URL}/api/voice/contacts`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
              body: JSON.stringify({ userId, name: contactName, phone: phoneNumber }),
            });
            console.log(`[VOICE] Auto-saved contact: ${contactName} → ${phoneNumber}`);
          } catch { /* non-critical */ }
        }

        const channel = userId.startsWith("whatsapp:") ? "whatsapp" : "telegram";
        const res = await fetch(`${VOICE_API_URL}/api/voice/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
          body: JSON.stringify({
            userId,
            to: phoneNumber,
            businessName: contactName || undefined,
            objective: args.objective as string,
            details: (args.details as string) || undefined,
            language: (args.language as string) || "en",
            channel,
          }),
        });
        const result = await res.json() as { success: boolean; callId?: string; error?: string };
        if (result.success) {
          return { success: true, callId: result.callId, message: `Call initiated to ${contactName || phoneNumber}. I'll notify you when the call is complete with the result.` };
        }
        return { error: result.error || "Failed to initiate call" };
      } catch (err) {
        return { error: `Call failed: ${(err as Error).message}` };
      }
    }

    case "verify_caller_id": {
      console.log(`[VOICE] verify_caller_id for userId=${userId}: ${args.phone_number}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        const res = await fetch(`${VOICE_API_URL}/api/voice/verify-caller`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
          body: JSON.stringify({
            userId,
            phoneNumber: args.phone_number as string,
            friendlyName: "PayJarvis User",
          }),
        });
        const result = await res.json() as { success: boolean; validationCode?: string; error?: string };
        if (result.success) {
          return {
            success: true,
            validationCode: result.validationCode,
            message: `Twilio is calling ${args.phone_number} now with a verification code. The code is: ${result.validationCode}. Tell the user to answer the call and enter this code on their phone keypad. Once verified, their number will appear as caller ID on all future calls.`,
          };
        }
        return { error: result.error || "Verification failed" };
      } catch (err) {
        return { error: `Verification failed: ${(err as Error).message}` };
      }
    }

    case "call_user": {
      console.log(`[VOICE] call_user for userId=${userId}: ${args.reason}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        // Resolve user phone number
        const cleanPhone = userId.replace("whatsapp:", "");
        let userPhone = cleanPhone;
        if (!userPhone.startsWith("+")) {
          // Try to find phone from DB for Telegram users
          const userRow = await prisma.user.findFirst({
            where: { OR: [{ telegramChatId: userId }, { phone: cleanPhone }] },
            select: { phone: true },
          });
          userPhone = userRow?.phone || cleanPhone;
        }

        if (!userPhone || userPhone.length < 8) {
          return { error: "I don't have your phone number on file. Please share your number first." };
        }

        const channel = userId.startsWith("whatsapp:") ? "whatsapp" : "telegram";
        const res = await fetch(`${VOICE_API_URL}/api/voice/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
          body: JSON.stringify({
            userId,
            to: userPhone.startsWith("+") ? userPhone : `+${userPhone}`,
            businessName: "Jarvis Live Call",
            objective: "live_conversation",
            details: `Live voice call with user. Reason: ${args.reason || "user requested"}. Use ALL tools available. Keep responses SHORT (1-2 sentences). When user says bye/tchau/obrigado, end the call gracefully.`,
            language: "en",
            channel,
          }),
        });
        const result = await res.json() as { success: boolean; callId?: string; error?: string };
        if (result.success) {
          return { success: true, callId: result.callId, message: `Calling you now at ${userPhone}. Pick up your phone!` };
        }
        return { error: result.error || "Failed to initiate call" };
      } catch (err) {
        return { error: `Call failed: ${(err as Error).message}` };
      }
    }

    case "list_contacts": {
      console.log(`[VOICE] list_contacts for userId=${userId}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        const res = await fetch(`${VOICE_API_URL}/api/voice/contacts?userId=${encodeURIComponent(userId)}`, {
          headers: { "x-internal-secret": VOICE_SECRET },
        });
        const result = await res.json() as { success: boolean; contacts?: Array<{ name: string; phone: string; relationship: string | null }> };
        if (result.success && result.contacts) {
          if (result.contacts.length === 0) {
            return { message: "You don't have any saved contacts yet. When you make calls, contacts are saved automatically." };
          }
          return { contacts: result.contacts, count: result.contacts.length };
        }
        return { error: "Failed to load contacts" };
      } catch (err) {
        return { error: `Failed: ${(err as Error).message}` };
      }
    }

    case "delete_contact": {
      console.log(`[VOICE] delete_contact for userId=${userId}: ${args.name}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        const res = await fetch(`${VOICE_API_URL}/api/voice/contacts/${encodeURIComponent(args.name as string)}?userId=${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers: { "x-internal-secret": VOICE_SECRET },
        });
        const result = await res.json() as { success: boolean; message?: string };
        return result;
      } catch (err) {
        return { error: `Failed: ${(err as Error).message}` };
      }
    }

    case "update_contact": {
      console.log(`[VOICE] update_contact for userId=${userId}: ${args.name} → ${args.phone}`);
      const VOICE_API_URL = process.env.API_URL || "http://localhost:3001";
      const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
      try {
        // Save with new phone (upsert behavior)
        const res = await fetch(`${VOICE_API_URL}/api/voice/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
          body: JSON.stringify({ userId, name: args.name as string, phone: args.phone as string }),
        });
        const result = await res.json() as { success: boolean };
        if (result.success) {
          return { success: true, message: `Contact ${args.name} updated to ${args.phone}` };
        }
        return { error: "Failed to update contact" };
      } catch (err) {
        return { error: `Failed: ${(err as Error).message}` };
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

  // Detect user language for localized response
  const langFact = await prisma.$queryRaw<{ fact_value: string }[]>`
    SELECT fact_value FROM openclaw_user_facts
    WHERE user_id = ${userId} AND fact_key = 'preferred_language'
    LIMIT 1
  `;
  const isPt = langFact.length > 0 && /portugu/i.test(langFact[0].fact_value);
  const lang = isPt ? "pt" : "en";

  // Generate personalized referral invite card
  const { mkdir } = await import("fs/promises");
  const { execSync } = await import("child_process");
  const cardDir = join(process.cwd(), "public", "cards");
  await mkdir(cardDir, { recursive: true });
  const cardFileName = `referral_${code}.png`;
  const cardFilePath = join(cardDir, cardFileName);
  const cardPublicUrl = `${PUBLIC_BASE}/public/cards/${cardFileName}`;

  const REFERRAL_CARD_SCRIPT = "/root/Payjarvis/scripts/generate_referral_card.py";
  try {
    execSync(`python3 ${REFERRAL_CARD_SCRIPT} --name "${firstName.replace(/"/g, '\\"')}" --lang ${lang} --output "${cardFilePath}"`, { timeout: 15000 });
    console.log(`[WA SHARE] Generated referral card: ${cardFilePath}`);
  } catch (cardErr) {
    console.error("[WA SHARE] Card generation failed, falling back to QR:", (cardErr as Error).message);
  }

  // Generate QR Code as fallback / secondary image
  const qrFileName = `qr_${code}.png`;
  const qrDir = join(process.cwd(), "public", "qr");
  const qrFilePath = join(qrDir, qrFileName);
  await mkdir(qrDir, { recursive: true });

  await QRCode.toFile(qrFilePath, whatsappLink, {
    width: 512,
    margin: 2,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  // Send via Twilio MMS — prefer invite card, fallback to QR
  const twilioMod = await import("twilio");
  const Twilio = twilioMod.default;
  const client = Twilio(
    process.env.TWILIO_ACCOUNT_SID || "",
    process.env.TWILIO_AUTH_TOKEN || ""
  );

  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || `whatsapp:+${WA_NUMBER}`;
  const toNumber = userId.startsWith("whatsapp:") ? userId : `whatsapp:${userId}`;

  const { existsSync } = await import("fs");
  const hasCard = existsSync(cardFilePath);
  const mediaUrl = hasCard ? cardPublicUrl : `${PUBLIC_BASE}/public/qr/${qrFileName}`;

  const bodyPt = `📲 *Seu link de convite:*\n\n${whatsappLink}\n\nSeu amigo(a) ganha acesso Beta grátis ao Jarvis!\nOu escaneie o QR Code acima.`;
  const bodyEn = `📲 *Your referral link:*\n\n${whatsappLink}\n\nYour friend gets free Beta access!\nOr scan the QR Code above.`;

  await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: isPt ? bodyPt : bodyEn,
    mediaUrl: [mediaUrl],
  });

  console.log(`[WA SHARE] Generated referral for ${userId}: ${code} → ${whatsappLink} (card: ${hasCard}, lang: ${lang})`);

  return {
    success: true,
    code,
    whatsappLink,
    webLink,
    cardSent: hasCard,
    qrCodeSent: !hasCard,
    message: isPt
      ? `Link de convite gerado e enviado! Seu amigo(a) ganha acesso Beta grátis ao Jarvis.`
      : `Referral link generated and sent! Your friend gets free Beta access to Jarvis.`,
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

export async function chatWithGemini(
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  userId: string,
  userFacts: { fact_key: string; fact_value: string }[]
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "Jarvis is temporarily unavailable. Please try again in a moment.";
  }

  // Store user facts for tool acknowledge messages (BUG 2 fix)
  _currentUserFacts = userFacts;

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

  // Search tools that should trigger knowledge fallback on failure
  const SEARCH_TOOLS = new Set([
    "search_products", "amazon_search", "search_restaurants", "search_hotels",
    "search_flights", "search_events", "web_search", "browse", "compare_prices",
    "find_stores", "search_transit", "search_rental_cars", "find_home_service",
    "find_mechanic", "search_products_latam", "search_products_global",
  ]);

  // Function calling loop (max 8 iterations)
  let iterations = 0;
  while (response.functionCalls() && response.functionCalls()!.length > 0 && iterations < 8) {
    iterations++;
    const functionCalls = response.functionCalls()!;
    const functionResponses = [];
    let failedSearchQuery = "";

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

      // Inject strong fallback directive when search tools fail
      if (SEARCH_TOOLS.has(call.name) && toolResult.error) {
        const args = call.args as Record<string, unknown>;
        failedSearchQuery = (args.query || args.term || args.keyword || userMessage) as string;
        toolResult = {
          error: toolResult.error,
          MANDATORY_FALLBACK: `The search tool "${call.name}" failed. You MUST respond using your training knowledge about "${failedSearchQuery}". Include: approximate price, where to buy (with direct URLs like amazon.com, bestbuy.com, etc), and key product details. Mark prices as "approximate price". NEVER say "não foi possível" or "I couldn't find" — give the user a USEFUL answer with your knowledge.`,
        };
      }

      functionResponses.push({
        functionResponse: { name: call.name, response: toolResult },
      });
    }

    try {
      result = await chatSession.sendMessage(functionResponses);
      response = result.response;
    } catch (err) {
      console.error(`[WA CHAT] Error sending function response: ${(err as Error).message}`);

      // Knowledge-based fallback when tool response also fails
      if (failedSearchQuery) {
        console.log(`[WA FALLBACK] Using knowledge fallback for: ${failedSearchQuery}`);
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        try {
          const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
          const fallbackResult = await fallbackModel.generateContent(
            `The user asked: "${userMessage}". All search tools failed. Answer using your training knowledge. Include approximate prices, recommended retailers with direct URLs, and key details. Mark prices as approximate. Respond in the same language as the user's message. Be concise (max 3 lines).`
          );
          return fallbackResult.response.text() || "Erro ao processar resultados. Tente novamente.";
        } catch {
          return "Erro ao processar resultados. Tente novamente.";
        }
      }
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

// ─── Gemini Chat with Image (multimodal) ─────────────

export async function chatWithGeminiMultimodal(
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  imageBase64: string,
  imageMimeType: string,
  userId: string,
  userFacts: { fact_key: string; fact_value: string }[]
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "Jarvis is temporarily unavailable. Please try again in a moment.";
  }

  // Store user facts for tool acknowledge messages (BUG 2 fix)
  _currentUserFacts = userFacts;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const systemPrompt = buildSystemPrompt(userFacts);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    tools,
  });

  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [
    { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
    { text: userMessage || "Analyze this image and tell me how I can help." },
  ];

  let chatSession = model.startChat({ history });
  let result;
  let response;

  try {
    result = await chatSession.sendMessage(parts);
    response = result.response;
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    if (e.status === 400 || (e.message && e.message.includes("400"))) {
      console.error("[WA IMAGE] 400 error, retrying with empty history");
      chatSession = model.startChat({ history: [] });
      result = await chatSession.sendMessage(parts);
      response = result.response;
    } else {
      throw err;
    }
  }

  // Function calling loop (max 8 iterations)
  const SEARCH_TOOLS = new Set([
    "search_products", "amazon_search", "search_restaurants", "search_hotels",
    "search_flights", "search_events", "web_search", "browse", "compare_prices",
    "find_stores", "search_transit", "search_rental_cars", "find_home_service",
    "find_mechanic", "search_products_latam", "search_products_global",
  ]);
  let iterations = 0;
  while (response.functionCalls() && response.functionCalls()!.length > 0 && iterations < 8) {
    iterations++;
    const functionCalls = response.functionCalls()!;
    const functionResponses = [];

    for (const call of functionCalls) {
      console.log(`[WA IMAGE TOOL] ${call.name}(${JSON.stringify(call.args).substring(0, 100)})`);
      let toolResult: Record<string, unknown>;
      try {
        toolResult = await handleTool(userId, call.name, call.args as Record<string, unknown>);
      } catch (err) {
        toolResult = { error: (err as Error).message || "Tool execution failed" };
      }
      if (Array.isArray(toolResult)) {
        toolResult = { results: toolResult };
      } else if (toolResult === null || toolResult === undefined) {
        toolResult = { result: "no data" };
      } else if (typeof toolResult !== "object") {
        toolResult = { value: String(toolResult) };
      }
      toolResult = JSON.parse(JSON.stringify(toolResult));
      console.log(`[WA IMAGE TOOL] ${call.name} =>`, JSON.stringify(toolResult).substring(0, 150));
      functionResponses.push({
        functionResponse: { name: call.name, response: toolResult },
      });
    }

    try {
      result = await chatSession.sendMessage(functionResponses);
      response = result.response;
    } catch (err) {
      console.error(`[WA IMAGE] Error sending function response: ${(err as Error).message}`);
      return "Sorry, I encountered a problem processing the results. Please try again.";
    }
  }

  const text = response.text();
  return text || "I analyzed the image but couldn't generate a response. Please try again.";
}

// ─── Fact Extraction (background) ──────────────────────

export async function extractAndSaveFacts(userId: string, userMessage: string, modelResponse: string) {
  if (!GEMINI_API_KEY) return;

  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Analyze this conversation and extract permanent facts about the user.
Return ONLY a JSON array. Each fact: { key (snake_case), value, category (shopping|travel|food|personal|health|finance|location|general) }.
Only PERMANENT preferences, not temporary requests. Max 5 facts. If none, return [].
ALWAYS extract location data if mentioned: zip_code, city, state, country.
Use CANONICAL keys only — do NOT create duplicates: zip_code, city, country, preferred_cuisine, preferred_language, name.
Do NOT create keys like food_cuisine_preference (use preferred_cuisine), user_name (use name), language (use preferred_language).

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

// ─── Conversation Summary (long-term memory) ─────────

export async function summarizeOldConversations(userId: string) {
  if (!GEMINI_API_KEY) return;

  try {
    // Count total messages
    const countResult = await prisma.$queryRaw<{ cnt: number }[]>`
      SELECT COUNT(*)::int AS cnt FROM openclaw_conversations WHERE user_id = ${userId}
    `;
    const totalMsgs = countResult[0]?.cnt || 0;
    if (totalMsgs <= 40) return; // Not enough to summarize

    const monthKey = new Date().toISOString().slice(0, 7);
    const summaryKey = `conversation_summary_${monthKey}`;

    // Get old messages (before the last 50)
    const oldMessages = await prisma.$queryRaw<{ role: string; content: string }[]>`
      SELECT role, content FROM openclaw_conversations
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
      LIMIT ${totalMsgs - 50}
    `;
    if (oldMessages.length < 10) return;

    const convoText = oldMessages
      .map(m => `[${m.role}] ${m.content.substring(0, 200)}`)
      .join("\n")
      .substring(0, 4000);

    // Check existing summary
    const existing = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${userId} AND fact_key = ${summaryKey}
    `;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `Summarize this conversation history into key facts about the user. Focus on:
- Personal information, location, preferences
- Decisions made and actions taken
- Products searched or purchased
- Recurring topics or concerns
Return 5-8 bullet points. Be factual and concise.
${existing.length > 0 ? `\nPrevious summary to UPDATE:\n${existing[0].fact_value}\n` : ""}
Conversation:\n${convoText}\n\nSummary:`;

    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    if (summary && summary.length > 20) {
      await prisma.$executeRaw`
        INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, updated_at)
        VALUES (${userId}, ${summaryKey}, ${summary}, 'memory', 'auto_summary', now())
        ON CONFLICT (user_id, fact_key) DO UPDATE SET
          fact_value = ${summary}, source = 'auto_summary', updated_at = now()
      `;
      console.log(`[WA SUMMARY] Generated for ${userId} (${oldMessages.length} old msgs)`);
    }
  } catch (err) {
    console.error("[WA SUMMARY] Error:", (err as Error).message);
  }
}

// ─── Geolocation ──────────────────────────────────────

export async function saveWhatsAppLocation(userId: string, latitude: number, longitude: number) {
  // Save to user facts
  await upsertFact(userId, "latitude", String(latitude), "location", "geolocation");
  await upsertFact(userId, "longitude", String(longitude), "location", "geolocation");

  // Also save to Prisma User if linked
  const cleanPhone = userId.replace("whatsapp:", "");
  try {
    await prisma.user.updateMany({
      where: { OR: [{ phone: cleanPhone }, { phone: cleanPhone.replace("+", "") }] },
      data: { latitude, longitude, locationUpdatedAt: new Date() },
    });
    console.log(`[WA LOCATION] Saved: ${userId} lat=${latitude} lng=${longitude}`);
  } catch { /* user may not have formal account yet */ }
}

async function getUserLocation(userId: string): Promise<{ latitude: number; longitude: number } | null> {
  const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
    SELECT fact_key, fact_value FROM openclaw_user_facts
    WHERE user_id = ${userId} AND fact_key IN ('latitude', 'longitude')
  `;
  const lat = facts.find(f => f.fact_key === "latitude");
  const lng = facts.find(f => f.fact_key === "longitude");
  if (lat && lng) {
    return { latitude: parseFloat(lat.fact_value), longitude: parseFloat(lng.fact_value) };
  }
  return null;
}

// ─── Image Message Entry Point ─────────────────────────

export async function processWhatsAppImageMessage(
  from: string,
  imageBase64: string,
  mimeType: string,
  caption: string
): Promise<string> {
  const userId = from;
  console.log(`[WhatsApp Image] ${userId}: caption="${(caption || "").substring(0, 80)}" imageSize=${imageBase64.length}`);

  // Resolve user
  let resolvedUserId: string | null = null;
  try {
    const cleanPhone = userId.replace("whatsapp:", "");
    const user = await prisma.user.findUnique({
      where: { phone: cleanPhone },
      select: { id: true },
    });
    if (user) resolvedUserId = user.id;
  } catch { /* non-blocking */ }

  // Check credits
  if (resolvedUserId) {
    try {
      const creditCheck = await consumeMessage(resolvedUserId, "whatsapp", 0, 0);
      if (!creditCheck.allowed) {
        return "Your messages have run out. Recharge to continue.";
      }
    } catch { /* allow */ }
  }

  try {
    let [history, userFacts] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
    ]);

    // Recovery fallback (same as text flow)
    if (userFacts.length === 0 && resolvedUserId) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: resolvedUserId },
          select: { fullName: true, email: true, botNickname: true },
        });
        if (dbUser?.fullName) {
          const seedFacts: [string, string, string][] = [];
          seedFacts.push(["user_name", dbUser.fullName, "identity"]);
          const firstName = dbUser.fullName.split(" ")[0];
          if (firstName) seedFacts.push(["first_name", firstName, "identity"]);
          if (dbUser.botNickname) seedFacts.push(["bot_nickname", dbUser.botNickname, "identity"]);
          if (dbUser.email) seedFacts.push(["email", dbUser.email, "identity"]);
          for (const [key, value, category] of seedFacts) {
            await upsertFact(userId, key, value, category, "recovery");
          }
          userFacts = await getUserContext(userId);
        }
      } catch { /* non-blocking */ }
    }

    const response = await chatWithGeminiMultimodal(history, caption, imageBase64, mimeType, userId, userFacts);
    await saveMessage(userId, "user", `[photo] ${caption || "image sent"}`);
    await saveMessage(userId, "model", response);

    // Extract facts in background
    extractAndSaveFacts(userId, caption || "image sent", response).catch((err) =>
      console.error("[WA IMAGE FACT] Background error:", err.message)
    );

    return response;
  } catch (err) {
    console.error("[WA IMAGE] Error:", (err as Error).message);
    return "Error processing image. Please try again.";
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
      const result = await startOnboarding(userId, "whatsapp", startMatch[1], text);
      return result.message;
    } catch (err) {
      console.error("[WA START] Error:", (err as Error).message);
      return "Erro ao iniciar. Tente novamente.";
    }
  }

  // 0b. Handle share/referral intent — detect before sending to Gemini
  const shareIntent = /\b(compartilh\w*|indicar|indic[aá]\w*|convidar|convid\w*|convite|share|invite|refer|qr\s*code|link.*(indic|refer|convit|compart)|amigo.*jarvis|jarvis.*amigo|mand[ae].*link|envi[ae].*link)\b/i;
  if (shareIntent.test(text)) {
    try {
      const result = await generateShareForWhatsApp(userId);
      if (result.success) {
        // Card/QR + link already sent by generateShareForWhatsApp
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", `Referral link sent: ${result.whatsappLink}`);
        return (result.message as string) || `📲 Link de convite enviado! Seu amigo(a) ganha acesso Beta grátis.`;
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
            const result = await startOnboarding(userId, "whatsapp", ref.share_code ?? undefined, text);
            return result.message;
          } catch (err) {
            console.error("[WA REFERRAL] Onboarding start error:", (err as Error).message);
            return "Erro ao iniciar. Tente novamente.";
          }
        }
      } catch (err) {
        console.error("[WA REFERRAL] Pending check error:", (err as Error).message);
      }

      // Check if this person was recently called by an existing user via Jarvis voice
      try {
        const recentCall = await prisma.$queryRaw<{ user_id: string; business_name: string; from: string }[]>`
          SELECT user_id, business_name, "from" FROM voice_calls
          WHERE "to" = ${cleanPhone} OR "to" = ${'+' + cleanPhone.replace('+', '')}
          ORDER BY created_at DESC LIMIT 1
        `;

        if (recentCall.length > 0) {
          const call = recentCall[0];
          // Find referrer's share code
          const referrerPhone = call.from;
          const referrer = await prisma.user.findFirst({
            where: { OR: [{ phone: referrerPhone }, { phone: '+' + referrerPhone.replace('+', '') }] },
            select: { id: true, fullName: true },
          });

          let shareCode: string | undefined;
          if (referrer) {
            const bot = await prisma.bot.findFirst({ where: { ownerId: referrer.id }, select: { id: true } });
            if (bot) {
              const link = await prisma.botShareLink.findFirst({
                where: { botId: bot.id, active: true },
                orderBy: { createdAt: "desc" },
                select: { code: true },
              });
              shareCode = link?.code ?? undefined;
            }
          }

          const referrerName = referrer?.fullName?.split(" ")[0] || call.business_name || "your friend";
          console.log(`[WhatsApp] Voice-call referral detected for ${cleanPhone}: called by ${referrerName} (${call.user_id}), share code: ${shareCode}`);

          try {
            const result = await startOnboarding(userId, "whatsapp", shareCode, text);
            return result.message;
          } catch (err) {
            console.error("[WA VOICE-REFERRAL] Onboarding start error:", (err as Error).message);
          }
        }
      } catch (err) {
        console.error("[WA VOICE-REFERRAL] Check error:", (err as Error).message);
      }

      // No referral context at all — detect language and show appropriate message
      console.log(`[WhatsApp] Unknown user ${userId} — no account, no onboarding, no referral context`);
      const isPt = /\b(oi|olá|ola|bom dia|boa tarde|boa noite|tudo bem|como vai|jarvis)\b/i.test(text);
      if (isPt) {
        return "Olá! 👋 Eu sou o Jarvis, seu assistente pessoal com IA.\n\nParece que você ainda não tem uma conta. Para começar:\n\n1. Peça a um amigo que já usa o Jarvis um convite\n2. Ou acesse payjarvis.com para criar sua conta\n\nEstamos em Beta — o acesso é totalmente grátis!";
      }
      return "Hi! 👋 I'm Jarvis, your personal AI assistant.\n\nIt looks like you don't have an account yet. To get started:\n\n1. Ask a friend who already uses Jarvis for an invite\n2. Or visit payjarvis.com to create your account\n\nWe're in Beta — access is completely free!";
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
    let [history, userFacts] = await Promise.all([
      getHistory(userId),
      getUserContext(userId),
    ]);

    // Fallback: if no facts exist but user has a DB record, seed from users table
    if (userFacts.length === 0 && resolvedUserId) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { id: resolvedUserId },
          select: { fullName: true, email: true, botNickname: true },
        });
        if (dbUser?.fullName) {
          const seedFacts: [string, string, string][] = [];
          seedFacts.push(["user_name", dbUser.fullName, "identity"]);
          const firstName = dbUser.fullName.split(" ")[0];
          if (firstName) seedFacts.push(["first_name", firstName, "identity"]);
          if (dbUser.botNickname) seedFacts.push(["bot_nickname", dbUser.botNickname, "identity"]);
          if (dbUser.email) seedFacts.push(["email", dbUser.email, "identity"]);

          for (const [key, value, category] of seedFacts) {
            await upsertFact(userId, key, value, category, "recovery");
          }
          console.log(`[WA RECOVERY] Seeded ${seedFacts.length} facts for ${userId} from users table`);
          userFacts = await getUserContext(userId);
        }
      } catch (err) {
        console.error("[WA RECOVERY] Error:", (err as Error).message);
      }
    }

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
          signal: AbortSignal.timeout(90000),
        });
        const premiumData = await premiumRes.json() as { success: boolean; response: string; documents?: { pdfPath: string; title: string }[] };
        if (premiumData.success) {
          response = premiumData.response;

          // Send any documents generated by premium pipeline tools
          if (premiumData.documents && premiumData.documents.length > 0) {
            for (const doc of premiumData.documents) {
              try {
                const { readFileSync, existsSync, unlinkSync } = await import("fs");
                if (existsSync(doc.pdfPath)) {
                  const { randomUUID } = await import("crypto");
                  const { docStore } = await import("../routes/whatsapp-webhook.js");
                  const fileId = `${Date.now()}_${randomUUID().slice(0, 8)}`;
                  const filename = `${doc.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50)}.pdf`;
                  docStore.set(fileId, { path: doc.pdfPath, mimeType: "application/pdf", filename, createdAt: Date.now() });

                  const publicUrl = `${process.env.PAYJARVIS_PUBLIC_URL || process.env.WEB_URL || "https://www.payjarvis.com"}/api/docs/temp/${fileId}`;
                  const { sendWhatsAppDocument } = await import("./twilio-whatsapp.service.js");
                  await sendWhatsAppDocument(userId, publicUrl, `📄 ${doc.title}`);
                  console.log(`[WA PREMIUM DOC] Sent document "${doc.title}" to ${userId}`);
                }
              } catch (docErr) {
                console.error(`[WA PREMIUM DOC] Error sending doc "${doc.title}":`, (docErr as Error).message);
              }
            }
          }
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

    // Summarize old conversations periodically (background)
    summarizeOldConversations(userId).catch((err) =>
      console.error("[WA SUMMARY] Background error:", err.message)
    );

    return response;
  } catch (err) {
    console.error("[WA CHAT] Error:", (err as Error).message);
    return "Erro ao processar. Tente novamente.";
  }
}
