import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { BditIssuer } from "@payjarvis/bdit";
import { requireAuth, getKycLevel } from "../middleware/auth.js";
import {
  sendTelegramNotification,
  sendAdminTelegramNotification,
  answerCallbackQuery,
  editMessageText,
} from "../services/notifications.js";
import { sendEmail, isEmailConfigured } from "../services/email.js";
import { createAuditLog } from "../services/audit.js";
import { updateTrustScore } from "../services/trust-score.js";
import { emitApprovalEvent } from "./approvals.js";
import { emitHandoffEvent, emitBotHandoffEvent } from "./handoffs.js";
import { randomInt, randomUUID } from "node:crypto";

export async function notificationRoutes(app: FastifyInstance) {
  const issuer = new BditIssuer(
    (process.env.PAYJARVIS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    process.env.PAYJARVIS_KEY_ID ?? "payjarvis-key-001"
  );

  // Generate Telegram link code
  app.post("/api/notifications/telegram/link", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    // Delete any existing code
    await prisma.telegramLinkCode.deleteMany({ where: { userId: user.id } });

    const code = String(randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.telegramLinkCode.create({
      data: {
        userId: user.id,
        code,
        expiresAt,
      },
    });

    return {
      success: true,
      data: {
        code,
        instructions: `Send /link ${code} to @Jarvis12Brain_bot on Telegram. Code expires in 10 minutes.`,
      },
    };
  });

  // Disconnect Telegram
  app.delete("/api/notifications/telegram", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        telegramChatId: null,
        notificationChannel: "none",
      },
    });

    return { success: true, message: "Telegram disconnected" };
  });

  // Telegram webhook — called by Telegram Bot API
  app.post("/api/notifications/telegram/webhook", async (request, reply) => {
    // Validate Telegram webhook secret if configured
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const receivedSecret = request.headers["x-telegram-bot-api-secret-token"];
      if (receivedSecret !== expectedSecret) {
        return reply.status(403).send({ ok: false });
      }
    }

    const body = request.body as any;

    // ── Handle inline button callback queries ──
    if (body?.callback_query) {
      const cbq = body.callback_query;
      const callbackData = cbq.data as string | undefined;
      const callbackQueryId = cbq.id as string;
      const fromId = String(cbq.from.id);
      const chatId = cbq.message?.chat?.id;
      const messageId = cbq.message?.message_id;

      if (!callbackData) {
        await answerCallbackQuery(callbackQueryId, "Invalid data.");
        return reply.send({ ok: true });
      }

      // ── Handle handoff callbacks ──
      const handoffMatch = callbackData.match(/^(handoff_done|handoff_cancel):(.+)$/);
      if (handoffMatch) {
        const [, handoffAction, handoffId] = handoffMatch;

        try {
          const user = await prisma.user.findFirst({
            where: { telegramChatId: fromId },
          });
          if (!user) {
            await answerCallbackQuery(callbackQueryId, "Account not linked.");
            return reply.send({ ok: true });
          }

          const handoff = await prisma.handoffRequest.findFirst({
            where: { id: handoffId, ownerId: user.id },
          });

          if (!handoff) {
            await answerCallbackQuery(callbackQueryId, "Handoff not found.");
            return reply.send({ ok: true });
          }

          if (handoff.status === "RESOLVED" || handoff.status === "CANCELLED" || handoff.status === "EXPIRED") {
            await answerCallbackQuery(callbackQueryId, `Already resolved: ${handoff.status}`);
            return reply.send({ ok: true });
          }

          if (handoffAction === "handoff_done") {
            await prisma.handoffRequest.update({
              where: { id: handoffId },
              data: { status: "RESOLVED", resolvedAt: new Date(), resolvedNote: "Resolved via Telegram" },
            });

            await createAuditLog({
              entityType: "handoff",
              entityId: handoffId,
              action: "handoff.resolved",
              actorType: "user",
              actorId: user.id,
              payload: { channel: "telegram" },
            });

            emitHandoffEvent(user.id, "handoff_resolved", { id: handoffId, status: "RESOLVED" });
            emitBotHandoffEvent(handoff.botId, "handoff_resolved", {
              id: handoffId,
              status: "RESOLVED",
              resolvedNote: "Resolved via Telegram",
            });

            await answerCallbackQuery(callbackQueryId, "✅ Handoff completed!");
            if (chatId && messageId) {
              await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n✅ <b>COMPLETED</b>`);
            }
          } else {
            // handoff_cancel
            await prisma.handoffRequest.update({
              where: { id: handoffId },
              data: { status: "CANCELLED" },
            });

            await createAuditLog({
              entityType: "handoff",
              entityId: handoffId,
              action: "handoff.cancelled",
              actorType: "user",
              actorId: user.id,
              payload: { channel: "telegram" },
            });

            emitHandoffEvent(user.id, "handoff_cancelled", { id: handoffId, status: "CANCELLED" });
            emitBotHandoffEvent(handoff.botId, "handoff_resolved", {
              id: handoffId,
              status: "CANCELLED",
            });

            await answerCallbackQuery(callbackQueryId, "❌ Handoff cancelado.");
            if (chatId && messageId) {
              await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n❌ <b>CANCELADO</b>`);
            }
          }
        } catch (err) {
          console.error("[Telegram Callback] Error processing handoff:", err);
          await answerCallbackQuery(callbackQueryId, "Erro ao processar. Tente pelo dashboard.");
        }

        return reply.send({ ok: true });
      }

      // ── Handle approval callbacks ──
      const match = callbackData.match(/^(approve|reject):(.+)$/);
      if (!match) {
        await answerCallbackQuery(callbackQueryId, "Unrecognized action.");
        return reply.send({ ok: true });
      }

      const [, action, approvalId] = match;

      try {
        // Find user by telegram chat id
        const user = await prisma.user.findFirst({
          where: { telegramChatId: fromId },
        });
        if (!user) {
          await answerCallbackQuery(callbackQueryId, "Account not linked.");
          return reply.send({ ok: true });
        }

        // Find approval and verify ownership
        const approval = await prisma.approvalRequest.findFirst({
          where: { id: approvalId, ownerId: user.id },
          include: { transaction: true, bot: { include: { policy: true, owner: true } } },
        });

        if (!approval) {
          await answerCallbackQuery(callbackQueryId, "Approval not found.");
          return reply.send({ ok: true });
        }

        if (approval.status !== "PENDING") {
          await answerCallbackQuery(callbackQueryId, `Already responded: ${approval.status}`);
          if (chatId && messageId) {
            await editMessageText(
              chatId,
              messageId,
              `${cbq.message.text ?? ""}\n\n⚠️ Already responded: <b>${approval.status}</b>`
            );
          }
          return reply.send({ ok: true });
        }

        // Check expiration
        if (new Date() > approval.expiresAt) {
          await prisma.approvalRequest.update({
            where: { id: approvalId },
            data: { status: "EXPIRED" },
          });
          await prisma.transaction.update({
            where: { id: approval.transactionId },
            data: { decision: "BLOCKED", decisionReason: "Approval expired" },
          });
          await prisma.bot.update({
            where: { id: approval.botId },
            data: { totalBlocked: { increment: 1 } },
          });
          await updateTrustScore(approval.botId, "BLOCKED", "approval_timeout", false, "system");
          emitApprovalEvent(user.id, "approval_expired", { id: approvalId, status: "EXPIRED" });

          await answerCallbackQuery(callbackQueryId, "Approval expired.");
          if (chatId && messageId) {
            await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n⏰ <b>Expirado</b>`);
          }
          return reply.send({ ok: true });
        }

        // ── Process approval ──
        if (action === "approve") {
          await prisma.approvalRequest.update({
            where: { id: approvalId },
            data: { status: "APPROVED", respondedAt: new Date() },
          });

          const policy = approval.bot.policy!;
          const kycLevelNum = getKycLevel(approval.bot.owner.kycLevel);

          const { token, jti, expiresAt } = await issuer.issue({
            botId: approval.botId,
            ownerId: user.id,
            trustScore: approval.bot.trustScore,
            kycLevel: kycLevelNum,
            categories: policy.allowedCategories,
            maxAmount: policy.maxPerTransaction,
            merchantId: approval.transaction.merchantId ?? "",
            amount: approval.amount,
            category: approval.category,
            sessionId: randomUUID(),
          });

          await prisma.bditToken.create({
            data: {
              jti,
              tokenValue: token,
              botId: approval.botId,
              amount: approval.amount,
              category: approval.category,
              expiresAt,
            },
          });

          await prisma.transaction.update({
            where: { id: approval.transactionId },
            data: {
              decision: "APPROVED",
              approvedByHuman: true,
              bdtJti: jti,
              decisionReason: "Approved via Telegram",
            },
          });

          await prisma.bot.update({
            where: { id: approval.botId },
            data: { totalApproved: { increment: 1 } },
          });

          await updateTrustScore(approval.botId, "APPROVED", null, true, user.id);

          await createAuditLog({
            entityType: "approval",
            entityId: approvalId,
            action: "approval.responded",
            actorType: "user",
            actorId: user.id,
            payload: {
              action: "approved",
              transactionId: approval.transactionId,
              amount: approval.amount,
              channel: "telegram",
            },
          });

          await createAuditLog({
            entityType: "bdit",
            entityId: jti,
            action: "bdit.issued",
            actorType: "system",
            actorId: approval.botId,
            payload: { botId: approval.botId, amount: approval.amount, humanApproved: true },
          });

          emitApprovalEvent(user.id, "approval_responded", {
            id: approvalId,
            status: "APPROVED",
            transactionId: approval.transactionId,
          });

          await answerCallbackQuery(callbackQueryId, "✅ Aprovado!");
          if (chatId && messageId) {
            await editMessageText(
              chatId,
              messageId,
              `${cbq.message.text ?? ""}\n\n✅ <b>APROVADO</b>`
            );
          }
        } else {
          // Reject
          await prisma.approvalRequest.update({
            where: { id: approvalId },
            data: { status: "REJECTED", respondedAt: new Date() },
          });

          await prisma.transaction.update({
            where: { id: approval.transactionId },
            data: {
              decision: "BLOCKED",
              decisionReason: "Rejected via Telegram",
            },
          });

          await prisma.bot.update({
            where: { id: approval.botId },
            data: { totalBlocked: { increment: 1 } },
          });

          await updateTrustScore(approval.botId, "BLOCKED", null, false, user.id);

          await createAuditLog({
            entityType: "approval",
            entityId: approvalId,
            action: "approval.responded",
            actorType: "user",
            actorId: user.id,
            payload: {
              action: "rejected",
              transactionId: approval.transactionId,
              channel: "telegram",
            },
          });

          emitApprovalEvent(user.id, "approval_responded", {
            id: approvalId,
            status: "REJECTED",
            transactionId: approval.transactionId,
          });

          await answerCallbackQuery(callbackQueryId, "❌ Rejeitado.");
          if (chatId && messageId) {
            await editMessageText(
              chatId,
              messageId,
              `${cbq.message.text ?? ""}\n\n❌ <b>REJEITADO</b>`
            );
          }
        }
      } catch (err) {
        console.error("[Telegram Callback] Error processing approval:", err);
        await answerCallbackQuery(callbackQueryId, "Erro ao processar. Tente pelo dashboard.");
      }

      return reply.send({ ok: true });
    }

    // ── Handle regular text messages ──
    const message = body?.message;
    if (!message?.text) return reply.send({ ok: true });

    const chatId = String(message.chat.id);
    const text = (message.text as string).trim();

    // Handle /start command
    if (text === "/start") {
      await sendTelegramNotification(chatId,
        "PayJarvis Bot active.\n\nTo link your account, use:\n<code>/link YOUR_CODE</code>\n\nGenerate the code in your dashboard under Settings > Notifications."
      );
      return reply.send({ ok: true });
    }

    // Handle /link CODE command
    // Handle /link CODE command
    const linkMatch = text.match(/^\/link\s+(\d{6})$/);
    if (!linkMatch) {
      // Text messages are handled by OpenClaw (polling). PayJarvis only handles callbacks.
      return reply.send({ ok: true });
    }

    const code = linkMatch[1];
    const linkCode = await prisma.telegramLinkCode.findUnique({ where: { code } });

    if (!linkCode || linkCode.expiresAt < new Date()) {
      await sendTelegramNotification(chatId, "❌ Invalid or expired code. Generate a new code in your dashboard.");
      if (linkCode) await prisma.telegramLinkCode.delete({ where: { id: linkCode.id } });
      return reply.send({ ok: true });
    }

    // Link the account
    await prisma.user.update({
      where: { id: linkCode.userId },
      data: {
        telegramChatId: chatId,
        notificationChannel: "telegram",
      },
    });

    // Clean up
    await prisma.telegramLinkCode.delete({ where: { id: linkCode.id } });

    await sendTelegramNotification(
      chatId,
      "✅ Account linked! You will receive approval notifications here."
    );

    return reply.send({ ok: true });
  });

  // ── Email endpoint ──
  app.post("/api/notifications/email", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = (request as any).userId as string;
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    if (!isEmailConfigured()) {
      return reply.status(503).send({ success: false, error: "Email service not configured" });
    }

    const { to, subject, html, text } = request.body as {
      to?: string;
      subject: string;
      html: string;
      text?: string;
    };

    if (!subject || !html) {
      return reply.status(400).send({ success: false, error: "subject and html are required" });
    }

    const recipient = to || user.email;
    if (!recipient) {
      return reply.status(400).send({ success: false, error: "No recipient email" });
    }

    const result = await sendEmail({ to: recipient, subject, html, text });

    await createAuditLog({
      entityType: "notification",
      entityId: result.messageId ?? "unknown",
      action: "email.sent",
      actorType: "user",
      actorId: user.id,
      payload: { to: recipient, subject, success: result.success },
    });

    return result;
  });

  // ── Email status endpoint ──
  app.get("/api/notifications/email/status", { preHandler: [requireAuth] }, async () => {
    return {
      configured: isEmailConfigured(),
      sender: process.env.ZOHO_EMAIL ?? null,
    };
  });

  // Admin bot webhook — called by @Jarvis12Brain_bot for approval callbacks
  app.post("/api/notifications/telegram/admin-webhook", async (request, reply) => {
    const body = request.body as any;
    const adminToken = process.env.ADMIN_TELEGRAM_BOT_TOKEN;
    if (!adminToken) return reply.status(500).send({ ok: false, error: "Admin bot not configured" });

    // Only handle callback queries (approve/reject buttons)
    if (!body?.callback_query) return reply.send({ ok: true });

    const cbq = body.callback_query;
    const callbackData = cbq.data as string | undefined;
    const callbackQueryId = cbq.id as string;
    const fromId = String(cbq.from.id);
    const chatId = cbq.message?.chat?.id;
    const messageId = cbq.message?.message_id;

    if (!callbackData) {
      await answerCallbackQuery(callbackQueryId, "Invalid data.", adminToken);
      return reply.send({ ok: true });
    }

    // Only process approval callbacks
    const match = callbackData.match(/^(approve|reject):(.+)$/);
    if (!match) {
      await answerCallbackQuery(callbackQueryId, "Unrecognized action.", adminToken);
      return reply.send({ ok: true });
    }

    const [, action, approvalId] = match;

    // Verify the callback comes from admin chat
    const adminChatId = process.env.ADMIN_TELEGRAM_CHAT_ID;
    if (adminChatId && fromId !== adminChatId) {
      await answerCallbackQuery(callbackQueryId, "Permission denied.", adminToken);
      return reply.send({ ok: true });
    }

    try {
      const approval = await prisma.approvalRequest.findFirst({
        where: { id: approvalId },
        include: { transaction: true, bot: { include: { policy: true, owner: true } } },
      });

      if (!approval) {
        await answerCallbackQuery(callbackQueryId, "Approval not found.", adminToken);
        return reply.send({ ok: true });
      }

      if (approval.status !== "PENDING") {
        await answerCallbackQuery(callbackQueryId, `Already responded: ${approval.status}`, adminToken);
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n⚠️ Already responded: <b>${approval.status}</b>`, adminToken);
        }
        return reply.send({ ok: true });
      }

      if (new Date() > approval.expiresAt) {
        await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: "EXPIRED" } });
        await prisma.transaction.update({ where: { id: approval.transactionId }, data: { decision: "BLOCKED", decisionReason: "Approval expired" } });
        await prisma.bot.update({ where: { id: approval.botId }, data: { totalBlocked: { increment: 1 } } });
        await updateTrustScore(approval.botId, "BLOCKED", "approval_timeout", false, "system");
        emitApprovalEvent(approval.ownerId, "approval_expired", { id: approvalId, status: "EXPIRED" });
        await answerCallbackQuery(callbackQueryId, "Approval expired.", adminToken);
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n⏰ <b>Expirado</b>`, adminToken);
        }
        return reply.send({ ok: true });
      }

      if (action === "approve") {
        await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: "APPROVED", respondedAt: new Date() } });

        const policy = approval.bot.policy!;
        const kycLevelNum = getKycLevel(approval.bot.owner.kycLevel);

        const { token, jti, expiresAt } = await issuer.issue({
          botId: approval.botId,
          ownerId: approval.ownerId,
          trustScore: approval.bot.trustScore,
          kycLevel: kycLevelNum,
          categories: policy.allowedCategories,
          maxAmount: policy.maxPerTransaction,
          merchantId: approval.transaction.merchantId ?? "",
          amount: approval.amount,
          category: approval.category,
          sessionId: randomUUID(),
        });

        await prisma.bditToken.create({ data: { jti, tokenValue: token, botId: approval.botId, amount: approval.amount, category: approval.category, expiresAt } });
        await prisma.transaction.update({ where: { id: approval.transactionId }, data: { decision: "APPROVED", approvedByHuman: true, bdtJti: jti, decisionReason: "Approved via Admin Telegram" } });
        await prisma.bot.update({ where: { id: approval.botId }, data: { totalApproved: { increment: 1 } } });
        await updateTrustScore(approval.botId, "APPROVED", null, true, approval.ownerId);

        await createAuditLog({ entityType: "approval", entityId: approvalId, action: "approval.responded", actorType: "user", actorId: approval.ownerId, payload: { action: "approved", transactionId: approval.transactionId, amount: approval.amount, channel: "admin_telegram" } });
        await createAuditLog({ entityType: "bdit", entityId: jti, action: "bdit.issued", actorType: "system", actorId: approval.botId, payload: { botId: approval.botId, amount: approval.amount, humanApproved: true } });
        emitApprovalEvent(approval.ownerId, "approval_responded", { id: approvalId, status: "APPROVED", transactionId: approval.transactionId });

        await answerCallbackQuery(callbackQueryId, "✅ Aprovado!", adminToken);
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n✅ <b>APROVADO</b>`, adminToken);
        }
      } else {
        await prisma.approvalRequest.update({ where: { id: approvalId }, data: { status: "REJECTED", respondedAt: new Date() } });
        await prisma.transaction.update({ where: { id: approval.transactionId }, data: { decision: "BLOCKED", decisionReason: "Rejected via Admin Telegram" } });
        await prisma.bot.update({ where: { id: approval.botId }, data: { totalBlocked: { increment: 1 } } });
        await updateTrustScore(approval.botId, "BLOCKED", null, false, approval.ownerId);

        await createAuditLog({ entityType: "approval", entityId: approvalId, action: "approval.responded", actorType: "user", actorId: approval.ownerId, payload: { action: "rejected", transactionId: approval.transactionId, channel: "admin_telegram" } });
        emitApprovalEvent(approval.ownerId, "approval_responded", { id: approvalId, status: "REJECTED", transactionId: approval.transactionId });

        await answerCallbackQuery(callbackQueryId, "❌ Rejeitado.", adminToken);
        if (chatId && messageId) {
          await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n❌ <b>REJEITADO</b>`, adminToken);
        }
      }
    } catch (err) {
      console.error("[Admin Telegram Callback] Error processing approval:", err);
      await answerCallbackQuery(callbackQueryId, "Erro ao processar. Tente pelo dashboard.", adminToken);
    }

    return reply.send({ ok: true });
  });
}
