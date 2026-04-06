// Post-Purchase Follow-Up Service
// 4 stages: confirmation (immediate), day3 (delivery check), day7 (satisfaction), day30+ (restock)

import { prisma, Prisma } from "@payjarvis/database";
import { sendTelegramNotification } from "../notifications.js";
import { redisGet, redisSet } from "../redis.js";

const PAYJARVIS_URL = process.env.PAYJARVIS_URL || "http://localhost:3001";

// ─── Types ───

interface PurchaseRow {
  id: string;
  user_id: string;
  product_name: string;
  product_url: string | null;
  store: string;
  price: number | null;
  currency: string;
  category: string | null;
  brand: string | null;
  purchased_at: Date;
  follow_up_status: string;
  follow_up_day3_at: Date | null;
  follow_up_day7_at: Date | null;
  follow_up_restock_at: Date | null;
  tracking_number: string | null;
  is_recurring: boolean;
  reorder_cycle_days: number | null;
}

// Estimated restock days by category
const RESTOCK_DAYS: Record<string, number> = {
  perfume: 90,
  fragrance: 90,
  cologne: 90,
  supplement: 30,
  vitamin: 30,
  protein: 30,
  skincare: 60,
  shampoo: 45,
  conditioner: 45,
  deodorant: 30,
  toothpaste: 30,
  coffee: 21,
  tea: 30,
  cleaning: 30,
  detergent: 30,
  pet_food: 30,
  diapers: 14,
  default_consumable: 60,
};

function getRestockDays(category: string | null, productName: string): number | null {
  if (category) {
    const lower = category.toLowerCase();
    for (const [key, days] of Object.entries(RESTOCK_DAYS)) {
      if (lower.includes(key)) return days;
    }
  }
  // Try to detect from product name
  const nameLower = (productName || "").toLowerCase();
  for (const [key, days] of Object.entries(RESTOCK_DAYS)) {
    if (nameLower.includes(key)) return days;
  }
  return null; // Not a consumable
}

// ─── Language detection ───

async function getUserLang(userId: string): Promise<"pt" | "en" | "es"> {
  try {
    const rows = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${userId} AND fact_key IN ('language', 'preferred_language')
      LIMIT 1
    `;
    if (rows.length > 0) {
      const val = rows[0].fact_value.toLowerCase();
      if (val.includes("pt") || val.includes("portug")) return "pt";
      if (val.includes("es") || val.includes("span")) return "es";
    }
  } catch { /* default to en */ }
  return "en";
}

async function getUserName(userId: string): Promise<string> {
  try {
    const rows = await prisma.$queryRaw<{ fact_value: string }[]>`
      SELECT fact_value FROM openclaw_user_facts
      WHERE user_id = ${userId} AND fact_key = 'name' LIMIT 1
    `;
    return rows[0]?.fact_value || "there";
  } catch {
    return "there";
  }
}

// ─── Quiet Hours Check ───

function isQuietHours(): boolean {
  const hour = new Date().getUTCHours();
  // Conservative: skip 2-12 UTC (covers 22-8 in most US/BR timezones)
  return hour >= 2 && hour < 12;
}

// ─── Send message via Telegram (primary channel for follow-ups) ───

async function sendFollowUp(
  userId: string,
  message: string,
  buttons?: { text: string; callback_data: string }[][],
): Promise<boolean> {
  try {
    // userId in purchase_history is telegramChatId or whatsapp:+phone
    const isTelegram = /^\d+$/.test(userId);
    if (isTelegram) {
      const reply_markup = buttons ? { inline_keyboard: buttons } : undefined;
      return await sendTelegramNotification(userId, message, reply_markup);
    }

    // WhatsApp — send plain text (no buttons)
    if (userId.startsWith("whatsapp:")) {
      try {
        const { sendWhatsAppMessage } = await import("../twilio-whatsapp.service.js");
        await sendWhatsAppMessage(userId, message.replace(/<[^>]+>/g, ""));
        return true;
      } catch {
        return false;
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ─── Stage 1: Immediate Confirmation ───

export async function sendPurchaseConfirmation(
  userId: string,
  productName: string,
  price: number | null,
  currency: string,
  store: string,
  trackingCode?: string,
): Promise<void> {
  const lang = await getUserLang(userId);
  const curr = currency === "BRL" ? "R$" : "$";
  const priceStr = price ? ` por ${curr}${price.toFixed(2)}` : "";

  let msg: string;
  if (lang === "pt") {
    msg = `✅ Compra confirmada! ${productName}${priceStr} na ${store}. Vou ficar de olho no rastreamento pra você. 🐕`;
    if (trackingCode) msg += `\n📦 Código: ${trackingCode}`;
  } else {
    msg = `✅ Purchase confirmed! ${productName}${priceStr} at ${store}. I'll keep an eye on tracking for you. 🐕`;
    if (trackingCode) msg += `\n📦 Tracking: ${trackingCode}`;
  }

  await sendFollowUp(userId, msg);
}

// ─── Stage 2: Day 3 — Delivery Check ───

async function sendDay3FollowUp(purchase: PurchaseRow): Promise<boolean> {
  const lang = await getUserLang(purchase.user_id);
  const name = await getUserName(purchase.user_id);
  const product = purchase.product_name.substring(0, 50);
  const purchaseId = purchase.id;

  let msg: string;
  let buttons: { text: string; callback_data: string }[][];

  if (lang === "pt") {
    msg = `Oi ${name}! Seu ${product} já chegou?`;
    buttons = [
      [
        { text: "✅ Chegou", callback_data: `pfu:${purchaseId}:delivered` },
        { text: "⏳ Ainda não", callback_data: `pfu:${purchaseId}:waiting` },
        { text: "❌ Problema", callback_data: `pfu:${purchaseId}:problem` },
      ],
    ];
  } else {
    msg = `Hey ${name}! Has your ${product} arrived?`;
    buttons = [
      [
        { text: "✅ Arrived", callback_data: `pfu:${purchaseId}:delivered` },
        { text: "⏳ Not yet", callback_data: `pfu:${purchaseId}:waiting` },
        { text: "❌ Problem", callback_data: `pfu:${purchaseId}:problem` },
      ],
    ];
  }

  const sent = await sendFollowUp(purchase.user_id, msg, buttons);
  if (sent) {
    await prisma.$executeRaw`
      UPDATE purchase_history SET follow_up_status = 'sent_day3', follow_up_day3_at = NOW()
      WHERE id = ${purchaseId}
    `;
  }
  return sent;
}

// ─── Stage 3: Day 7 — Satisfaction ───

async function sendDay7FollowUp(purchase: PurchaseRow): Promise<boolean> {
  const lang = await getUserLang(purchase.user_id);
  const name = await getUserName(purchase.user_id);
  const product = purchase.product_name.substring(0, 50);
  const purchaseId = purchase.id;

  let msg: string;
  let buttons: { text: string; callback_data: string }[][];

  if (lang === "pt") {
    msg = `E aí, ${name}! O que achou do ${product}?`;
    buttons = [
      [
        { text: "⭐ Amei", callback_data: `pfu:${purchaseId}:loved` },
        { text: "😐 Ok", callback_data: `pfu:${purchaseId}:ok` },
        { text: "👎 Não gostei", callback_data: `pfu:${purchaseId}:disliked` },
      ],
    ];
  } else {
    msg = `Hey ${name}! What did you think of the ${product}?`;
    buttons = [
      [
        { text: "⭐ Loved it", callback_data: `pfu:${purchaseId}:loved` },
        { text: "😐 OK", callback_data: `pfu:${purchaseId}:ok` },
        { text: "👎 Didn't like", callback_data: `pfu:${purchaseId}:disliked` },
      ],
    ];
  }

  const sent = await sendFollowUp(purchase.user_id, msg, buttons);
  if (sent) {
    await prisma.$executeRaw`
      UPDATE purchase_history SET follow_up_status = 'sent_day7', follow_up_day7_at = NOW()
      WHERE id = ${purchaseId}
    `;
  }
  return sent;
}

// ─── Stage 4: Restock ───

async function sendRestockFollowUp(purchase: PurchaseRow): Promise<boolean> {
  const lang = await getUserLang(purchase.user_id);
  const name = await getUserName(purchase.user_id);
  const product = purchase.product_name.substring(0, 50);
  const purchaseId = purchase.id;
  const daysSince = Math.floor((Date.now() - new Date(purchase.purchased_at).getTime()) / 86_400_000);

  let msg: string;
  if (lang === "pt") {
    msg = `🔄 Faz ${daysSince} dias que você comprou ${product}. Hora de repor? Posso farejar o melhor preço! 🐕`;
  } else {
    msg = `🔄 It's been ${daysSince} days since you bought ${product}. Time to restock? I can sniff out the best price! 🐕`;
  }

  const buttons = [
    [
      { text: lang === "pt" ? "🔍 Buscar preço" : "🔍 Find price", callback_data: `pfu:${purchaseId}:restock_yes` },
      { text: lang === "pt" ? "❌ Não preciso" : "❌ Not now", callback_data: `pfu:${purchaseId}:restock_no` },
    ],
  ];

  const sent = await sendFollowUp(purchase.user_id, msg, buttons);
  if (sent) {
    await prisma.$executeRaw`
      UPDATE purchase_history SET follow_up_status = 'sent_restock', follow_up_restock_at = NOW()
      WHERE id = ${purchaseId}
    `;
  }
  return sent;
}

// ─── Callback Handlers (called from OpenClaw/API) ───

export async function handleFollowUpCallback(purchaseId: string, action: string, userId: string): Promise<{
  reply: string;
  nextAction?: string;
}> {
  const lang = await getUserLang(userId);

  switch (action) {
    case "delivered":
      await prisma.$executeRaw`
        UPDATE purchase_history SET delivery_confirmed_at = NOW(), follow_up_status = 'delivered'
        WHERE id = ${purchaseId}
      `;
      return {
        reply: lang === "pt"
          ? "Que bom que chegou! Daqui uns dias vou te perguntar o que achou. 😊"
          : "Glad it arrived! I'll check in with you soon to see how you like it. 😊",
      };

    case "waiting":
      return {
        reply: lang === "pt"
          ? "Tranquilo, vou continuar monitorando! Me avisa quando chegar."
          : "No worries, I'll keep monitoring! Let me know when it arrives.",
      };

    case "problem":
      return {
        reply: lang === "pt"
          ? "Sinto muito! Quer que eu te ajude a abrir uma reclamação? Posso buscar a política de devolução da loja."
          : "Sorry about that! Want me to help file a complaint? I can look up the store's return policy.",
        nextAction: "return_policy",
      };

    case "loved":
      await prisma.$executeRaw`
        UPDATE purchase_history SET satisfaction_score = 'loved', follow_up_status = 'completed'
        WHERE id = ${purchaseId}
      `;
      // Gamification points
      try {
        await fetch(`${PAYJARVIS_URL}/api/engagement/gamification/track`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-internal-secret": process.env.INTERNAL_SECRET || "" },
          body: JSON.stringify({ userId, type: "review", value: 50 }),
        }).catch(() => {});
      } catch { /* non-blocking */ }
      return {
        reply: lang === "pt"
          ? "Que bom! 🎉 Se quiser, posso buscar produtos similares ou complementares pra você."
          : "Awesome! 🎉 I can search for similar or complementary products if you'd like.",
      };

    case "ok":
      await prisma.$executeRaw`
        UPDATE purchase_history SET satisfaction_score = 'ok', follow_up_status = 'completed'
        WHERE id = ${purchaseId}
      `;
      return {
        reply: lang === "pt"
          ? "Entendi! Alguma coisa que poderia ser melhor?"
          : "Got it! Anything that could have been better?",
      };

    case "disliked":
      await prisma.$executeRaw`
        UPDATE purchase_history SET satisfaction_score = 'disliked', follow_up_status = 'completed'
        WHERE id = ${purchaseId}
      `;
      return {
        reply: lang === "pt"
          ? "Poxa! O que não curtiu? Posso te ajudar a devolver ou buscar uma alternativa melhor."
          : "Sorry to hear that! What didn't you like? I can help with a return or find a better alternative.",
      };

    case "restock_yes":
      await prisma.$executeRaw`
        UPDATE purchase_history SET follow_up_status = 'completed'
        WHERE id = ${purchaseId}
      `;
      // Get the product name for search
      const purchase = await prisma.$queryRaw<{ product_name: string }[]>`
        SELECT product_name FROM purchase_history WHERE id = ${purchaseId} LIMIT 1
      `;
      const productName = purchase[0]?.product_name || "";
      return {
        reply: lang === "pt"
          ? `🔍 Buscando o melhor preço pra ${productName}...`
          : `🔍 Finding the best price for ${productName}...`,
        nextAction: `search:${productName}`,
      };

    case "restock_no":
      await prisma.$executeRaw`
        UPDATE purchase_history SET follow_up_status = 'completed'
        WHERE id = ${purchaseId}
      `;
      return {
        reply: lang === "pt" ? "Beleza! Me avisa quando precisar. 🐕" : "Got it! Let me know when you need it. 🐕",
      };

    default:
      return { reply: "OK!" };
  }
}

// ─── Cron: Process all pending follow-ups ───

export async function runFollowUpCron(): Promise<{ day3: number; day7: number; restock: number }> {
  console.log("[FOLLOW-UP-CRON] Started");

  if (isQuietHours()) {
    console.log("[FOLLOW-UP-CRON] Quiet hours — skipping");
    return { day3: 0, day7: 0, restock: 0 };
  }

  let day3Sent = 0;
  let day7Sent = 0;
  let restockSent = 0;

  // Day 3: purchases 3+ days old, status = pending
  const day3Threshold = new Date(Date.now() - 3 * 86_400_000);
  const day3Purchases = await prisma.$queryRaw<PurchaseRow[]>`
    SELECT * FROM purchase_history
    WHERE follow_up_status = 'pending'
      AND purchased_at <= ${day3Threshold}
      AND purchased_at > ${new Date(Date.now() - 30 * 86_400_000)}
    ORDER BY purchased_at ASC LIMIT 20
  `;

  for (const p of day3Purchases) {
    try {
      const sent = await sendDay3FollowUp(p);
      if (sent) day3Sent++;
      await new Promise(r => setTimeout(r, 1000)); // rate limit
    } catch (err) {
      console.error(`[FOLLOW-UP-CRON] Day3 error for ${p.id}:`, (err as Error).message);
    }
  }

  // Day 7: purchases 7+ days old, status = sent_day3 or delivered
  const day7Threshold = new Date(Date.now() - 7 * 86_400_000);
  const day7Purchases = await prisma.$queryRaw<PurchaseRow[]>`
    SELECT * FROM purchase_history
    WHERE follow_up_status IN ('sent_day3', 'delivered')
      AND purchased_at <= ${day7Threshold}
      AND purchased_at > ${new Date(Date.now() - 60 * 86_400_000)}
    ORDER BY purchased_at ASC LIMIT 20
  `;

  for (const p of day7Purchases) {
    try {
      const sent = await sendDay7FollowUp(p);
      if (sent) day7Sent++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[FOLLOW-UP-CRON] Day7 error for ${p.id}:`, (err as Error).message);
    }
  }

  // Restock: completed purchases where category is consumable and enough time passed
  const restockPurchases = await prisma.$queryRaw<PurchaseRow[]>`
    SELECT * FROM purchase_history
    WHERE follow_up_status IN ('completed', 'sent_day7')
      AND follow_up_restock_at IS NULL
      AND purchased_at < ${new Date(Date.now() - 14 * 86_400_000)}
    ORDER BY purchased_at ASC LIMIT 20
  `;

  for (const p of restockPurchases) {
    const restockDays = p.reorder_cycle_days || getRestockDays(p.category, p.product_name);
    if (!restockDays) continue; // Not a consumable

    const daysSincePurchase = Math.floor((Date.now() - new Date(p.purchased_at).getTime()) / 86_400_000);
    if (daysSincePurchase < restockDays * 0.85) continue; // Not time yet (85% of cycle)

    try {
      const sent = await sendRestockFollowUp(p);
      if (sent) restockSent++;
      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`[FOLLOW-UP-CRON] Restock error for ${p.id}:`, (err as Error).message);
    }
  }

  console.log(`[FOLLOW-UP-CRON] Done: day3=${day3Sent}, day7=${day7Sent}, restock=${restockSent}`);
  return { day3: day3Sent, day7: day7Sent, restock: restockSent };
}

// ─── Metrics ───

export async function getFollowUpMetrics(days: number = 30) {
  const since = new Date(Date.now() - days * 86_400_000);

  const total = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM purchase_history WHERE purchased_at >= ${since}
  `;
  const delivered = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM purchase_history WHERE delivery_confirmed_at IS NOT NULL AND purchased_at >= ${since}
  `;
  const satisfied = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM purchase_history WHERE satisfaction_score = 'loved' AND purchased_at >= ${since}
  `;
  const neutral = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM purchase_history WHERE satisfaction_score = 'ok' AND purchased_at >= ${since}
  `;
  const unsatisfied = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM purchase_history WHERE satisfaction_score = 'disliked' AND purchased_at >= ${since}
  `;

  const t = Number(total[0]?.count ?? 0);
  const rated = Number(satisfied[0]?.count ?? 0) + Number(neutral[0]?.count ?? 0) + Number(unsatisfied[0]?.count ?? 0);

  return {
    totalPurchases: t,
    deliveryConfirmed: Number(delivered[0]?.count ?? 0),
    satisfactionBreakdown: {
      loved: Number(satisfied[0]?.count ?? 0),
      ok: Number(neutral[0]?.count ?? 0),
      disliked: Number(unsatisfied[0]?.count ?? 0),
    },
    responseRate: t > 0 ? Math.round((rated / t) * 100) : 0,
  };
}
