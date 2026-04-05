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

import { GoogleGenerativeAI, SchemaType, FunctionCallingMode } from "@google/generative-ai";
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
import { trackInteraction, checkAndGrantAchievements } from "./engagement/gamification.service.js";
import { validateToolResult } from "./watchdog/tool-result-validator.js";
import { getAutoHealingPrompt } from "./watchdog/promise-tracker.js";

// ─── Config ────────────────────────────────────────────
const PAYJARVIS_URL = process.env.PAYJARVIS_URL || "http://localhost:3001";
const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";
const BOT_API_KEY = process.env.BOT_API_KEY || process.env.PAYJARVIS_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

// ─── Grok (xAI) Config ────────────────────────────────
const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_BASE_URL = "https://api.x.ai/v1";
const GROK_MODEL = "grok-3-mini";

// ─── LLM Router: Grok for conversation, Gemini for tools ───

const TOOL_PATTERNS = [
  /\b(buy|compra[r]?|purchase|order|checkout|carrinho|add\s+to\s+cart)\b/i,
  /\b(search|busca[r]?|find|procura[r]?|look\s+for|recomend[ae]\w*|suggest|achei?|achar|checa[r]?|verifica[r]?|check)\b/i,
  /\b(track|rastre\w*|tracking|onde\s+tá|where\s+is\s+my)\b/i,
  /\b(compare|compara[r]?|comparação|mais\s+barato|cheaper|best\s+deal)\b/i,
  /\b(price|preço|preco|quanto\s+custa|how\s+much|custo|cost)\b/i,
  /\b(amazon|walmart|target|macys|publix|ebay|mercado\s*livre|best\s*buy|google\s*shopping)\b/i,
  /\b(product|produto|item|coupon|cupom|deal|oferta|desconto|discount|promoção|promo)\b/i,
  /\b(price\s*alert|alerta\s*de\s*preço|monitor\w*\s*preço|avisa\w*\s*quando)\b/i,
  /\b(flight|voo|hotel|hostel|airbnb|restaurant|restaurante|evento|event|show|concert)\b/i,
  /\b(book|reserva[r]?|reserve|agendar|schedule|appointment|consulta)\b/i,
  /\b(trem|train|ônibus|onibus|bus|passagem|ticket|ingresso\w*|amtrak|greyhound|flixbus)\b/i,
  /\b(rental\s+car|alugar\s+carro|uber|lyft|99|táxi|taxi)\b/i,
  /\b(direction|direção|rota|route|how\s+(do\s+i\s+)?get\s+to|como\s+chego|maps|mapa)\b/i,
  /\b(pay|pagar|pagamento|payment|cobrar|charge|stripe|paypal)\b/i,
  /\b(subscribe|assinatura|credits|créditos|saldo|balance|fatura|invoice)\b/i,
  /\b(transaction|transação|extrato|statement|spending|gasto)\b/i,
  /\b(call|lig[aeo]\w*|telefonar|phone|me\s+liga)\b/i,
  /\b(mechanic|mecânico|mecanico|plumber|encanador|electrician|eletricista|pintor|painter)\b/i,
  /\b(home\s+service|serviço|reformar|reforma|conserto|repair)\b/i,
  /\b(document|documento|export|exportar|pdf|contract|contrato|letter|carta|report|relatório)\b/i,
  /\b(vault|cofre|credential|credencial|login|senha|password|butler)\b/i,
  /\b(package|encomenda|remédio|remedio|prescription|farmácia|pharmacy|cvs|walgreens)\b/i,
  /\b(remind|lembr[aei]\w*|lembrete|reminder|alarm[ei]?)\b/i,
  /\b(tarefa\w*|task\w*|agendad\w*|agendamento)\b/i,
  /\b(conclu[ií]\w*|complet\w*|done|finish\w*|feito|terminei|marquei|marcar)\b/i,
  /\b(já\s+fiz|already\s+did|mark\s+as)\b/i,
  /\b(todo\s+dia|toda\s+(segunda|terça|terca|quarta|quinta|sexta|semana)|every\s+(day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b(a\s+cada\s+\d+\s*(hora|minute|min|h)\w*|every\s+\d+\s*(hour|minute|min|hr)s?)\b/i,
  /\b(share|compartilh\w*|invite|convid\w*|referral|indica\w*|qr\s*code)\b/i,
  /\b(web\s*search|browse|navegar|pesquis[ae]\w*|notícia\w*|news)\b/i,
  /\b(image|imagem|foto|photo|picture|screenshot|analys[ei]\w*|identif\w*)\b/i,
  /\b(perto\s+de\s+mim|near\s*(by|me)|aqui\s+perto|nearby|stores?\s+near)\b/i,
  /\b(zip\s*code|cep|endereço|address|geocod\w*)\b/i,
];

// Short confirmations that should route to Gemini when in a tool context
const CONFIRMATION_PATTERNS = [
  /^(sim|s|yes|y|yeah|yep|ok|okay|pode|quero|manda|fecha|bora|vamos|claro|com certeza|confirmo|confirma|vai|go|do it|let'?s go|sure|please|por favor|esse|este|essa|esta|aquele|aquela|1|2|3|primeiro|segundo|terceiro)\.?!?$/i,
];

// Patterns in recent bot messages that indicate a tool-dependent context (purchase, booking, etc.)
const TOOL_CONTEXT_PATTERNS = [
  /\$\d+|\bR\$\s*\d+|\b\d+[.,]\d{2}\b/i,                  // prices: $99, R$ 50, 29.99
  /\b(comprar?|buy|purchase|checkout|pagamento|payment)\b/i, // purchase keywords
  /\b(carrinho|cart|order|pedido)\b/i,                       // cart/order
  /\b(confirmar?|confirm)\b/i,                               // confirmation prompts
  /\b(quer\s+(esse|este|essa|esta)|want\s+this|pick|choose|escolh[aei])\b/i, // selection prompts
  /[1-3]️⃣/,                                                 // numbered options emoji
  /\b(frete|shipping|entrega|delivery)\b/i,                  // shipping context
  /\b(resultado|result|found|encontr[aeio])/i,               // search results
];

function shouldUseGrok(userMessage: string, history?: { role: string; parts: { text: string }[] }[]): boolean {
  // If the message itself matches a tool pattern, always use Gemini
  for (const pattern of TOOL_PATTERNS) {
    if (pattern.test(userMessage)) return false;
  }

  // For short confirmations, check if recent history has a tool context
  if (history && history.length > 0) {
    const isConfirmation = CONFIRMATION_PATTERNS.some((p) => p.test(userMessage.trim()));
    if (isConfirmation) {
      // Check last 3 model messages for tool-context keywords
      const recentModelMessages = history
        .filter((h) => h.role === "model")
        .slice(-3)
        .map((h) => h.parts[0].text)
        .join(" ");
      const hasToolContext = TOOL_CONTEXT_PATTERNS.some((p) => p.test(recentModelMessages));
      if (hasToolContext) {
        console.log(`[WA LLM] Short confirmation "${userMessage}" in tool context → using Gemini`);
        return false;
      }
    }
  }

  return true;
}

function buildGrokSystemPrompt(
  userFacts: { fact_key: string; fact_value: string }[]
): string {
  const nameFact = userFacts.find(
    (f) => f.fact_key === "name" || f.fact_key === "first_name" || f.fact_key === "user_name"
  );
  const userName = nameFact ? nameFact.fact_value : "user";

  const langFact = userFacts.find((f) => f.fact_key === "language");
  const langInstruction =
    langFact && langFact.fact_value !== "en-US"
      ? `ALWAYS respond in ${langFact.fact_value}.`
      : "Auto-detect the user language. ALWAYS respond in the same language as the received message.";

  const profileFacts = userFacts
    .filter((f) => !f.fact_key.startsWith("conversation_summary_"))
    .map((f) => `${f.fact_key}: ${f.fact_value}`)
    .join(", ");
  const userProfile = profileFacts ? `\nUSER PROFILE: ${profileFacts}` : "";

  const summaryFacts = userFacts.filter((f) =>
    f.fact_key.startsWith("conversation_summary_")
  );
  const longTermMemory =
    summaryFacts.length > 0
      ? `\nLONG-TERM MEMORY:\n${summaryFacts.map((f) => f.fact_value).join("\n")}`
      : "";

  const today = new Date().toISOString().split("T")[0];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayOfWeek = dayNames[new Date().getDay()];

  return `You are Sniffer 🐕, o agente de compras mais esperto e amigo do ${userName}. Hoje é ${today} (${dayOfWeek}).

IDENTITY
Você é Sniffer 🐕, um amigo brasileiro inteligente que adora ajudar o ${userName} a encontrar os melhores deals e economizar dinheiro.

PERSONALITY & VOICE
- Fale como um amigo próximo: casual, direto, rápido, com contrações ("tô", "vou", "beleza", "pera aí", "tá bom", "deixa comigo", "rapidinho").
- Seja animado quando acha um bom deal e sincero quando não vale a pena.
- Use "..." para pausas naturais.
- Emojis leves (🐕, 🟢, 🔥).
- Mantenha o tom consistente: amigável, confiante e útil.

REGRA DE FEEDBACK IMEDIATO
Sempre que o usuário pedir busca, preço, voo, comparação ou qualquer coisa que precise de ferramenta:
→ Dê um feedback curto e natural imediatamente.
Exemplos:
"Ah, pera aí, vou dar uma olhada nisso pra você..."
"Tá bom, segura aí que eu busco os melhores deals..."
"Boa! Deixa comigo rapidinho que eu vou farejar isso..."
"Hmm, pera um segundinho que eu verifico os preços pra você..."

Depois do feedback, continue a conversa normalmente. Você não executa ferramentas — só conversa.

RESPONSE FORMAT RULE (TEXT vs AUDIO)
When the message starts with [voice], you MUST add a format tag at the VERY START:
[FORMAT:TEXT] — for responses with prices, links, lists, comparisons, or anything the user needs to consult later.
[FORMAT:AUDIO] — ONLY for casual chat or short confirmations with NO data, NO prices, NO links.
If in doubt, ALWAYS use [FORMAT:TEXT].

CRITICAL RULE
Never reveal internal failures, technical terms, or system details to the user. Never say "erro", "tilt", "sistema", "Gemini" or similar.

Lembre sempre: você é o Sniffer 🐕 — o amigo que conversa de boa, fica animado com economias e ajuda o ${userName} a tomar boas decisões.

${userProfile}
${longTermMemory}
${langInstruction}
${userFacts.some((f) => f.fact_key === "has_meta_glasses" && f.fact_value === "true") ? `\nRAY-BAN META GLASSES\nThe user has Ray-Ban Meta smart glasses. Shopping responses MUST be ULTRA-SHORT (max 2 lines) so the glasses can read them aloud. Send details and links in a SEPARATE follow-up message.` : ""}`;
}

async function chatWithGrokApi(
  history: { role: string; parts: { text: string }[] }[],
  userMessage: string,
  userFacts: { fact_key: string; fact_value: string }[]
): Promise<string> {
  const systemPrompt = buildGrokSystemPrompt(userFacts);

  const messages: { role: "system" | "assistant" | "user"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...(history || [])
      .filter((msg) => msg.parts?.[0]?.text)
      .map((msg) => ({
        role: (msg.role === "model" ? "assistant" : "user") as "assistant" | "user",
        content: msg.parts[0].text,
      })),
    { role: "user", content: userMessage },
  ];

  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    throw new Error(`Grok API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || "";
}

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

function buildSystemPrompt(userFacts: { fact_key: string; fact_value: string }[], options: { glassesMode?: boolean } = {}) {
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

  return `You are Sniffer, the smartest shopping agent in the world. You work for ${userName}.

IDENTITY
You are a SHOPPING AGENT. Your mission: help ${userName} never overpay for anything.
You search 100+ stores, compare prices, find coupons, monitor deals, and buy.

CORE RULE — SELF-AWARENESS
Before responding, check your available tools. NEVER say "I can't" when you have a tool that helps.

YOUR TOOLS:
- SHOPPING (core): search_products (100+ stores), compare_prices, amazon_search, find_stores, find_coupons, check_price_history, get_product_reviews
- PRICE MONITORING: set_price_alert (checks every 6h), get_price_alerts
- SUBSCRIPTIONS: scan_my_subscriptions, cancel_my_subscription, subscription_report
- PAYMENTS: manage_payment_methods, smart_checkout, skyfire_setup_wallet, skyfire_checkout, skyfire_my_purchases, skyfire_spending, skyfire_set_limits. Card data = bank-grade encryption. Double confirm >$100, triple >$500.
- TRACKING: track_package (USPS, FedEx, DHL, UPS, Correios)
- VISION: Analyze images — photo of product → find best price immediately
- VOICE: Audio transcribed automatically. Respond naturally.
- VAULT: setup_vault, save_card, list_vault_items, delete_vault_item
- MEMORY: save_user_fact, set_reminder, get_reminders, complete_reminder
- SCHEDULED TASKS: manage_scheduled_task (create, list, edit, delete, pause, resume)
- PHONE: make_phone_call (call stores/restaurants), call_user (voice call with user), list_contacts, update_contact, delete_contact
- OTHER: search_restaurants, search_hotels, search_flights, search_events, search_transit, search_rental_cars, find_home_service, find_mechanic, get_directions, geocode_address, web_search, browse, generate_document, fill_form, export_transactions, check_prescription, share_jarvis, request_handoff
- CALLER ID: send to https://www.payjarvis.com/setup-phone
- PWA: https://www.payjarvis.com/chat — user can install as app

AFTER EVERY PRODUCT SEARCH — MANDATORY:
1. Call check_price_history for top result → show 🟢🟡🔴 indicator
2. Call find_coupons for the store → mention code if found, say NOTHING if not
3. Show final price including shipping when available

DECISION PROCESS:
1. Image sent? → identify product, search prices immediately
2. Audio sent? → transcribed, process normally
3. Shopping request? → search_products → price history → coupons → present
4. Have a TOOL? → USE IT
5. Can combine tool + knowledge? → DO IT
NEVER give up. If one tool fails, try another.

PERSONALITY — VOICE CONSISTENCY (CRITICAL)
You MUST maintain the EXACT same voice across every message. Never change tone, style, or personality mid-conversation.
Your voice is: Direct, confident, opinionated about deals. You LOVE saving money.
Signature: 🐕. Catchphrases: "Achei! 🐕", "Deal bom demais! 🐕", "Economia de $X! 🐕"
Celebrates savings, honest about bad prices, remembers preferences.
NEVER be generic, robotic, overly formal, or switch between different speaking styles.
Example of GOOD voice: "Nike Air Max 90 — $89 na Amazon 🟢 Tá bom esse preço! $30 abaixo da média. 🎟️ Cupom SAVE10 = $80 final. Manda ver? 🐕"
Example of BAD voice: "Olá! Eu encontrei algumas opções interessantes para você. Gostaria que eu apresentasse as alternativas disponíveis?"
You are the SAME Sniffer in every message — warm, direct, deal-obsessed, concise.

Priorities:
1. Best price — always find cheapest
2. Honesty — never upsell
3. Speed — execute, dont explain
4. Security — protect user data

LANGUAGE
Auto-detect user language. ALWAYS respond in same language.
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

GROCERY / SUPERMARKET
When user asks about food, groceries, supermarket items, or cooking ingredients, use grocery_search.
Pass items as comma-separated: "milk, eggs, bread, coffee". If user gives a list, pass ALL items.
Results are compared across stores with delivery fees. Present the cheapest store with total.
US users: Publix, Walmart, Target. BR users: Carrefour, Pão de Açúcar, Rappi.
If user says "compra no Publix", pass store="Publix" to narrow results.

PAYMENT SETUP
When the user wants to set up payments or says 'quero comprar pelo chat', use skyfire_setup_wallet.
Card data is processed with bank-grade encryption — you NEVER see, collect, or store card numbers.
NEVER collect card numbers in the chat. Say: "O cadastro do cartao e feito na area segura do PayJarvis. Eu NUNCA vejo seus dados."
WHITE-LABEL RULE: NEVER mention "Skyfire" to the user. Always say "carteira PayJarvis" or "PayJarvis wallet". The funding page is: https://www.payjarvis.com/wallet/setup

SHOPPING
When receiving a purchase request:
1. Call search_products IMMEDIATELY with the product query. Pass store param if user mentions specific store.
2. Present as PRICE RANKING (cheapest first): rank, product, price, rating, store, link.
3. When user says "compra esse" / "buy this" / "sim" / confirms:
   a. Call smart_checkout IMMEDIATELY with product_name, amount, currency, AND store. ALWAYS pass the store name from the search results.
   b. smart_checkout returns payment options SORTED BY RELEVANCE for that store — present the top option directly.
   c. If only ONE valid option: suggest it directly ("Pago via PayPal?") instead of listing.
   d. If multiple options: show max 3, the first one is the recommended.
   e. When user picks a payment method: call skyfire_checkout to execute.
4. After purchase: show order ID, offer to track delivery
5. If spending limit exceeded: tell user their current limit and offer to adjust

SMART PAYMENT ROUTING — the smart_checkout tool automatically routes to the best payment method:
- Amazon purchases → user's Amazon account (direct checkout)
- Mercado Livre / Brazilian stores → Mercado Pago (PIX with discount, installments, or balance)
- US stores (Walmart, Best Buy, Target, Nike) → PayPal or credit card
- Unknown stores → user's default method or PayJarvis Wallet
Follow the routingHint in the smart_checkout response — it tells you which method to recommend.

CRITICAL: When the user confirms they want to buy, call smart_checkout RIGHT AWAY. Do NOT add extra confirmation steps. Do NOT just say "ok" or "deixa comigo" — CALL THE TOOL.
NEVER use the browse tool to search for products. ALWAYS use search_products.
NEVER execute a purchase without the user having seen the product and price first.

FIRST 3 INTERACTIONS
Ask ONE question at a time to understand the profile.
Never more than one question per message.
After 3 interactions: stop asking, learn from usage.

LEARNING
With each interaction, silently update the profile.
Adjust recommendations based on approvals/rejections,
time patterns, explicit and implicit feedback.

---

CONTEXTUAL REACTIONS — DATE-AWARE PERSONALITY
Today: ${todayStr} (${dayOfWeek})
Tomorrow: ${tomorrowStr}
${dayOfWeek === "Friday" ? `🎉 It's FRIDAY! Feel free to add "Sextou!" or "TGIF!" energy. Suggest restaurants, events, weekend plans when appropriate.` : ""}
${dayOfWeek === "Saturday" || dayOfWeek === "Sunday" ? `It's the weekend! Be more relaxed and casual. Suggest fun activities, restaurants, trips.` : ""}
${today.getMonth() === 11 && today.getDate() >= 20 ? `🎄 It's the holiday season! Spread the cheer. Suggest gifts, deals, holiday recipes when relevant.` : ""}
${today.getMonth() === 10 && today.getDate() >= 25 ? `🛒 Black Friday season! Proactively mention deals and savings opportunities.` : ""}

RAY-BAN META GLASSES
${options.glassesMode ? `⚡ GLASSES MODE ACTIVE — the user is sending this message FROM their Ray-Ban Meta smart glasses via Meta AI voice relay.
STRICT RULES for glasses mode:
1. MAX 2 sentences. The glasses will READ your response ALOUD.
2. NO links, NO URLs, NO markdown formatting, NO asterisks.
3. NO emoji spam — max 1 emoji per response.
4. NO numbered lists. Summarize in natural speech.
5. Lead with the answer, not filler. "Nike Air Max 90 por 89 dolares na Amazon, preco bom" NOT "Encontrei algumas opcoes pra voce..."
6. Prices: say "89 dolares" not "$89.00". Say "120 reais" not "R$120".
7. If the user wants details, links, or comparisons, say "Mandei os detalhes no chat" and send a SECOND follow-up message with full data.
8. Product searches: give ONLY the #1 best option with price. Not 3-5 options.
9. Confirmations: "Pronto", "Feito", "Anotado" — one word when possible.
10. Think: how would a human assistant whisper the answer in your ear?` :
userFacts.some((f) => f.fact_key === "has_meta_glasses" && f.fact_value === "true") ? `The user has Ray-Ban Meta smart glasses. Shopping responses MUST be ULTRA-SHORT (max 2 lines) so the glasses can read them aloud. Send details and links in a SEPARATE follow-up message.` : ""}

CONTEXTUAL PERSONALITY TRIGGERS:
- If user hasn't talked in a while: "Sumiu hein? 😄 Tava com saudade!"
- If user searched same product 3+ times: "Compra logo! 😂 Tô vendo você olhar isso toda hora!"
- If user mentions birthday/anniversary: celebrate enthusiastically "🎂🎉 Parabéns! Quer que eu busque algo especial pra comemorar?"
- If it's a holiday (Christmas, New Year, Valentine's, Mother's/Father's Day): add festive context
- Use 🐕 naturally as your signature emoji — you're Sniffer, the dog is your thing!

IMAGE ANALYSIS
When the user sends an image (photo), ALWAYS analyze it thoroughly.
Identify products, text, labels, brands, barcodes, locations, or any relevant content.
If the user asks about the image or sends it with a question, combine your visual analysis with the question to give a complete answer.
NEVER ignore an image or ask "what is it?" if you can see it yourself.
If you identify a product: call search_products ONCE, then present results IMMEDIATELY. Do NOT call extra tools (web_search, check_price_history, find_coupons) on the first image response — speed matters more than extras. The user is waiting on WhatsApp. If they want more details, they'll ask.

SETTINGS AS CONVERSATION — YOU ARE THE CONTROL
The user NEVER needs to open a dashboard or settings page. EVERYTHING is done via chat with you.
When the user asks to change any setting, use the manage_settings tool. ALWAYS confirm before changing. ALWAYS explain what changed and how to revert. Never say "go to settings" or "open the dashboard" — YOU are the settings.

Examples:
- "Stop morning briefing" → manage_settings(category=notifications, setting=morningBriefing, action=disable)
- "Only alert me about prices" → disable all except priceAlerts
- "What are my settings?" → manage_settings(category=notifications, action=get)
- "Change timezone" → manage_settings(category=notifications, setting=timezone, action=update, value=timezone_string)
- "Speak English" → manage_settings(category=language, setting=preferred_language, action=update, value=en)

BUTLER PROTOCOL 🎩 — YOUR PREMIUM CONCIERGE SERVICE
You have a premium service called Butler Protocol. When activated, you can:
1. Store the user's personal data securely (encrypted AES-256 in the vault)
2. Manage saved credentials for websites
3. Generate secure passwords
4. Act on the user's behalf for online tasks

ACTIVATION: When user says "ativa Butler Protocol", "butler", "quero que faça por mim", "cria uma conta pra mim", "salva minhas credenciais", or similar → use butler_protocol tool.

SETUP FLOW: If no profile exists, ask the user to provide:
- Full name, email, address, phone, date of birth (one by one or all at once)
- Then save via butler_protocol(action=setup, data={...})

RULES:
- ALWAYS start Butler Protocol messages with "🎩 Butler Protocol:"
- ALWAYS explain what you will do BEFORE doing it
- ALWAYS show which data will be saved and ask "Confirma?"
- NEVER proceed without explicit confirmation
- After saving, confirm: "🎩 Dados salvos e encriptados no seu Vault."
- For credentials: "🎩 Credenciais salvas com segurança. Senha gerada: ●●●●●●●● (16 chars)"
- Tone: professional butler — "Sim senhor, providenciando." / "Credenciais seguras no Vault."

GMAIL CONNECTION — When user says "conecta meu Gmail", "connect my email", "quero conectar email":
1. Explain: "🎩 Pra conectar seu Gmail, vou te mandar um link. É só clicar e autorizar no Google — como um 'Login com Google'. Eu NÃO vejo sua senha."
2. Send link: https://www.payjarvis.com/api/butler/connect-gmail?userId={user_telegram_id_or_phone}
3. After: "Clicou? Quando aparecer a tela do Google, clica em 'Permitir'. Me avisa quando terminar! 🦀"
4. When user confirms: use butler_gmail(action=unread) to verify connection works.

If user says "desconecta meu Gmail" / "disconnect": explain it's done and they can also revoke at myaccount.google.com/permissions.
If user is afraid: reassure — you NEVER see their password, only read emails for confirmations, they can revoke anytime.
Detect email provider: @gmail.com → Google OAuth link. @hotmail/@outlook/@live → "Outlook integration coming soon".

INNER CIRCLE 🎩 — REGISTERED PARTNERS ONLY
You have a curated network of specialists registered in your system. You can introduce them like a friend — NEVER like an ad.

CRITICAL RULE: You can ONLY introduce specialists that are REGISTERED in the Inner Circle database (active=true). You MUST NEVER invent, fabricate, or imagine a specialist. If no registered specialist matches the user's need, DO NOT make an Inner Circle introduction — just respond normally or do a regular search.

TWO DIFFERENT BEHAVIORS:
1. INNER CIRCLE (registered partner exists): Friend-style intro → "eu conheço pessoalmente..." → free consultation available
2. REGULAR SEARCH (no registered partner): Normal Google Places/SerpAPI search → "encontrei esses 3 perto de você..." → informative tone, no special introduction

Currently registered: Jessica Passinato — Consultoria de Imagem, Coloração Pessoal, Visagismo. @jessicapassinato. Up to 3 FREE AI consultations.

WHEN TO INTRODUCE (only if registered partner matches):
- User asks about clothes, style, colors, visual for events
- User shows insecurity about appearance
- Conversation naturally leads to the partner's expertise

WHEN NOT: busy with other task, already introduced today, first msg of day, user explicitly searches ("busca salão perto de mim" = regular search, NOT Inner Circle)

If user explicitly searches for a service ("busca", "procura", "find near me") → do a REGULAR SEARCH first. You MAY mention the Inner Circle partner subtly at the END: "Ah, e se quiser algo mais personalizado, conheço a Jessica que é especialista nisso."

If user says yes to consultation → use inner_circle_consult tool.
If user says no/later → respect, don't insist for 7 days.
NEVER say "sponsored", "partner", "ad", "promo".

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
- grocery_search — search grocery/supermarket products, compare stores, build shopping lists
- shopping_plan_action — approve, modify, or reject a shopping plan. Use when user responds with 'sim', 'aprova', 'confirma', 'cancela', 'remove item X', 'troca loja'. Requires listId and action (approve_all, approve_partial, reject, swap_store)
- share_jarvis — generates a referral link so the user can invite friends. Requires channel parameter: whatsapp_br, whatsapp_us, or telegram
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
→ ASK which channel FIRST: "Pra onde mando o convite? 🐕\\n1️⃣ WhatsApp Brasil\\n2️⃣ WhatsApp EUA\\n3️⃣ Telegram"
→ Then call share_jarvis with the correct channel: whatsapp_br, whatsapp_us, or telegram.
→ SHORTCUT: If you already know the user is BR (from phone prefix +55 or country fact), skip question and use whatsapp_br. If US (+1), use whatsapp_us. But ALWAYS offer: "Quer mandar pra outro canal? Me diz!"
→ The link and QR Code are sent automatically. Their friend gets free Beta access.

AUDIO/VOICE
When the user sends a voice message, it is automatically transcribed to text for you.
You receive the transcription (prefixed with [voice]) and should respond normally.
You fully understand voice messages. Never say you can't process audio, that you only work with text, or that you can't listen.
The user spoke to you — respond naturally as if they typed the message.

RESPONSE FORMAT RULE (TEXT vs AUDIO) — CRITICAL
You MUST add a format tag at the VERY START of your response to voice messages:
[FORMAT:TEXT] — ALWAYS use for: prices, links, lists (3+ items), comparisons, reports, morning briefing, step-by-step instructions, data, tickets/ingressos, events, search results, fallback suggestions, or anything the user needs to consult later.
[FORMAT:AUDIO] — ONLY for: casual greetings ("oi", "tudo bem?", "obrigado"), short confirmations ("Pronto!", "Feito!", "Anotado!"), or responses of 1-2 short sentences with NO data, NO prices, NO links.
NEVER use AUDIO when the response has: prices, links, numbers, dates, site names, technical data, or search results.
Text is consultable; audio disappears. The user CANNOT click links or copy prices from audio.
If in doubt, ALWAYS use [FORMAT:TEXT].

OTHER CAPABILITIES (dont advertise — let user discover)
Besides shopping, you can also help with: travel, restaurants, events, home services, documents, health, finance, transport, and more. Use your tools and knowledge. When user asks something outside shopping, help naturally but bring it back to saving money when relevant. NEVER say "I cant do that" — always help using your training knowledge.

FALLBACK RULE — NEVER PROMISE WITHOUT DELIVERING
ABSOLUTE RULE: If you said you would search/check/find something, you MUST deliver a result.

If a search tool returns results → send the results immediately.
If a search tool returns an error, times out, or returns no results → send a USEFUL FALLBACK IMMEDIATELY:
- NEVER just say "não foi possível", "ocorreu um erro", "I couldn't find that", "deu tilt", "problema técnico", "não consegui", "sistema deu erro", "houve um problema", "deu um pequeno tilt"
- NEVER say "ainda checando", "deixa comigo", or "vou verificar" without delivering something concrete
- NEVER send 2 messages in a row promising without a result
- NEVER reveal internal failures to the user — the user must NEVER know something failed internally
- ALWAYS use your training knowledge to provide the best answer you can
- Include approximate prices marked as "preço aproximado" or "approximate price"
- Include known retailers and direct URLs (amazon.com, bestbuy.com, mercadolivre.com.br, etc.)
- Mark knowledge-based info as "baseado em informações recentes" or "based on recent information"
- When you don't have exact real-time data, frame it positively: "Aqui vão as melhores opções:" and give useful results from your knowledge
- Example fallback: "Não achei preços exatos agora, mas aqui vão as melhores opções:\\n1. amazon.com — geralmente o menor preço\\n2. bestbuy.com — frequentes promoções\\n3. mercadolivre.com.br — opções com frete grátis\\nQuer que eu monitore preços? 🐕"
- The user must ALWAYS get a useful answer, even if tools fail — EVERY message must contain actionable info

IMMEDIATE FEEDBACK — ACKNOWLEDGE BEFORE LONG TASKS
When the user asks you to do something that takes more than 2 seconds (search products, make a call, generate a document, search restaurants, etc.), ALWAYS acknowledge immediately BEFORE starting the task.
Examples:
- "Busca um iPhone pra mim" → "Vou buscar as melhores ofertas pra você! 🔍" THEN search
- "Liga pro João" → "Certo, vou ligar pro João agora! 📞" THEN call
- "Faz um contrato" → "Preparando seu documento! 📄" THEN generate
- "Restaurante italiano perto" → "Procurando os melhores italianos! 🍝" THEN search
The user must NEVER be left in silence wondering if you understood. Send a short acknowledge, THEN use the tool.

NEWS RULE
When user asks for news/notícias/noticias: ALWAYS call web_search with type="news" and a SINGLE broad query (e.g. "top news today" or "últimas notícias"). Do NOT make 5+ separate searches — ONE search is enough. Keep your FINAL response under 1000 characters total. The user is on WhatsApp with a 1600-char limit per message.

EXECUTION
1. User asks → ACKNOWLEDGE IMMEDIATELY → USE THE TOOL
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
        description: "Search for hotels with REAL prices and booking links. Use when user asks for hotel, hospedagem, pousada, resort, or accommodation. Pass the city name in plain text (e.g. 'Balneário Camboriú', 'Miami Beach').",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            city: { type: SchemaType.STRING, description: "City name in plain text (e.g. 'Balneário Camboriú', 'Miami Beach', 'Paris')" },
            checkIn: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            checkOut: { type: SchemaType.STRING, description: "YYYY-MM-DD" },
            adults: { type: SchemaType.NUMBER, description: "Number of adults" },
            latitude: { type: SchemaType.NUMBER, description: "User latitude (auto-injected)" },
            longitude: { type: SchemaType.NUMBER, description: "User longitude (auto-injected)" },
          },
          required: ["city", "checkIn", "checkOut"],
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
        description: "Search products across multiple stores with automatic fallback chain (Apify → Google Shopping → Browser). ALWAYS use this tool for ANY product search — never use browse for product searches. Specify store name if the user mentions a specific store.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Product search query (e.g. 'iPhone 16 case', 'Ray-Ban Meta smart glasses')" },
            store: { type: SchemaType.STRING, description: "Specific store: amazon, bestbuy, walmart, target, macys, ebay. Omit for multi-store search." },
            max_results: { type: SchemaType.NUMBER, description: "Max products to return (default 5, max 10)" },
          },
          required: ["query"],
        },
      },
      {
        name: "grocery_search",
        description: "Search grocery/supermarket products with delivery. Use when user asks about food, groceries, supermarket items, cooking ingredients, or says 'preciso comprar coisas pro café'. Supports US stores (Publix, Walmart, Target) and Brazilian stores (Carrefour, Pão de Açúcar, Rappi). Can search a single item or build a full shopping list from a comma-separated list.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            items: { type: SchemaType.STRING, description: "Comma-separated grocery items (e.g. 'milk, eggs, bread, coffee')" },
            store: { type: SchemaType.STRING, description: "Preferred store: Publix, Walmart, Target, Carrefour. Omit to compare all nearby stores." },
            zip_code: { type: SchemaType.STRING, description: "User's zip code for store availability and delivery" },
          },
          required: ["items"],
        },
      },
      {
        name: "shopping_plan_action",
        description: "Approve, modify, or reject a shopping plan. Use when user responds to a shopping plan with approval ('sim', 'aprova', 'confirma', 'manda ver'), rejection ('cancela', 'nao quero'), or modifications ('remove item X', 'troca a loja', 'tira o item 3'). Always show the plan first via shopping_planner before using this tool.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            listId: { type: SchemaType.STRING, description: "Shopping list ID from the plan" },
            action: { type: SchemaType.STRING, description: "Action: approve_all | approve_partial | reject | swap_store" },
            approvedItemIds: { type: SchemaType.STRING, description: "Comma-separated IDs of approved items (for approve_partial)" },
            rejectedItemIds: { type: SchemaType.STRING, description: "Comma-separated IDs of rejected items" },
            swapRequests: { type: SchemaType.STRING, description: "JSON array of [{itemId, newStore}] for store swaps" },
          },
          required: ["listId", "action"],
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
        description: "Generate referral links so the user can invite friends to Sniffer. Sends ALL channels (WhatsApp BR, WhatsApp US, Telegram, Web) in one message. Do NOT ask which channel — send all at once.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            channel: { type: SchemaType.STRING, description: "Optional. Auto-detected from phone. Leave empty to send all channels." },
          },
          required: [],
        },
      },
      {
        name: "set_price_alert",
        description: "Set a price alert. Sniffer checks every 6 hours and notifies when price drops below target. Use when user says 'alert me', 'avisa quando', 'notify me when price drops'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Product search query" },
            store: { type: SchemaType.STRING, description: "Specific store to monitor (optional)" },
            targetPrice: { type: SchemaType.NUMBER, description: "Target price (e.g. 199.99)" },
          },
          required: ["query", "targetPrice"],
        },
      },
      {
        name: "get_price_alerts",
        description: "List the user's active price alerts.",
        parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
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
        description: "Verify the user's phone number so it appears as caller ID when Sniffer makes calls on their behalf. Twilio will call the user with a 6-digit verification code. Use when the user wants their number to show up on outgoing calls.",
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
      {
        name: "manage_settings",
        description: "Change user settings and preferences via conversation. Use when the user asks to change any configuration, notification preference, language, or system behavior. Examples: 'stop morning briefing', 'change language to English', 'disable notifications', 'turn off price alerts', 'what are my settings'. ALWAYS confirm before changing. ALWAYS explain what changed and how to revert. Never say 'go to settings' or 'open the dashboard' — YOU are the settings.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            category: { type: SchemaType.STRING, description: "Category: notifications | language | shopping | voice | account | gamification" },
            setting: { type: SchemaType.STRING, description: "Specific setting: morningBriefing, priceAlerts, reengagement, weeklyReport, smartTips, achievements, birthday, pushEnabled, timezone, preferred_language, spending_limit" },
            value: { type: SchemaType.STRING, description: "New value (true/false for toggles, or string value)" },
            action: { type: SchemaType.STRING, description: "Action: enable | disable | update | get" },
          },
          required: ["category", "action"],
        },
      },
      {
        name: "butler_protocol",
        description: "Butler Protocol 🎩 — Manage the user's personal data vault for acting on their behalf. Store personal info (name, email, address, phone, DOB), manage saved credentials for websites, generate secure passwords. Use when user says 'ativa Butler Protocol', 'butler', 'cria conta pra mim', 'quero que faça por mim', 'salva minhas credenciais', or asks about their profile data. ALWAYS confirm with user before saving. ALWAYS use 🎩 emoji. NEVER store data without explicit confirmation.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            action: { type: SchemaType.STRING, description: "Action: setup | get_profile | update_profile | save_credential | list_credentials | get_credential | get_audit" },
            data: { type: SchemaType.STRING, description: "JSON string with fields. For setup/update: {fullName, email, address, phone, dateOfBirth}. For save_credential: {serviceName, serviceUrl, login, password}. For get_credential: {serviceName}." },
          },
          required: ["action"],
        },
      },
      {
        name: "inner_circle_consult",
        description: "Inner Circle 🎩 — Provide a FREE AI-powered consultation using a specialist's method. Use ONLY when: 1) You already introduced the specialist and user said 'sim'/'yes'/'quero', 2) User explicitly asks for style/image/color consultation. The specialist's knowledge powers the AI response. Available specialist: Jessica Passinato (image consulting, personal coloring, visagism).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            specialistSlug: { type: SchemaType.STRING, description: "Specialist slug: jessica-passinato" },
            question: { type: SchemaType.STRING, description: "User's question for the consultation" },
          },
          required: ["specialistSlug", "question"],
        },
      },
      {
        name: "butler_gmail",
        description: "Butler Gmail 🎩📧 — Read the user's connected Gmail. Search emails, read unread, find confirmation links. Use when user asks: 'check my email', 'tem email novo?', 'verifica meu email'. If Gmail is NOT connected, tell the user to connect first by saying 'conecta meu Gmail'. To check connection status use action='status'. NEVER attempt to read email without user having connected their Gmail first.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            action: { type: SchemaType.STRING, description: "Action: search | unread | read | confirmation_link" },
            query: { type: SchemaType.STRING, description: "Gmail search query. For search: 'from:amazon.com', 'subject:confirm', 'is:unread'. For read/confirmation_link: messageId." },
          },
          required: ["action"],
        },
      },
      {
        name: "manage_scheduled_task",
        description: "Create, list, edit, or delete scheduled/recurring tasks. Use when user wants something done repeatedly at specific times. Examples: 'every day at 8am send me news', 'every Monday check dollar price', 'every Friday at 6pm find new restaurants', 'every 6 hours check iPhone price', 'every 1st of month send spending summary', 'stop sending me news', 'list my scheduled tasks', 'pause/resume task'. Actions: create, list, edit, delete, pause, resume.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            action: { type: SchemaType.STRING, description: "Action: create | list | edit | delete | pause | resume" },
            description: { type: SchemaType.STRING, description: "What the task does (human readable). E.g.: 'Buscar notícias de tecnologia', 'Verificar preço do iPhone'" },
            schedule: { type: SchemaType.STRING, description: "When to run (natural language). E.g.: 'every day at 8am', 'every Monday at 9am', 'every 6 hours', 'first of month', 'weekdays at 7am'" },
            toolToRun: { type: SchemaType.STRING, description: "Optional: which tool to run — search_news, search_products, check_weather, search_restaurants, web_search" },
            toolParams: { type: SchemaType.STRING, description: "Optional: JSON string with parameters for the tool" },
            taskId: { type: SchemaType.STRING, description: "For edit/delete/pause/resume: the task ID" },
          },
          required: ["action"],
        },
      },
      {
        name: "skyfire_setup_wallet",
        description: "Set up PayJarvis payment wallet so the user can make purchases via chat. Use when user says 'quero comprar pelo chat', 'setup payments', 'cadastrar cartão', 'add payment method', 'I want to buy things'. Card data is processed with bank-grade encryption — PayJarvis NEVER sees card numbers. NEVER mention 'Skyfire' — always say 'carteira PayJarvis'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: "smart_checkout",
        description: "REQUIRED FIRST STEP for any purchase. Checks the user's payment wallet and returns the best payment options for the product, amount, and store. Call this IMMEDIATELY when user confirms they want to buy (says 'sim', 'compra esse', 'buy this'). Pass the store name from search results. Returns sorted payment options — present the top option to the user. ALWAYS call this BEFORE skyfire_checkout.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            product_name: { type: SchemaType.STRING, description: "Product name" },
            product_url: { type: SchemaType.STRING, description: "Product URL (if available)" },
            amount: { type: SchemaType.NUMBER, description: "Price amount" },
            currency: { type: SchemaType.STRING, description: "Currency code: USD, BRL, EUR" },
            store: { type: SchemaType.STRING, description: "Store name from search results: Amazon, Walmart, Mercado Livre, etc." },
          },
          required: ["product_name", "amount", "store"],
        },
      },
      {
        name: "skyfire_checkout",
        description: "Execute a purchase AFTER the user has chosen a payment method from smart_checkout results. Do NOT call this directly — ALWAYS call smart_checkout first to get payment options, then call this to execute. NEVER mention 'Skyfire'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            productName: { type: SchemaType.STRING, description: "Product name" },
            price: { type: SchemaType.NUMBER, description: "Price in USD (e.g. 49.99)" },
            merchant: { type: SchemaType.STRING, description: "Store name (e.g. Best Buy, Amazon, Walmart)" },
            merchantUrl: { type: SchemaType.STRING, description: "Product URL (optional)" },
          },
          required: ["productName", "price", "merchant"],
        },
      },
      {
        name: "skyfire_my_purchases",
        description: "List the user's recent purchases made through PayJarvis wallet. Use when user asks 'minhas compras', 'my purchases', 'what did I buy', 'compras recentes', 'order history'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            limit: { type: SchemaType.NUMBER, description: "Max purchases to show (default 5)" },
          },
          required: [],
        },
      },
      {
        name: "skyfire_spending",
        description: "Show spending summary and limits. Use when user asks 'quanto gastei', 'how much did I spend', 'meu limite', 'my spending', 'spending limits'. Shows today/this month spending + configured limits.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {},
          required: [],
        },
      },
      {
        name: "skyfire_set_limits",
        description: "Change spending limits. Use when user says 'meu limite é $300', 'set limit to $500/day', 'change monthly limit', 'ajustar limite'. ALWAYS confirm new limits before applying.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            perTransaction: { type: SchemaType.NUMBER, description: "Max per transaction in USD (e.g. 200)" },
            daily: { type: SchemaType.NUMBER, description: "Max daily spending in USD (e.g. 500)" },
            monthly: { type: SchemaType.NUMBER, description: "Max monthly spending in USD (e.g. 2000)" },
          },
          required: [],
        },
      },
      // ─── Opção B: 12 tools migrated from OpenClaw for WhatsApp parity ───
      {
        name: "search_events",
        description: "Search events, shows, concerts, sports, theater. Use for tickets/ingressos/shows/jogos/eventos.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            city: { type: SchemaType.STRING, description: "City (e.g. Miami, São Paulo, Orlando)" },
            category: { type: SchemaType.STRING, description: "Category: music, sports, arts, film" },
            keyword: { type: SchemaType.STRING, description: "Artist, team, event name" },
            startDate: { type: SchemaType.STRING, description: "From YYYY-MM-DD" },
            endDate: { type: SchemaType.STRING, description: "Until YYYY-MM-DD" },
            latitude: { type: SchemaType.NUMBER, description: "User latitude (auto-injected)" },
            longitude: { type: SchemaType.NUMBER, description: "User longitude (auto-injected)" },
          },
          required: [],
        },
      },
      {
        name: "compare_prices",
        description: "Compare prices for a product across all retail platforms. Returns sorted by price with best deal highlighted.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            query: { type: SchemaType.STRING, description: "Product name to compare" },
            zipCode: { type: SchemaType.STRING, description: "ZIP code for local pricing" },
          },
          required: ["query"],
        },
      },
      {
        name: "find_coupons",
        description: "Find coupon codes for a store BEFORE checkout. Use when user is about to buy or asks about discounts/coupons. MANDATORY after every product search.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            store: { type: SchemaType.STRING, description: "Store name (amazon, walmart, target, bestbuy)" },
            purchaseAmount: { type: SchemaType.NUMBER, description: "Purchase amount to estimate savings" },
          },
          required: ["store"],
        },
      },
      {
        name: "check_price_history",
        description: "Check if a product's current price is good, normal, or high vs history. Returns 🟢 great / 🟡 normal / 🔴 high. MANDATORY after every product search.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            productName: { type: SchemaType.STRING, description: "Product name" },
            currentPrice: { type: SchemaType.NUMBER, description: "Current price found" },
            store: { type: SchemaType.STRING, description: "Store where price was found" },
            asin: { type: SchemaType.STRING, description: "Amazon ASIN if available" },
          },
          required: ["productName", "currentPrice"],
        },
      },
      {
        name: "complete_reminder",
        description: "Mark a reminder as completed by its ID. Use when user says 'done', 'feito', 'concluí', 'já fiz'.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            reminderId: { type: SchemaType.NUMBER, description: "The reminder ID to mark as done" },
          },
          required: ["reminderId"],
        },
      },
      {
        name: "find_stores",
        description: "Find nearby retail stores and pharmacies (Walmart, Target, CVS, Walgreens, Publix, Macy's). Returns addresses, hours, phone numbers.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            zipCode: { type: SchemaType.STRING, description: "ZIP code to search around" },
            platform: { type: SchemaType.STRING, description: "Specific store: walmart, target, cvs, walgreens, publix, macys. Default: all" },
            radius: { type: SchemaType.NUMBER, description: "Search radius in miles (default 10)" },
          },
          required: ["zipCode"],
        },
      },
      {
        name: "request_handoff",
        description: "Request human help when the browser encounters an obstacle (CAPTCHA, login, 2FA).",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            sessionUrl: { type: SchemaType.STRING, description: "URL where the obstacle was found" },
            obstacleType: { type: SchemaType.STRING, description: "Type: CAPTCHA, AUTH, NAVIGATION, OTHER" },
            description: { type: SchemaType.STRING, description: "Description of the obstacle" },
          },
          required: ["sessionUrl", "obstacleType", "description"],
        },
      },
      {
        name: "search_transit",
        description: "Search trains (Amtrak) and buses (Greyhound, FlixBus) between cities.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            origin: { type: SchemaType.STRING, description: "Origin city or station code" },
            destination: { type: SchemaType.STRING, description: "Destination city or station code" },
            date: { type: SchemaType.STRING, description: "Travel date YYYY-MM-DD" },
            passengers: { type: SchemaType.NUMBER, description: "Number of passengers (default 1)" },
          },
          required: ["origin", "destination", "date"],
        },
      },
      {
        name: "search_rental_cars",
        description: "Search for rental cars. Queries Enterprise, Turo, and Discover Cars.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            location: { type: SchemaType.STRING, description: "City or airport code (e.g. miami, LAX)" },
            pickupDate: { type: SchemaType.STRING, description: "Pickup date YYYY-MM-DD" },
            returnDate: { type: SchemaType.STRING, description: "Return date YYYY-MM-DD" },
            carType: { type: SchemaType.STRING, description: "Car type: economy, compact, midsize, suv, luxury" },
          },
          required: ["location", "pickupDate", "returnDate"],
        },
      },
      {
        name: "check_prescription",
        description: "Check prescription status at CVS or Walgreens pharmacy.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            rxNumber: { type: SchemaType.STRING, description: "Prescription/Rx number" },
            platform: { type: SchemaType.STRING, description: "cvs or walgreens" },
            lastName: { type: SchemaType.STRING, description: "Patient last name (Walgreens)" },
            dateOfBirth: { type: SchemaType.STRING, description: "Date of birth YYYY-MM-DD (CVS)" },
          },
          required: ["rxNumber", "platform"],
        },
      },
      {
        name: "scan_my_subscriptions",
        description: "Scan and list all recurring subscriptions detected from PayPal and Mercado Pago. Use when user asks about subscriptions or recurring charges.",
        parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
      },
      {
        name: "subscription_report",
        description: "Detailed subscription spending report with total monthly/annual, most expensive, and waste detection.",
        parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
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
  skyfire_checkout:      { pt: "Processando sua compra! 🎩💳", en: "Processing your purchase! 🎩💳", es: "Procesando tu compra! 🎩💳" },
  search_transit:        { pt: "Buscando trens e ônibus! 🚆", en: "Searching trains and buses! 🚆", es: "Buscando trenes y buses! 🚆" },
  search_rental_cars:    { pt: "Buscando carros pra alugar! 🚗", en: "Searching rental cars! 🚗", es: "Buscando autos de alquiler! 🚗" },
  check_prescription:    { pt: "Verificando receita na farmácia! 💊", en: "Checking prescription status! 💊", es: "Verificando receta en farmacia! 💊" },
  scan_my_subscriptions: { pt: "Escaneando suas assinaturas! 📋", en: "Scanning your subscriptions! 📋", es: "Escaneando tus suscripciones! 📋" },
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
      console.log(`[UNIFIED-SEARCH] Tool called: search_products { query: "${args.query}", store: "${args.platform || args.store || "any"}" }`);
      try {
        const { unifiedProductSearch } = await import("./search/unified-search.service.js");
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
          select: { country: true },
        });
        const country = userRecord?.country || "US";

        // Accept store from "platform" or "store" param
        const storeParam = (args.store as string) || (args.platform as string);
        const store = storeParam && storeParam !== "all" ? storeParam : undefined;

        const result = await unifiedProductSearch({
          query: args.query as string,
          store,
          country,
          maxResults: Math.min((args.max_results as number) || 5, 10),
          userId,
        });

        const formatted = result.products.map((p, i) => ({
          rank: i + 1,
          title: p.title,
          price: p.price ? `${p.currency === "BRL" ? "R$" : "$"}${p.price.toFixed(2)}${p.isApproximate ? " ~" : ""}` : "See price on site",
          rating: p.rating ? `${p.rating}/5` : null,
          reviews: p.reviewCount,
          store: p.store,
          url: p.url,
          asin: p.asin,
        }));

        // ─── Deal Radar: auto-create shadow price alert for top result ───
        const topProduct = result.products[0];
        if (topProduct?.price && topProduct.price > 0) {
          try {
            // Only create if no existing alert for similar query
            const existing = await prisma.priceAlert.findFirst({
              where: { userId, query: { contains: (args.query as string).substring(0, 20) }, active: true },
            });
            if (!existing) {
              await prisma.priceAlert.create({
                data: {
                  userId,
                  query: args.query as string,
                  store: `radar:${topProduct.store || "multi"}`,
                  targetPrice: Math.round(topProduct.price * 0.9 * 100) / 100, // 10% below current
                  currentPrice: topProduct.price,
                  currency: topProduct.currency || "USD",
                  country: (await prisma.user.findFirst({ where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] }, select: { country: true } }))?.country || "US",
                },
              });
              console.log(`[DEAL-RADAR] Auto-alert: "${args.query}" at $${topProduct.price}, target $${(topProduct.price * 0.9).toFixed(2)} for ${userId}`);
            }
          } catch { /* silent — radar is best-effort */ }
        }

        return {
          totalProducts: result.totalResults,
          searchMethod: result.method,
          methodsAttempted: result.methodsAttempted,
          products: formatted,
          instruction: "Present products as a RANKED LIST by price (cheapest first). Include: rank number, product name, price, rating, store, and clickable link.",
        };
      } catch (err) {
        console.error("[UNIFIED-SEARCH] Error:", err);
        return {
          error: `Product search failed: ${(err as Error).message}`,
          fallback_instruction: "IMPORTANT: The search tool failed but you MUST still help the user. Use your training knowledge to provide: approximate price, known retailers (Amazon, Best Buy, Walmart, Mercado Livre), and direct URLs. Mark prices as approximate.",
        };
      }
    }

    case "grocery_search": {
      try {
        const { searchGrocery, buildGroceryList } = await import("./shopping/grocery.service.js");
        const itemsRaw = args.items as string;
        const store = args.store as string | undefined;
        const zipCode = args.zip_code as string | undefined;

        // Detect user's country, city, and language from facts
        const isUS = !userId.includes("+55");
        let country = isUS ? "US" : "BR";
        let zip = zipCode;
        let city = "";
        let language = "";

        try {
          const facts = await prisma.$queryRaw<{ fact_key: string; fact_value: string }[]>`
            SELECT fact_key, fact_value FROM openclaw_user_facts
            WHERE user_id = ${userId} AND fact_key IN ('zip_code', 'location', 'city', 'country', 'preferred_language')
          `;
          for (const f of facts) {
            if (f.fact_key === "zip_code" && !zip) zip = f.fact_value;
            if (f.fact_key === "city") city = f.fact_value;
            if (f.fact_key === "country" && f.fact_value.toLowerCase().includes("br")) country = "BR";
            if (f.fact_key === "preferred_language") language = f.fact_value;
          }
        } catch { /* ok */ }

        const items = itemsRaw.split(",").map((i) => i.trim()).filter(Boolean);
        console.log(`[GROCERY] Tool called: ${items.length} items, store=${store || "any"}, zip=${zip || "?"}, country=${country}, city=${city || "?"}`);

        if (items.length === 1) {
          // Single item search
          const result = await searchGrocery({ query: items[0], zipCode: zip, store, country, city, language, maxResults: 5 });
          const symbol = country === "BR" ? "R$" : "$";
          return {
            query: items[0],
            totalResults: result.items.length,
            stores: result.byStore.map((s) => ({
              store: s.store,
              items: s.items.map((i) => ({
                name: i.name,
                price: i.price ? `${symbol}${i.price.toFixed(2)}` : "Price on site",
                brand: i.brand,
                onSale: i.onSale,
                savings: i.savings ? `${symbol}${i.savings.toFixed(2)}` : null,
                url: i.url,
              })),
              deliveryFee: s.deliveryFee != null ? `${symbol}${s.deliveryFee.toFixed(2)}` : "Varies",
              deliveryTime: s.deliveryTime,
            })),
            bestStore: result.bestStore,
            instruction: "Present results grouped by store. Highlight cheapest option and any sales. Show delivery fee and estimated time.",
          };
        } else {
          // Multi-item list — compare across stores
          const result = await buildGroceryList({ items, zipCode: zip, store, country, city, language, userId });
          const symbol = country === "BR" ? "R$" : "$";
          return {
            itemCount: items.length,
            stores: result.stores.map((s) => ({
              store: s.store,
              itemsFound: s.items.length,
              subtotal: `${symbol}${s.subtotal.toFixed(2)}`,
              deliveryFee: s.deliveryFee != null ? `${symbol}${s.deliveryFee.toFixed(2)}` : "Varies",
              estimatedTotal: `${symbol}${s.estimatedTotal.toFixed(2)}`,
              deliveryTime: s.deliveryTime,
              items: s.items.map((i) => ({
                name: i.name,
                price: `${symbol}${(i.price || 0).toFixed(2)}`,
                brand: i.brand,
                onSale: i.onSale,
              })),
            })),
            bestStore: result.bestStore,
            totalSavings: result.totalSavings > 0 ? `${symbol}${result.totalSavings.toFixed(2)}` : null,
            recommendation: result.recommendation,
            instruction: "Present as a STORE COMPARISON TABLE. Show each store with subtotal + delivery + total. Highlight the cheapest (bestStore). Use emojis for each item. Ask if user wants to order.",
          };
        }
      } catch (err) {
        console.error("[GROCERY] Error:", (err as Error).message);
        return { error: `Grocery search failed: ${(err as Error).message}` };
      }
    }

    case "shopping_plan_action": {
      try {
        const body = {
          userId,
          action: args.action as string,
          approvedItemIds: (args.approvedItemIds as string)
            ? (args.approvedItemIds as string).split(",").map((s: string) => s.trim())
            : undefined,
          rejectedItemIds: (args.rejectedItemIds as string)
            ? (args.rejectedItemIds as string).split(",").map((s: string) => s.trim())
            : undefined,
          swapRequests: (args.swapRequests as string) ? JSON.parse(args.swapRequests as string) : undefined,
        };
        const VOICE_SECRET = process.env.INTERNAL_SECRET || "";
        const res = await fetch(`${PAYJARVIS_URL}/api/shopping/lists/${args.listId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": VOICE_SECRET },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });
        const data = (await res.json()) as any;
        if (data.success) {
          const status = body.action === "reject" ? "rejected" : "approved";
          return {
            status,
            message:
              status === "rejected"
                ? "Shopping plan cancelled."
                : data.data?.priceChanged
                  ? "Some prices changed since the plan was created. Please review the updated prices."
                  : "Shopping plan approved! Items are ready.",
            priceChanged: data.data?.priceChanged || false,
            changes: data.data?.changes || [],
          };
        }
        return { error: data.error || "Shopping plan action failed" };
      } catch (err) {
        return { error: `Shopping plan action failed: ${(err as Error).message}` };
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

    case "set_price_alert": {
      try {
        const alert = await prisma.priceAlert.create({
          data: {
            userId,
            query: args.query as string,
            store: (args.store as string) || null,
            targetPrice: args.targetPrice as number,
            currency: "USD",
            country: "US",
          },
        });
        return { success: true, alertId: alert.id, message: `Price alert set! I'll check every 6 hours and notify you when "${args.query}" drops below $${args.targetPrice}.` };
      } catch (err) {
        return { error: `Failed to set price alert: ${(err as Error).message}` };
      }
    }

    case "get_price_alerts": {
      try {
        const alerts = await prisma.priceAlert.findMany({
          where: { userId, active: true },
          orderBy: { createdAt: "desc" },
        });
        if (alerts.length === 0) return { alerts: [], message: "No active price alerts." };
        return {
          alerts: alerts.map(a => ({
            id: a.id,
            query: a.query,
            store: a.store,
            targetPrice: a.targetPrice,
            currentPrice: a.currentPrice,
            lastChecked: a.lastChecked,
          })),
        };
      } catch (err) {
        return { error: `Failed to get alerts: ${(err as Error).message}` };
      }
    }

    case "manage_scheduled_task": {
      try {
        const { createScheduledTask, listScheduledTasks, pauseScheduledTask, resumeScheduledTask, deleteScheduledTask, editScheduledTask, inferAction, cronToHuman } = await import("./scheduled-tasks.service.js");
        const taskAction = (args.action as string) || "list";
        const channel = userId.startsWith("whatsapp:") ? "whatsapp" : "telegram";

        switch (taskAction) {
          case "create": {
            const desc = args.description as string;
            const schedule = args.schedule as string;
            if (!desc || !schedule) return { error: "Need description and schedule to create a task." };
            const toolParams = args.toolParams ? JSON.parse(args.toolParams as string) : undefined;
            const { action: inferredAction, actionData } = inferAction(desc, args.toolToRun as string, toolParams);
            const detectedLang = userId.includes("+55") ? "pt" : "en";
            const task = await createScheduledTask({
              userId,
              description: desc,
              schedule,
              action: inferredAction,
              actionData,
              channel,
              channelId: userId,
              language: detectedLang,
            });
            const humanSchedule = cronToHuman(task.schedule, detectedLang);
            return { success: true, taskId: task.id, schedule: humanSchedule, cronExpression: task.schedule, nextRun: task.nextRun?.toISOString() };
          }
          case "list": {
            const tasks = await listScheduledTasks(userId);
            if (tasks.length === 0) return { tasks: [], message: "No scheduled tasks." };
            return {
              tasks: tasks.map(t => ({
                id: t.id,
                description: t.description,
                schedule: cronToHuman(t.schedule, t.language),
                active: t.active,
                runCount: t.runCount,
                lastRun: t.lastRun?.toISOString(),
                nextRun: t.nextRun?.toISOString(),
              })),
            };
          }
          case "pause": {
            if (!args.taskId) return { error: "Need taskId to pause." };
            await pauseScheduledTask(args.taskId as string, userId);
            return { success: true, message: "Task paused." };
          }
          case "resume": {
            if (!args.taskId) return { error: "Need taskId to resume." };
            await resumeScheduledTask(args.taskId as string, userId);
            return { success: true, message: "Task resumed." };
          }
          case "delete": {
            if (!args.taskId) return { error: "Need taskId to delete." };
            await deleteScheduledTask(args.taskId as string, userId);
            return { success: true, message: "Task deleted." };
          }
          case "edit": {
            if (!args.taskId) return { error: "Need taskId to edit." };
            await editScheduledTask(args.taskId as string, userId, {
              description: args.description as string,
              schedule: args.schedule as string,
            });
            return { success: true, message: "Task updated." };
          }
          default:
            return { error: `Unknown action: ${taskAction}. Use create, list, edit, delete, pause, resume.` };
        }
      } catch (err) {
        return { error: `Scheduled task error: ${(err as Error).message}` };
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
        const channel = (args.channel as string) || null;
        return await generateShareForWhatsApp(userId, channel);
      } catch (err) {
        return { error: `Failed to generate share link: ${(err as Error).message}` };
      }
    }

    case "amazon_search": {
      console.log(`[UNIFIED-SEARCH] Tool called: amazon_search { query: "${args.query}" }`);
      try {
        const { unifiedProductSearch } = await import("./search/unified-search.service.js");
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
          select: { country: true },
        });
        const country = userRecord?.country || "US";

        const result = await unifiedProductSearch({
          query: args.query as string,
          store: "amazon",
          country,
          maxResults: (args.max_results as number) ?? 3,
          userId,
        });

        // ─── Deal Radar: auto-create shadow price alert for top Amazon result ───
        const topAmz = result.products[0];
        if (topAmz?.price && topAmz.price > 0) {
          try {
            const existing = await prisma.priceAlert.findFirst({
              where: { userId, query: { contains: (args.query as string).substring(0, 20) }, active: true },
            });
            if (!existing) {
              await prisma.priceAlert.create({
                data: {
                  userId,
                  query: args.query as string,
                  store: `radar:amazon`,
                  targetPrice: Math.round(topAmz.price * 0.9 * 100) / 100,
                  currentPrice: topAmz.price,
                  currency: "USD",
                  country: (await prisma.user.findFirst({ where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] }, select: { country: true } }))?.country || "US",
                },
              });
              console.log(`[DEAL-RADAR] Auto-alert (Amazon): "${args.query}" at $${topAmz.price} for ${userId}`);
            }
          } catch { /* silent */ }
        }

        return {
          results: result.products.map(p => ({
            title: p.title,
            price: p.price ? `$${p.price.toFixed(2)}` : "See price",
            rating: p.rating,
            reviews: p.reviewCount,
            store: p.store,
            url: p.url,
            asin: p.asin,
          })),
          searchMethod: result.method,
          message: `Found ${result.products.length} products. Present them with direct links.`,
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
            businessName: "Sniffer Live Call",
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

    case "manage_settings": {
      try {
        const action = args.action as string;
        const setting = args.setting as string | undefined;
        const value = args.value as string | undefined;

        // Resolve real userId from whatsapp phone
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
          select: { id: true },
        });
        if (!userRecord) return { error: "User not found" };
        const realUserId = userRecord.id;

        if (action === "get") {
          const prefs = await prisma.userNotificationPreferences.upsert({
            where: { userId: realUserId },
            create: { userId: realUserId },
            update: {},
          });
          return {
            success: true,
            settings: {
              morningBriefing: prefs.morningBriefing,
              priceAlerts: prefs.priceAlerts,
              reengagement: prefs.reengagement,
              weeklyReport: prefs.weeklyReport,
              smartTips: prefs.smartTips,
              achievements: prefs.achievements,
              birthday: prefs.birthday,
              pushEnabled: prefs.pushEnabled,
              timezone: prefs.timezone,
            },
          };
        }

        if (!setting) return { error: "Please specify which setting to change" };

        // Toggle settings
        const boolSettings = ["morningBriefing", "priceAlerts", "reengagement", "weeklyReport", "smartTips", "achievements", "birthday", "pushEnabled"];
        if (boolSettings.includes(setting)) {
          const newValue = action === "enable" ? true : action === "disable" ? false : value === "true";
          await prisma.userNotificationPreferences.upsert({
            where: { userId: realUserId },
            create: { userId: realUserId, [setting]: newValue },
            update: { [setting]: newValue },
          });
          return { success: true, setting, value: newValue, message: `${setting} is now ${newValue ? "enabled" : "disabled"}. To revert, just tell me!` };
        }

        // String settings (timezone)
        if (setting === "timezone" && value) {
          await prisma.userNotificationPreferences.upsert({
            where: { userId: realUserId },
            create: { userId: realUserId, timezone: value },
            update: { timezone: value },
          });
          return { success: true, setting: "timezone", value, message: `Timezone updated to ${value}` };
        }

        // Language preference (saved as user fact)
        if (setting === "preferred_language" && value) {
          await upsertFact(userId, "preferred_language", value, "personal", "settings");
          return { success: true, setting: "preferred_language", value, message: `Language set to ${value}` };
        }

        return { error: `Unknown setting: ${setting}. Available: ${boolSettings.join(", ")}, timezone, preferred_language` };
      } catch (err) {
        return { error: `Failed to manage settings: ${(err as Error).message}` };
      }
    }

    case "butler_protocol": {
      try {
        const action = args.action as string;
        const rawData = args.data as string | undefined;
        const data = rawData ? JSON.parse(rawData) : {};

        const res = await fetch(`${PAYJARVIS_URL}/api/butler/profile/${action === "setup" ? "setup" : action === "get_profile" ? "get" : action === "update_profile" ? "update" : action === "save_credential" ? "../credential/save" : action === "list_credentials" ? "../credentials/list" : action === "get_credential" ? "../credential/get" : action === "get_audit" ? "../audit" : "get"}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({
            userId,
            ...(action === "save_credential" || action === "get_credential" ? data : { data }),
          }),
          signal: AbortSignal.timeout(10000),
        });
        const result = await res.json() as Record<string, unknown>;
        return result;
      } catch (err) {
        return { error: `Butler Protocol failed: ${(err as Error).message}` };
      }
    }

    case "butler_autofill": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/butler/autofill`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({
            userId,
            serviceName: args.serviceName as string,
            action: args.action as string,
            targetUrl: args.targetUrl as string | undefined,
            details: args.details ? JSON.parse(args.details as string) : undefined,
          }),
          signal: AbortSignal.timeout(60000),
        });
        const result = await res.json() as Record<string, unknown>;
        return result;
      } catch (err) {
        return { error: `Butler Autofill failed: ${(err as Error).message}` };
      }
    }

    case "inner_circle_consult": {
      try {
        const slug = args.specialistSlug as string;
        const question = args.question as string;

        // Find specialist by slug
        const specRes = await fetch(`${PAYJARVIS_URL}/api/inner-circle/specialists`, {
          headers: { "x-internal-secret": process.env.INTERNAL_SECRET || "" },
        });
        const specList = await specRes.json() as any[];
        const spec = (Array.isArray(specList) ? specList : []).find((s: any) => s.slug === slug);
        if (!spec) return { error: `Specialist ${slug} not found` };

        const consultRes = await fetch(`${PAYJARVIS_URL}/api/inner-circle/consult`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({ userId, specialistId: spec.id, message: question }),
          signal: AbortSignal.timeout(15000),
        });
        const result = await consultRes.json() as Record<string, unknown>;
        return result;
      } catch (err) {
        return { error: `Inner Circle failed: ${(err as Error).message}` };
      }
    }

    case "butler_gmail": {
      try {
        const action = args.action as string;
        const query = args.query as string | undefined;
        const endpoint = action === "search" ? "gmail/search"
          : action === "unread" ? "gmail/unread"
          : action === "read" ? "gmail/read"
          : action === "confirmation_link" ? "gmail/confirmation-link"
          : "gmail/unread";

        const body: Record<string, any> = { userId };
        if (action === "search" && query) body.query = query;
        if (action === "read" || action === "confirmation_link") body.messageId = query;
        if (action === "unread") body.maxResults = 5;

        const res = await fetch(`${PAYJARVIS_URL}/api/butler/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });
        const result = await res.json() as Record<string, unknown>;
        return result;
      } catch (err) {
        return { error: `Butler Gmail failed: ${(err as Error).message}` };
      }
    }

    // ─── Skyfire — Purchase Flow ────────────────────────
    case "skyfire_setup_wallet": {
      console.log("[WALLET] Tool called: skyfire_setup_wallet");
      try {
        const { getUserWalletStatus } = await import("./purchase-orchestrator.service.js");
        const status = await getUserWalletStatus(userId);
        const walletUrl = "https://www.payjarvis.com/wallet/setup";

        if (status.hasCard) {
          return {
            success: true,
            walletUrl,
            ready: true,
            card: `${status.cardBrand || "Card"} ****${status.cardLast4 || "????"}`,
            spentToday: status.spentToday,
            limits: status.limits,
            message: `PayJarvis wallet is ready! Card: ${status.cardBrand || "Card"} ****${status.cardLast4 || "????"}. Spent today: $${status.spentToday.toFixed(2)}. You can buy directly in the chat!`,
            instructions: "NEVER mention 'Skyfire'. Say 'carteira PayJarvis'. Show the card info, today's spending, and limits. Offer to search for products.",
          };
        }

        return {
          success: true,
          walletUrl,
          ready: false,
          message: `To make purchases through chat, you need to add a payment card. Set it up here: ${walletUrl}`,
          instructions: "NEVER mention 'Skyfire'. Tell user to add card at payjarvis.com/wallet/setup. Card data is processed with bank-grade encryption. PayJarvis NEVER sees card numbers. After setup, they can buy directly in chat.",
        };
      } catch (err) {
        return { error: `Wallet check failed: ${(err as Error).message}` };
      }
    }

    case "skyfire_checkout": {
      console.log(`[PURCHASE] Tool called: skyfire_checkout { product: "${args.productName}", price: ${args.price}, merchant: "${args.merchant}" }`);
      try {
        const { executePurchase } = await import("./purchase-orchestrator.service.js");
        const result = await executePurchase({
          userId,
          productName: args.productName as string,
          price: args.price as number,
          currency: "USD",
          merchant: args.merchant as string,
          merchantUrl: args.merchantUrl as string | undefined,
        });

        if (!result.success) {
          if (result.status === "needs_card") {
            return { error: result.message, action: "Ask user to add payment card at payjarvis.com/wallet/setup", setupUrl: result.setupUrl };
          }
          return { error: result.message };
        }

        return {
          success: true,
          orderId: result.orderId,
          chargedAmount: result.chargedAmount,
          serviceFee: result.serviceFee,
          message: result.message,
          instruction: "Show: order ID, product, price, merchant, service fee. Offer to track delivery. Use 🎩 emoji. NEVER mention 'Skyfire'.",
        };
      } catch (err) {
        console.error("[PURCHASE] Checkout failed:", (err as Error).message);
        return { error: `Purchase failed: ${(err as Error).message}` };
      }
    }

    case "skyfire_my_purchases": {
      console.log("[SKYFIRE] Tool called: skyfire_my_purchases");
      try {
        const limit = Math.min((args.limit as number) || 5, 20);
        const purchases = await prisma.$queryRaw<any[]>`
          SELECT id, product_name, price, currency, merchant, order_number, tracking_number, status, created_at
          FROM purchase_transactions
          WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${limit}
        `;
        if (purchases.length === 0) {
          return { purchases: [], message: "No purchases yet. Search for a product and I'll help you buy it!" };
        }
        return {
          purchases: purchases.map(p => ({
            orderId: p.order_number || p.id,
            product: p.product_name,
            price: `$${p.price.toFixed(2)}`,
            merchant: p.merchant,
            tracking: p.tracking_number,
            status: p.status,
            date: new Date(p.created_at).toLocaleDateString("en-US"),
          })),
          message: `Found ${purchases.length} recent purchases.`,
        };
      } catch (err) {
        return { error: `Failed to fetch purchases: ${(err as Error).message}` };
      }
    }

    case "skyfire_spending": {
      console.log("[SKYFIRE] Tool called: skyfire_spending");
      try {
        const { getSpendingLimits, getSpendingToday, getSpendingThisMonth } = await import("./skyfire.service.js");
        const [limits, today, month] = await Promise.all([
          getSpendingLimits(userId),
          getSpendingToday(userId),
          getSpendingThisMonth(userId),
        ]);
        return {
          success: true,
          spentToday: today,
          spentThisMonth: month,
          limits,
          message: `Today: $${today.toFixed(2)} / $${limits.daily} | This month: $${month.toFixed(2)} / $${limits.monthly} | Per purchase: $${limits.perTransaction}`,
        };
      } catch (err) {
        return { error: `Spending check failed: ${(err as Error).message}` };
      }
    }

    case "skyfire_set_limits": {
      console.log(`[SKYFIRE] Tool called: skyfire_set_limits { perTx: ${args.perTransaction}, daily: ${args.daily}, monthly: ${args.monthly} }`);
      try {
        const { setSpendingLimits } = await import("./skyfire.service.js");
        const updated = await setSpendingLimits(userId, {
          perTransaction: args.perTransaction as number | undefined,
          daily: args.daily as number | undefined,
          monthly: args.monthly as number | undefined,
        });
        return {
          success: true,
          limits: updated,
          message: `Limits updated! Per purchase: $${updated.perTransaction} | Daily: $${updated.daily} | Monthly: $${updated.monthly}`,
        };
      } catch (err) {
        return { error: `Failed to update limits: ${(err as Error).message}` };
      }
    }

    // ─── Payment Wallet — Smart Checkout ──────────────────
    case "manage_payment_methods": {
      console.log(`[WALLET] Tool called: manage_payment_methods { action: "${args.action}" }`);
      try {
        const {
          getUserPaymentMethods,
          addPaymentMethod,
          removePaymentMethod,
          setDefaultMethod,
          getWalletSummary,
        } = await import("./payments/payment-wallet.service.js");

        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
        });
        if (!userRecord) return { error: "User not found" };

        const action = args.action as string;

        if (action === "list") {
          const methods = await getUserPaymentMethods(userRecord.id);
          if (methods.length === 0) {
            return {
              methods: [],
              message: "No payment methods set up yet.",
              instructions: "Offer to help add PayPal, credit card, PIX, or Amazon. Ask which they'd like to set up.",
            };
          }
          return {
            methods: methods.map(m => ({
              id: m.id,
              provider: m.provider,
              displayName: m.displayName || m.accountId,
              isDefault: m.isDefault,
              status: m.status,
            })),
            message: await getWalletSummary(userRecord.id),
          };
        }

        if (action === "add") {
          const provider = (args.provider as string || "").toUpperCase();
          const display = args.display_name as string || args.email as string || provider;
          const metaStr = args.metadata as string;
          let meta: Record<string, unknown> = {};
          if (metaStr) try { meta = JSON.parse(metaStr); } catch { /* ignore */ }

          if (args.email) meta.email = args.email;

          const method = await addPaymentMethod({
            userId: userRecord.id,
            provider: provider as any,
            displayName: display,
            accountId: args.email as string || display,
            metadata: meta,
            isDefault: false,
          });
          return {
            success: true,
            method: { id: method.id, provider: method.provider, displayName: method.displayName },
            message: `Added ${method.displayName} to your Payment Wallet!`,
            instructions: "Confirm it was added. Ask if they want to set it as default.",
          };
        }

        if (action === "remove") {
          const methodId = args.method_id as string;
          if (!methodId) return { error: "method_id is required for remove action" };
          const ok = await removePaymentMethod(userRecord.id, methodId);
          return ok
            ? { success: true, message: "Payment method removed." }
            : { error: "Payment method not found." };
        }

        if (action === "set_default") {
          const methodId = args.method_id as string;
          if (!methodId) return { error: "method_id is required for set_default action" };
          const ok = await setDefaultMethod(userRecord.id, methodId);
          return ok
            ? { success: true, message: "Default payment method updated!" }
            : { error: "Payment method not found." };
        }

        return { error: `Unknown action: ${action}` };
      } catch (err) {
        return { error: `Payment wallet error: ${(err as Error).message}` };
      }
    }

    case "smart_checkout": {
      const productName = args.product_name as string;
      const amount = args.amount as number;
      const currency = (args.currency as string) || "USD";
      const store = args.store as string | undefined;

      try {
        const { getPaymentOptions, classifyStore } = await import("./payments/payment-wallet.service.js");
        const storeType = classifyStore(store);
        console.log(`[SMART-CHECKOUT] Tool called: { product: "${productName}", amount: ${amount}, currency: "${currency}", store: "${store || "any"}", storeType: "${storeType}" }`);

        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
        });
        if (!userRecord) return { error: "User not found" };

        const result = await getPaymentOptions(userRecord.id, amount, currency, store);

        // Safeguards: confirm for amounts > $100, block > $500
        const safeguard = amount > 500
          ? "⚠️ This purchase exceeds $500. High-value purchases require manual approval."
          : amount > 100
            ? "⚠️ This is over $100. Please confirm you want to proceed."
            : null;

        // Build store-aware routing hints for the LLM
        const routingHints: Record<string, string> = {
          amazon: "For Amazon purchases, prefer the user's connected Amazon account (Playwright checkout). If unavailable, offer PayPal or credit card.",
          mercadolivre: "For Mercado Livre, prefer Mercado Pago (PIX with 5% discount, card installments up to 12x, or balance). If unavailable, send the direct ML product link.",
          us_store: "For US stores, prefer PayPal. If unavailable, offer credit card or PayJarvis Wallet.",
          br_store: "For Brazilian stores, prefer Mercado Pago or PIX. If unavailable, offer credit card.",
          unknown: "Offer the user's default payment method first. If no default, show all available options.",
        };

        return {
          product: productName,
          productUrl: args.product_url || null,
          amount,
          currency,
          store: store || null,
          storeType,
          options: result.options,
          message: result.message,
          hasValidOption: result.hasValidOption,
          safeguard,
          routingHint: routingHints[storeType] || routingHints.unknown,
          instructions: result.hasValidOption
            ? "Present the payment options sorted by relevance (first option is the best match for this store). If only ONE option is viable, suggest it directly without listing. For amounts > $100, ask for explicit confirmation. For > $500, BLOCK and warn."
            : storeType === "amazon"
              ? "User has no Amazon account connected. Suggest connecting via: 'Quer conectar sua conta Amazon? Leva 1 minuto e eu compro direto pra você!'"
              : storeType === "mercadolivre" || storeType === "br_store"
                ? "User has no payment method for Brazilian stores. Suggest: Mercado Pago, PIX, or send the direct product link so they can buy on the site."
                : "User has no payment method. Suggest adding PayPal (quickest), credit card, or Amazon account.",
        };
      } catch (err) {
        console.error("[SMART-CHECKOUT] Error:", (err as Error).message);
        return { error: `Smart checkout failed: ${(err as Error).message}` };
      }
    }

    // ─── Call Recordings ────────────────────────────────────
    case "list_call_recordings": {
      console.log("[RECORDINGS] Tool called: list_call_recordings");
      try {
        const limit = Math.min((args.limit as number) || 5, 20);
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
        });
        if (!userRecord) return { error: "User not found" };

        const recordings = await prisma.$queryRaw<Array<{
          id: string;
          callSid: string;
          recordingUrl: string;
          durationSeconds: number;
          fromNumber: string;
          toNumber: string;
          createdAt: Date;
        }>>`
          SELECT id, "callSid", "recordingUrl", "durationSeconds", "fromNumber", "toNumber", "createdAt"
          FROM call_recordings
          WHERE "userId" = ${userRecord.id}
          ORDER BY "createdAt" DESC
          LIMIT ${limit}
        `;

        if (recordings.length === 0) {
          return { recordings: [], message: "No call recordings yet. Make a call and it will be recorded automatically!" };
        }

        return {
          recordings: recordings.map(r => ({
            id: r.id,
            from: r.fromNumber,
            to: r.toNumber,
            duration: `${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s`,
            date: new Date(r.createdAt).toLocaleDateString("en-US"),
            listenUrl: r.recordingUrl,
          })),
          message: `Found ${recordings.length} recording(s). Send the listen URL to the user so they can play it.`,
          instructions: "Show each recording with: date, who was called (to number), duration, and the listen URL as a clickable link.",
        };
      } catch (err) {
        return { error: `Failed to fetch recordings: ${(err as Error).message}` };
      }
    }

    // ─── Opção B: 11 new handlers for WhatsApp parity ───

    case "compare_prices": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/retail/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify({ query: args.query, zipCode: args.zipCode }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Compare failed" };
      } catch (err) {
        return { error: `Retail API unavailable: ${(err as Error).message}` };
      }
    }

    case "find_coupons": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/shopping/coupons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store: args.store, purchaseAmount: args.purchaseAmount || undefined }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (data.success && data.data) {
          const { coupons, bestDeal } = data.data as { coupons: any[]; bestDeal: any };
          if (!coupons || coupons.length === 0) return { found: false };
          return {
            found: true,
            coupons: coupons.slice(0, 5).map((c: any) => ({
              code: c.code, description: c.description,
              discountType: c.discountType, discountValue: c.discountValue, verified: c.verified,
            })),
            bestDeal: bestDeal ? {
              code: bestDeal.bestCoupon?.code, description: bestDeal.bestCoupon?.description,
              estimatedSavings: bestDeal.savings,
            } : null,
          };
        }
        return { found: false };
      } catch (err) {
        console.error("[TOOL] find_coupons error:", (err as Error).message);
        return { found: false };
      }
    }

    case "check_price_history": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/shopping/price-history`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productName: args.productName, currentPrice: args.currentPrice,
            store: args.store || undefined, asin: args.asin || undefined,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (data.success && data.data) return data.data as Record<string, unknown>;
        return { indicator: "normal", emoji: "🟡", recommendation: "Could not check price history." };
      } catch (err) {
        console.error("[TOOL] check_price_history error:", (err as Error).message);
        return { indicator: "normal", emoji: "🟡", recommendation: "Price history unavailable." };
      }
    }

    case "complete_reminder": {
      try {
        await prisma.$executeRaw`UPDATE openclaw_reminders SET completed = true WHERE id = ${Number(args.reminderId)}`;
        return { success: true, reminderId: args.reminderId };
      } catch (err) {
        return { error: `Failed to complete reminder: ${(err as Error).message}` };
      }
    }

    case "find_stores": {
      try {
        const url = args.platform
          ? `${PAYJARVIS_URL}/api/retail/${args.platform}/stores/${args.zipCode}`
          : `${PAYJARVIS_URL}/api/retail/stores/${args.zipCode}`;
        const res = await fetch(url, {
          headers: { "X-Bot-Api-Key": BOT_API_KEY },
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Store search failed" };
      } catch (err) {
        return { error: `Retail API unavailable: ${(err as Error).message}` };
      }
    }

    case "request_handoff": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/handoffs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify({
            sessionUrl: args.sessionUrl, obstacleType: args.obstacleType, description: args.description,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Handoff failed" };
      } catch (err) {
        return { error: `Handoff API unavailable: ${(err as Error).message}` };
      }
    }

    case "search_transit": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/transit/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify({
            origin: args.origin, destination: args.destination,
            date: args.date, passengers: args.passengers || 1,
          }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Transit search failed" };
      } catch (err) {
        return { error: `Transit API unavailable: ${(err as Error).message}` };
      }
    }

    case "search_rental_cars": {
      try {
        const res = await fetch(`${BROWSER_AGENT_URL}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site: "enterprise", action: "searchCars",
            params: { location: args.location, pickupDate: args.pickupDate, returnDate: args.returnDate, carType: args.carType },
          }),
          signal: AbortSignal.timeout(45000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Rental search failed" };
      } catch (err) {
        return { error: `Rental car API unavailable: ${(err as Error).message}` };
      }
    }

    case "check_prescription": {
      try {
        const res = await fetch(`${PAYJARVIS_URL}/api/retail/rx/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Api-Key": BOT_API_KEY },
          body: JSON.stringify({
            rxNumber: args.rxNumber, platform: args.platform,
            lastName: args.lastName, dob: args.dateOfBirth,
          }),
          signal: AbortSignal.timeout(20000),
        });
        const data = await res.json() as Record<string, unknown>;
        return data.success ? (data.data as Record<string, unknown>) : { error: data.error || "Rx check failed" };
      } catch (err) {
        return { error: `Pharmacy API unavailable: ${(err as Error).message}` };
      }
    }

    case "scan_my_subscriptions": {
      try {
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
        });
        if (!userRecord) return { error: "User not found" };
        const res = await fetch(`${PAYJARVIS_URL}/api/subscriptions/scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userRecord.id }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json() as Record<string, unknown>;
        if (data.success && data.data) {
          const subs = data.data as any[];
          if (subs.length === 0) return { subscriptions: [], message: "No subscriptions found. Connect PayPal or Mercado Pago to scan." };
          const sumRes = await fetch(`${PAYJARVIS_URL}/api/subscriptions/${encodeURIComponent(userRecord.id)}/summary`, {
            signal: AbortSignal.timeout(10000),
          });
          const sumData = await sumRes.json() as Record<string, unknown>;
          return {
            subscriptions: subs.map((s: any) => ({
              id: s.id, name: s.serviceName, amount: s.amount, currency: s.currency,
              cycle: s.billingCycle, nextBilling: s.nextBillingDate,
              paymentMethod: s.paymentMethod, canCancel: s.canCancelViaApi, status: s.status,
            })),
            summary: sumData.success ? sumData.data : null,
          };
        }
        return { error: "Scan failed. PayPal or Mercado Pago may not be connected." };
      } catch (err) {
        return { error: `Subscription scan failed: ${(err as Error).message}` };
      }
    }

    case "subscription_report": {
      try {
        const userRecord = await prisma.user.findFirst({
          where: { OR: [{ telegramChatId: userId }, { phone: userId.replace("whatsapp:", "") }] },
        });
        if (!userRecord) return { error: "User not found" };
        const [sumRes, wasteRes] = await Promise.all([
          fetch(`${PAYJARVIS_URL}/api/subscriptions/${encodeURIComponent(userRecord.id)}/summary`, { signal: AbortSignal.timeout(10000) }),
          fetch(`${PAYJARVIS_URL}/api/subscriptions/${encodeURIComponent(userRecord.id)}/waste`, { signal: AbortSignal.timeout(10000) }),
        ]);
        const sumData = await sumRes.json() as Record<string, unknown>;
        const wasteData = await wasteRes.json() as Record<string, unknown>;
        return {
          summary: sumData.success ? sumData.data : null,
          waste: wasteData.success ? wasteData.data : [],
          message: sumData.success
            ? `Found subscriptions. Present total monthly, annual estimate, waste detected.`
            : "Could not generate report. Try scanning first with scan_my_subscriptions.",
        };
      } catch (err) {
        return { error: `Report failed: ${(err as Error).message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Share / Referral for WhatsApp ──────────────────────

const WA_NUMBER_US = "17547145921";
const WA_NUMBER_BR = "551150395940";
const PUBLIC_BASE = process.env.WEB_URL || "https://www.payjarvis.com";

async function generateShareForWhatsApp(userId: string, channel: string | null): Promise<Record<string, unknown>> {
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

  // Auto-detect channel from phone prefix if not specified
  let resolvedChannel = channel;
  if (!resolvedChannel) {
    const cleanPhone = phone.replace(/\+/g, "");
    if (cleanPhone.startsWith("55")) resolvedChannel = "whatsapp_br";
    else if (cleanPhone.startsWith("1")) resolvedChannel = "whatsapp_us";
    else resolvedChannel = "whatsapp_us"; // default
  }

  // Generate links for all channels
  const botUsername = "Jarvis12Brain_bot";
  const whatsappBrLink = `https://wa.me/${WA_NUMBER_BR}?text=${encodeURIComponent(`START ${code}`)}`;
  const whatsappUsLink = `https://wa.me/${WA_NUMBER_US}?text=${encodeURIComponent(`START ${code}`)}`;
  const telegramLink = `https://t.me/${botUsername}?start=${code}`;
  const webLink = `${PUBLIC_BASE}/join/${code}`;

  // Pick the primary link based on channel
  let primaryLink: string;
  let channelLabel: string;
  if (resolvedChannel === "whatsapp_br") {
    primaryLink = whatsappBrLink;
    channelLabel = "WhatsApp Brasil";
  } else if (resolvedChannel === "telegram") {
    primaryLink = telegramLink;
    channelLabel = "Telegram";
  } else {
    primaryLink = whatsappUsLink;
    channelLabel = "WhatsApp EUA";
  }

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

  await QRCode.toFile(qrFilePath, primaryLink, {
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

  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || `whatsapp:+${WA_NUMBER_US}`;
  const toNumber = userId.startsWith("whatsapp:") ? userId : `whatsapp:${userId}`;

  const { existsSync } = await import("fs");
  const hasCard = existsSync(cardFilePath);
  const mediaUrl = hasCard ? cardPublicUrl : `${PUBLIC_BASE}/public/qr/${qrFileName}`;

  // Send ALL links in one message — user picks which to share
  const bodyPt = `📲 *Links de indicação:*\n\n🇧🇷 WhatsApp Brasil: ${whatsappBrLink}\n🇺🇸 WhatsApp EUA: ${whatsappUsLink}\n💬 Telegram: ${telegramLink}\n🌐 Web: ${webLink}\n\nSeu amigo(a) ganha acesso Beta grátis ao Sniffer! 🐕`;
  const bodyEn = `📲 *Referral links:*\n\n🇧🇷 WhatsApp Brazil: ${whatsappBrLink}\n🇺🇸 WhatsApp USA: ${whatsappUsLink}\n💬 Telegram: ${telegramLink}\n🌐 Web: ${webLink}\n\nYour friend gets free Beta access to Sniffer! 🐕`;

  await client.messages.create({
    from: fromNumber,
    to: toNumber,
    body: isPt ? bodyPt : bodyEn,
    mediaUrl: [mediaUrl],
  });

  console.log(`[WA SHARE] Generated referral for ${userId}: ${code} → all channels (card: ${hasCard}, lang: ${lang})`);

  return {
    success: true,
    code,
    link: primaryLink,
    channel: "all",
    whatsappBrLink,
    whatsappUsLink,
    telegramLink,
    webLink,
    cardSent: hasCard,
    qrCodeSent: !hasCard,
    message: isPt
      ? `Links de indicação enviados! Todos os canais numa mensagem só. Seu amigo(a) ganha acesso Beta grátis ao Sniffer! 🐕`
      : `Referral links sent! All channels in one message. Your friend gets free Beta access to Sniffer! 🐕`,
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
  userFacts: { fact_key: string; fact_value: string }[],
  options: { glassesMode?: boolean } = {}
): Promise<string> {
  if (!GEMINI_API_KEY) {
    return "Sniffer is temporarily unavailable. Please try again in a moment.";
  }

  // ─── LLM Router: Grok for conversation, Gemini for tools ───
  if (XAI_API_KEY && shouldUseGrok(userMessage, history)) {
    try {
      console.log(`[WA LLM] Using Grok for: "${userMessage.substring(0, 60)}..."`);
      const grokResponse = await chatWithGrokApi(history, userMessage, userFacts);
      if (grokResponse) return grokResponse;
    } catch (err) {
      console.error(`[WA LLM] Grok failed, falling back to Gemini:`, (err as Error).message);
    }
  }

  // Store user facts for tool acknowledge messages (BUG 2 fix)
  _currentUserFacts = userFacts;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  let systemPrompt = buildSystemPrompt(userFacts, options);

  // Watchdog auto-healing: inject warning when recent failures detected
  try {
    const healingPrompt = await getAutoHealingPrompt();
    if (healingPrompt) {
      systemPrompt += `\n\n${healingPrompt}`;
    }
  } catch { /* non-blocking */ }

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
      // Watchdog: validate tool result — inject fallback for empty/failed results
      toolResult = validateToolResult(call.name, toolResult, userMessage);
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
    return "Sniffer is temporarily unavailable. Please try again in a moment.";
  }

  // Store user facts for tool acknowledge messages (BUG 2 fix)
  _currentUserFacts = userFacts;

  const MULTIMODAL_TIMEOUT_MS = 50_000; // 50s total timeout for image processing
  const TOOL_TIMEOUT_MS = 30_000;       // 30s per individual tool call
  const startTime = Date.now();

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const systemPrompt = buildSystemPrompt(userFacts);

  // Detect product/buy intent in caption to force tool calling
  const PRODUCT_INTENT_RE = /\b(compra|buy|purchase|price|preço|preco|quanto custa|how much|busca|search|procur|find|quero|want|achar|onde|where|cheapest|barato|melhor preço|best price|deal|oferta|desconto|discount)\b/i;
  const hasProductIntent = PRODUCT_INTENT_RE.test(userMessage || "");

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
    tools,
    ...(hasProductIntent ? {
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.ANY,
        },
      },
    } : {}),
  });

  if (hasProductIntent) {
    console.log(`[WA IMAGE] Product intent detected in caption, forcing tool calling mode`);
  }

  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [
    { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
    { text: userMessage || "Analyze this image and tell me how I can help." },
  ];

  let chatSession = model.startChat({ history });
  let result;
  let response;
  let lastGoodText = ""; // Track partial text for timeout fallback

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

  // Capture any initial text (Gemini may respond with text BEFORE calling tools)
  try {
    const initialText = response.text();
    if (initialText) lastGoodText = initialText;
  } catch { /* text() throws if response has only function calls — ignore */ }

  // Function calling loop (max 8 iterations, with total timeout)
  let iterations = 0;
  while (response.functionCalls() && response.functionCalls()!.length > 0 && iterations < 8) {
    iterations++;

    // Check total timeout before starting a new tool iteration
    const elapsed = Date.now() - startTime;
    if (elapsed > MULTIMODAL_TIMEOUT_MS) {
      console.warn(`[WA IMAGE] Total timeout exceeded (${elapsed}ms, ${iterations} iters). Returning partial.`);
      return lastGoodText || "Identifiquei o produto na imagem mas a busca demorou demais. Me diz o nome do produto que eu busco rapidinho! 🐕";
    }

    const functionCalls = response.functionCalls()!;
    const functionResponses = [];

    for (const call of functionCalls) {
      console.log(`[WA IMAGE TOOL] ${call.name}(${JSON.stringify(call.args).substring(0, 100)})`);
      let toolResult: Record<string, unknown>;
      try {
        // Individual tool timeout via Promise.race
        const toolPromise = handleTool(userId, call.name, call.args as Record<string, unknown>);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool ${call.name} timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)
        );
        toolResult = await Promise.race([toolPromise, timeoutPromise]);
      } catch (err) {
        const errMsg = (err as Error).message || "Tool execution failed";
        console.error(`[WA IMAGE TOOL] ${call.name} FAILED: ${errMsg}`);
        toolResult = { error: errMsg };
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
      // Capture any text from this iteration as fallback
      try {
        const iterText = response.text();
        if (iterText) lastGoodText = iterText;
      } catch { /* only function calls, no text — ignore */ }
    } catch (err) {
      console.error(`[WA IMAGE] Error sending function response: ${(err as Error).message}`);
      return lastGoodText || "Erro ao processar os resultados da busca. Tenta de novo! 🐕";
    }
  }

  // ─── Post-hoc product search fallback ─────────────────────
  // When the model analyzes an image but doesn't call search_products,
  // detect if a product was identified and force a search
  if (iterations === 0) {
    const textSoFar = response.text() || lastGoodText || "";
    const combinedText = `${userMessage || ""} ${textSoFar}`.toLowerCase();

    // Broad product signals: caption has buy intent OR model response mentions product-like terms
    const PRODUCT_SIGNALS_RE = /\b(compra|buy|purchase|price|preço|preco|quanto|how much|busca|search|procur|find|quero|want|product|produto|perfume|cologne|fragrance|phone|laptop|shoe|tênis|sneaker|headphone|watch|relógio|câmera|camera|tablet|tv|monitor|speaker|earbuds|cosmetic|makeup|skincare|creme|loção|shampoo|supplement|vitamin)\b/i;

    if (PRODUCT_SIGNALS_RE.test(combinedText) && textSoFar.length > 10) {
      console.log(`[WA IMAGE] 0 tool iterations but product signals detected. Running post-hoc search...`);

      try {
        const elapsed = Date.now() - startTime;
        if (elapsed < MULTIMODAL_TIMEOUT_MS - 15_000) { // Need at least 15s remaining
          // Extract product name from model's visual analysis
          const extractModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
          const extractResult = await extractModel.generateContent(
            `Extract ONLY the product name from this text for an e-commerce search query. Return ONLY the product name (brand + model), nothing else. No quotes, no explanation.\n\nUser said: "${userMessage}"\nImage analysis: "${textSoFar.substring(0, 500)}"`
          );
          const productQuery = extractResult.response.text().trim().replace(/^["']|["']$/g, "");

          if (productQuery && productQuery.length > 2 && productQuery.length < 150) {
            console.log(`[WA IMAGE] Post-hoc search query: "${productQuery}"`);

            // Run the actual product search
            const searchResult = await Promise.race([
              handleTool(userId, "search_products", { query: productQuery, max_results: 5 }),
              new Promise<Record<string, unknown>>((_, reject) =>
                setTimeout(() => reject(new Error("Post-hoc search timeout")), TOOL_TIMEOUT_MS)
              ),
            ]);

            // Send search results back to the model for a combined response
            const searchJson = JSON.stringify(searchResult).substring(0, 4000);
            const finalResult = await chatSession.sendMessage(
              `I searched for "${productQuery}" and found these results:\n${searchJson}\n\nPresent these search results to the user alongside your image analysis. Include prices and links. Be concise — the user is on WhatsApp.`
            );

            const finalText = finalResult.response.text();
            if (finalText) {
              const duration = Date.now() - startTime;
              console.log(`[WA IMAGE] Completed with post-hoc search in ${duration}ms`);
              return finalText;
            }
          }
        }
      } catch (err) {
        console.error(`[WA IMAGE] Post-hoc search failed: ${(err as Error).message}`);
        // Fall through to return the original text response
      }
    }
  }

  const text = response.text();
  const duration = Date.now() - startTime;
  console.log(`[WA IMAGE] Completed in ${duration}ms (${iterations} tool iterations)`);
  return text || lastGoodText || "Analisei a imagem mas não consegui gerar uma resposta. Tenta de novo! 🐕";
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

export async function processWhatsAppMessage(from: string, text: string, botNumber?: string): Promise<string> {
  // User ID is the WhatsApp number (e.g. "whatsapp:+19546432431")
  const userId = from;
  // Detect default language from Jarvis number: BR number → pt, else → en
  const isBrBot = botNumber?.includes("+5511") ?? false;

  console.log(`[WhatsApp] ${userId}: ${text.substring(0, 80)} (bot: ${botNumber || "unknown"})`);

  // 0a. Handle START command (referral deep-link from wa.me/17547145921?text=START+CODE)
  // Also match "Quero começar CODE" as alternative link format
  const startMatch = text.match(/^(?:START|Quero\s+come[cç]ar)\s+(\S+)$/i);
  if (startMatch) {
    try {
      const result = await startOnboarding(userId, "whatsapp", startMatch[1], text, botNumber);
      return result.message;
    } catch (err) {
      console.error("[WA START] Error:", (err as Error).message);
      return "Erro ao iniciar. Tente novamente.";
    }
  }

  // 0b. Detect Ray-Ban Meta / smart glasses mention → send guide + save fact
  const metaGlassesPattern = /\b(ray[\s-]?ban|meta\s*glass|smart\s*glass|[oó]culos\s*(inteligente|meta|smart)|lentes?\s*(inteligente|meta|smart)|gafas?\s*(inteligente|meta|smart))\b/i;
  if (metaGlassesPattern.test(text)) {
    try {
      // Check if we already sent the guide
      const existingFact = await prisma.$queryRaw<{ fact_value: string }[]>`
        SELECT fact_value FROM openclaw_user_facts
        WHERE user_id = ${userId} AND fact_key = 'has_meta_glasses' LIMIT 1
      `;
      if (existingFact.length === 0) {
        // Save fact
        await upsertFact(userId, "has_meta_glasses", "true", "device", "auto");
        console.log(`[WA META-GLASSES] Detected for ${userId}, saving fact + sending guide`);

        // Detect language
        const langFacts = await prisma.$queryRaw<{ fact_value: string }[]>`
          SELECT fact_value FROM openclaw_user_facts
          WHERE user_id = ${userId} AND fact_key = 'language' LIMIT 1
        `;
        const lang = langFacts.length > 0 && langFacts[0].fact_value.startsWith("pt") ? "pt"
          : langFacts.length > 0 && langFacts[0].fact_value.startsWith("es") ? "es" : "en";

        const guide = lang === "pt"
          ? `Voce tem Ray-Ban Meta? Perfeito! 😎

Pode usar o Sniffer direto pelo oculos:

🎙️ "Hey Meta, send message to Sniffer: busca tenis Nike"
📸 Tire foto de um produto → "Hey Meta, send that to Sniffer"
🛒 "Hey Meta, tell Sniffer: compra o perfume"

Salva meu numero como "Sniffer" nos contatos e pronto! 🐕`
          : lang === "es"
          ? `Tienes Ray-Ban Meta? Perfecto! 😎

Puedes usar Sniffer directo desde los lentes:

🎙️ "Hey Meta, send message to Sniffer: busca tenis Nike"
📸 Toma foto de un producto → "Hey Meta, send that to Sniffer"
🛒 "Hey Meta, tell Sniffer: compra el perfume"

Guarda mi numero como "Sniffer" en contactos y listo! 🐕`
          : `You have Ray-Ban Meta? Perfect! 😎

You can use Sniffer directly from your glasses:

🎙️ "Hey Meta, send message to Sniffer: find Nike shoes"
📸 Take a photo of a product → "Hey Meta, send that to Sniffer"
🛒 "Hey Meta, tell Sniffer: buy the perfume"

Save my number as "Sniffer" in your contacts and you're set! 🐕`;

        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", guide);
        return guide;
      }
      // If fact already exists, just update and fall through to normal flow
      await upsertFact(userId, "has_meta_glasses", "true", "device", "auto");
    } catch (err) {
      console.error("[WA META-GLASSES] Error:", (err as Error).message);
      // Fall through to normal flow
    }
  }

  // 0b2. Glasses mode detection — voice-relayed commands from Meta AI
  let glassesMode = false;
  try {
    const glassesFact = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${userId} AND fact_key = 'has_meta_glasses' LIMIT 1
    `;
    const hasGlasses = glassesFact.length > 0 && glassesFact[0].fact_value === "true";
    if (hasGlasses) {
      const isVoiceRelay = (
        text.length < 120 &&
        !/[.!?;:,]/.test(text.replace(/[.!?]$/, "")) &&
        /^(busca|procura|compra|acha|encontra|quanto|qual|onde|find|buy|search|get|look|how much|where|compare|track)/i.test(text.trim())
      );
      if (isVoiceRelay) {
        glassesMode = true;
        console.log(`[WA META-GLASSES] Glasses mode ON for ${userId}: "${text.substring(0, 50)}"`);
      }
    }
  } catch { /* non-blocking */ }

  // 0c. Handle share/referral intent — detect before sending to Gemini
  const shareIntent = /\b(compartilh\w*|indicar|indic[aá]\w*|convidar|convid\w*|convite|share|invite|refer|qr\s*code|link.*(indic|refer|convit|compart)|amigo.*jarvis|jarvis.*amigo|mand[ae].*link|envi[ae].*link)\b/i;
  if (shareIntent.test(text)) {
    try {
      const result = await generateShareForWhatsApp(userId, null);
      if (result.success) {
        // Card/QR + link already sent by generateShareForWhatsApp
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", `Referral link sent: ${result.link}`);
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
      // Track engagement interaction (async, non-blocking)
      trackInteraction(user.id, "message").then(() => checkAndGrantAchievements(user.id)).catch(() => {});
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
            const result = await startOnboarding(userId, "whatsapp", ref.share_code ?? undefined, text, botNumber);
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
            const result = await startOnboarding(userId, "whatsapp", shareCode, text, botNumber);
            return result.message;
          } catch (err) {
            console.error("[WA VOICE-REFERRAL] Onboarding start error:", (err as Error).message);
          }
        }
      } catch (err) {
        console.error("[WA VOICE-REFERRAL] Check error:", (err as Error).message);
      }

      // No referral context — detect language and onboard
      console.log(`[WhatsApp] Unknown user ${userId} — no account, no onboarding. isBrBot=${isBrBot}`);

      // Auto-seed BR facts for users arriving via +55 11 number
      if (isBrBot) {
        const brFacts: [string, string, string][] = [
          ["country", "BR", "personal"],
          ["preferred_language", "Portuguese", "personal"],
          ["language", "pt-BR", "personal"],
          ["currency", "BRL", "personal"],
          ["onboarded_via", "whatsapp_br", "general"],
        ];
        for (const [key, value, category] of brFacts) {
          await prisma.$executeRaw`
            INSERT INTO openclaw_user_facts (user_id, fact_key, fact_value, category, source, confidence)
            VALUES (${userId}, ${key}, ${value}, ${category}, 'auto_onboarding', 0.9)
            ON CONFLICT (user_id, fact_key) DO NOTHING
          `.catch(() => {});
        }
        // Save profileName as name if available
        const profileName = text.match(/^([\p{L}\s]{2,30})$/u)?.[1] || "";
        console.log(`[WhatsApp] BR onboarding: seeded facts for ${userId}`);
      }

      // Start onboarding for new users (no invite required)
      try {
        const result = await startOnboarding(userId, "whatsapp", undefined, text, botNumber);
        return result.message;
      } catch (err) {
        console.error("[WA AUTO-ONBOARD] Error:", (err as Error).message);
        // Fallback welcome if onboarding service fails
        if (isBrBot) {
          return "Oi! Eu sou o Sniffer, seu farejador de ofertas 🐕\n\nFarejo o melhor preço em centenas de lojas, monitoro promoções e aviso quando cair. Tudo pelo WhatsApp!\n\nPra começar:\n🔍 Me diz um produto que você quer\n📸 Manda uma foto de algo que viu\n🛒 Me pede uma lista de supermercado\n\nQual é o seu nome? 🐕";
        }
        return "Hi! I'm Sniffer, your deal-hunting agent 🐕\n\nI sniff out the best prices across hundreds of stores, monitor deals, and alert you when prices drop. All via WhatsApp!\n\nTo get started:\n🔍 Tell me a product you want\n📸 Send a photo of something you saw\n🛒 Ask me for a grocery list\n\nWhat's your name? 🐕";
      }
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
          body: JSON.stringify({ userId, text, platform: "whatsapp", glassesMode }),
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
          response = await chatWithGemini(history, text, userId, userFacts, { glassesMode });
          await saveMessage(userId, "user", text);
          await saveMessage(userId, "model", response);
        }
      } catch (err) {
        // Fallback to standard if premium service unavailable
        console.warn("[WA PREMIUM] Service unavailable, fallback:", (err as Error).message);
        response = await chatWithGemini(history, text, userId, userFacts, { glassesMode });
        await saveMessage(userId, "user", text);
        await saveMessage(userId, "model", response);
      }
    } else {
      // ═══ STANDARD PIPELINE ═══
      response = await chatWithGemini(history, text, userId, userFacts, { glassesMode });
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
