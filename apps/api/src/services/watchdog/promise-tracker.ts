/**
 * Watchdog — Promise Tracker
 *
 * Detects when Jarvis makes promises ("vou buscar", "deixa comigo") and tracks
 * whether they are fulfilled. Unfulfilled promises trigger automatic fallbacks.
 *
 * Flow:
 *   1. After Jarvis sends a response → detectPromise() checks for promise patterns
 *   2. If promise detected → registerPromise() inserts PENDING row
 *   3. When next Jarvis message arrives with results → fulfillPromise()
 *   4. Cron job checks for stale PENDING promises (>60s) → sends fallback + marks FAILED
 */

import { prisma } from "@payjarvis/database";
import { redisGet, redisSet, redisIncr } from "../redis.js";

// ─── Promise Detection Patterns ───

const PROMISE_PATTERNS_PT = [
  /\b(vou buscar|vou procurar|vou checar|vou verificar|vou pesquisar)\b/i,
  /\b(deixa comigo|pode deixar|já trago|já busco|já procuro)\b/i,
  /\b(estou (buscando|procurando|checando|verificando|pesquisando))\b/i,
  /\b(buscando (pra|para) voc[êe])\b/i,
  /\b(aguarda? que|espera? um (momento|instante|minutinho))\b/i,
  /\b(vou dar uma olhada|deixa eu ver)\b/i,
];

const PROMISE_PATTERNS_EN = [
  /\b(let me (search|look|check|find|browse))\b/i,
  /\b(i('ll| will) (search|look|check|find|browse|get))\b/i,
  /\b(searching|looking|checking|finding|browsing) (for|into|up)\b/i,
  /\b(on it|give me a (moment|second|sec))\b/i,
  /\b(hang on|hold on|one moment|one sec)\b/i,
  /\b(let me pull (up|that))\b/i,
];

const PROMISE_PATTERNS_ES = [
  /\b(voy a (buscar|verificar|checar|revisar))\b/i,
  /\b(déjame (buscar|verificar|revisar))\b/i,
  /\b(estoy (buscando|verificando|revisando))\b/i,
  /\b(dame un (momento|segundo|instante))\b/i,
];

const ALL_PROMISE_PATTERNS = [
  ...PROMISE_PATTERNS_PT,
  ...PROMISE_PATTERNS_EN,
  ...PROMISE_PATTERNS_ES,
];

// Patterns that indicate a result was delivered (not just another promise)
const RESULT_PATTERNS = [
  /\b(encontrei|achei|aqui est[áa]|confira|resultado|opcões|opções)\b/i,
  /\b(found|here('s| is| are)|results?|options?|check (this|these))\b/i,
  /\b(encontré|aquí está|resultados|opciones)\b/i,
  /\$\d+|R\$\s?\d+|€\d+/i, // Price found = result delivered
  /https?:\/\//i, // Link found = result delivered
  /\d+\.\s/i, // Numbered list = result delivered
];

// ─── Category Detection for Smart Fallbacks ───

interface FallbackCategory {
  category: string;
  links: { label: string; url: string }[];
}

const CATEGORY_PATTERNS: { pattern: RegExp; category: string; links: { label: string; url: string }[] }[] = [
  {
    pattern: /\b(hotel|hosped|airbnb|booking|pousada|inn|resort|stay|ficar|dormir|accommodation)\b/i,
    category: "hospedagem",
    links: [
      { label: "Airbnb", url: "https://www.airbnb.com" },
      { label: "Booking.com", url: "https://www.booking.com" },
      { label: "VRBO", url: "https://www.vrbo.com" },
    ],
  },
  {
    pattern: /\b(product|produto|comprar|buy|shop|loja|store|amazon|walmart|target)\b/i,
    category: "produto",
    links: [
      { label: "Amazon", url: "https://www.amazon.com" },
      { label: "Google Shopping", url: "https://shopping.google.com" },
      { label: "Walmart", url: "https://www.walmart.com" },
    ],
  },
  {
    pattern: /\b(ingresso|ticket|show|concert|evento|event|game|jogo|espetáculo)\b/i,
    category: "ingressos",
    links: [
      { label: "Ticketmaster", url: "https://www.ticketmaster.com" },
      { label: "StubHub", url: "https://www.stubhub.com" },
      { label: "Eventbrite", url: "https://www.eventbrite.com" },
    ],
  },
  {
    pattern: /\b(restaurante?|comida|food|comer|eat|dinner|lunch|jantar|almoço|brunch)\b/i,
    category: "restaurante",
    links: [
      { label: "OpenTable", url: "https://www.opentable.com" },
      { label: "Google Maps", url: "https://maps.google.com" },
      { label: "Yelp", url: "https://www.yelp.com" },
    ],
  },
  {
    pattern: /\b(v[ôo]o|flight|passagem|aérea?|avião|airplane|airline)\b/i,
    category: "voos",
    links: [
      { label: "Google Flights", url: "https://www.google.com/flights" },
      { label: "Kayak", url: "https://www.kayak.com" },
      { label: "Skyscanner", url: "https://www.skyscanner.com" },
    ],
  },
  {
    pattern: /\b(carro|car|rental|alug(ar|uel)|rent)\b/i,
    category: "aluguel de carro",
    links: [
      { label: "Turo", url: "https://www.turo.com" },
      { label: "Enterprise", url: "https://www.enterprise.com" },
      { label: "Kayak Cars", url: "https://www.kayak.com/cars" },
    ],
  },
];

// ─── Core Functions ───

// Patterns that indicate a phone call action (NOT a search promise — calls take >60s)
const CALL_EXCLUSION_PATTERNS = [
  /\b(vou ligar|ligando|chamando|calling|make.*call|phone call)\b/i,
  /\b(call.*initiated|iniciando.*ligação|fazendo.*ligação)\b/i,
  /\+\d{10,}/i, // Phone number in the message
];

/**
 * Detect if a message contains a promise pattern.
 * Excludes phone call actions — calls take longer than the 60s watchdog timeout.
 */
export function detectPromise(message: string): boolean {
  // Skip if this is a phone call action, not a search promise
  if (CALL_EXCLUSION_PATTERNS.some((p) => p.test(message))) {
    return false;
  }
  return ALL_PROMISE_PATTERNS.some((p) => p.test(message));
}

/**
 * Detect if a message contains actual results (not just another promise).
 */
export function detectResult(message: string): boolean {
  return RESULT_PATTERNS.some((p) => p.test(message));
}

/**
 * Register a new promise in the database.
 */
export async function registerPromise(
  userId: string,
  channel: string,
  promiseText: string,
  promisedAction?: string
): Promise<string> {
  const result = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO watchdog_promises (user_id, channel, promise_text, promised_action, status, created_at)
    VALUES (${userId}, ${channel}, ${promiseText.substring(0, 500)}, ${promisedAction || null}, 'PENDING', NOW())
    RETURNING id::text
  `;
  console.log(`[WATCHDOG] Promise registered for ${userId}: "${promiseText.substring(0, 80)}"`);
  // Track in Redis for fast hourly count
  await redisIncr("watchdog:promises:hour", 3600);
  return result[0].id;
}

/**
 * Mark the most recent PENDING promise for a user as FULFILLED.
 */
export async function fulfillPromise(userId: string): Promise<boolean> {
  const result = await prisma.$executeRaw`
    UPDATE watchdog_promises
    SET status = 'FULFILLED', fulfilled_at = NOW()
    WHERE user_id = ${userId}
      AND status = 'PENDING'
      AND created_at = (
        SELECT MAX(created_at) FROM watchdog_promises
        WHERE user_id = ${userId} AND status = 'PENDING'
      )
  `;
  if (result > 0) {
    console.log(`[WATCHDOG] Promise fulfilled for ${userId}`);
  }
  return result > 0;
}

/**
 * Get all expired PENDING promises (older than 60 seconds).
 */
export async function getExpiredPromises(): Promise<
  { id: string; user_id: string; channel: string; promise_text: string }[]
> {
  return prisma.$queryRaw`
    SELECT id::text, user_id, channel, promise_text
    FROM watchdog_promises
    WHERE status = 'PENDING'
      AND created_at < NOW() - INTERVAL '60 seconds'
    ORDER BY created_at ASC
    LIMIT 50
  `;
}

/**
 * Mark a promise as FAILED and record fallback sent time.
 */
export async function markPromiseFailed(promiseId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE watchdog_promises
    SET status = 'FAILED', fallback_sent_at = NOW()
    WHERE id = ${promiseId}::uuid
  `;
}

/**
 * Count FAILED promises in the last hour.
 */
export async function getFailedCountLastHour(): Promise<number> {
  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count
    FROM watchdog_promises
    WHERE status = 'FAILED'
      AND fallback_sent_at > NOW() - INTERVAL '1 hour'
  `;
  return Number(result[0].count);
}

/**
 * Detect the best fallback category based on the user's recent messages.
 */
export function detectFallbackCategory(promiseText: string): FallbackCategory {
  for (const { pattern, category, links } of CATEGORY_PATTERNS) {
    if (pattern.test(promiseText)) {
      return { category, links };
    }
  }
  return {
    category: "genérico",
    links: [
      { label: "Google", url: "https://www.google.com" },
    ],
  };
}

/**
 * Build a smart fallback message based on category.
 */
export function buildFallbackMessage(
  promiseText: string,
  lang: string = "pt"
): string {
  const { category, links } = detectFallbackCategory(promiseText);

  const linkList = links
    .map((l, i) => `${i + 1}. ${l.label}: ${l.url}`)
    .join("\n");

  if (lang === "pt" || lang === "pt-BR") {
    return (
      `Não achei resultados exatos agora, mas aqui vão alternativas para ${category}:\n` +
      `${linkList}\n` +
      `Quer que eu continue procurando? 🐕`
    );
  }
  if (lang === "es") {
    return (
      `No encontré resultados exactos ahora, pero aquí van alternativas para ${category}:\n` +
      `${linkList}\n` +
      `¿Quieres que siga buscando? 🐕`
    );
  }
  return (
    `Couldn't find exact results right now, but here are alternatives for ${category}:\n` +
    `${linkList}\n` +
    `Want me to keep looking? 🐕`
  );
}

/**
 * Check if auto-healing should activate (3+ failures in 1 hour).
 * Returns the additional system prompt injection if needed.
 */
export async function getAutoHealingPrompt(): Promise<string | null> {
  const failedCount = await getFailedCountLastHour();
  if (failedCount >= 3) {
    console.log(`[WATCHDOG] Auto-healing active: ${failedCount} failures in last hour`);
    return `ATENÇÃO WATCHDOG: Suas últimas ${failedCount} buscas falharam na última hora. NÃO prometa buscar. Dê a melhor resposta com seu conhecimento atual + links diretos. Se não tem certeza do preço, diga "preço aproximado". NUNCA diga "vou buscar" ou "deixa comigo" — dê a resposta AGORA.`;
  }
  return null;
}

/**
 * Detect user language from their userId (phone number for WhatsApp).
 */
export function detectLangFromUser(userId: string): string {
  if (userId.includes("+55")) return "pt";
  if (userId.includes("+34") || userId.includes("+52") || userId.includes("+54")) return "es";
  return "en";
}
