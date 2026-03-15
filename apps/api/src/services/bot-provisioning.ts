/**
 * Bot Provisioning — Activates JARVIS for a user via Telegram
 *
 * Links Clerk user → Telegram ID → OpenClaw activation
 */

import { prisma } from "@payjarvis/database";

const OPENCLAW_ACTIVATION_URL =
  process.env.OPENCLAW_ACTIVATION_URL ?? "http://localhost:4001";

export interface ActivateParams {
  userId: string; // Clerk userId
  telegramUsername?: string;
  telegramId?: string;
  approvalThreshold?: number;
}

export async function activateUserBot(params: ActivateParams) {
  const { userId, telegramUsername, approvalThreshold = 50 } = params;
  let telegramChatId = params.telegramId;

  // Resolve @username → numeric ID via Telegram Bot API
  if (telegramUsername && !telegramChatId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured on server");

    const username = telegramUsername.replace(/^@/, "");
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: `@${username}` }),
    });
    const data = (await res.json()) as { ok: boolean; result?: { id: number }; description?: string };
    if (!data.ok) {
      throw new Error(
        `Telegram username @${username} not found. Make sure the user has started the bot first.`
      );
    }
    telegramChatId = String(data.result!.id);
  }

  if (!telegramChatId) {
    throw new Error("telegramId or telegramUsername is required");
  }

  // Update user record with Telegram link + threshold
  const user = await prisma.user.update({
    where: { clerkId: userId },
    data: {
      telegramChatId,
      approvalThreshold,
      onboardingCompleted: true,
      botActivatedAt: new Date(),
      onboardingStep: 4, // marks onboarding as complete
      status: "ACTIVE",
    },
  });

  // Call OpenClaw activation endpoint to send welcome message
  try {
    const openClawRes = await fetch(`${OPENCLAW_ACTIVATION_URL}/activate-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telegramId: telegramChatId,
        name: user.fullName || "amigo",
        approvalThreshold,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!openClawRes.ok) {
      const err = await openClawRes.text();
      console.error("[BOT-PROVISIONING] OpenClaw activation failed:", err);
      // Don't throw — user is saved, just warn
    }
  } catch (err) {
    console.error("[BOT-PROVISIONING] OpenClaw unreachable:", err);
    // Non-fatal: user record is saved, bot will greet on first message
  }

  return { success: true, telegramChatId };
}
