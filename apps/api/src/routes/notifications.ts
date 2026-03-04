import type { FastifyInstance } from "fastify";
import { prisma } from "@payjarvis/database";
import { BditIssuer } from "@payjarvis/bdit";
import { requireAuth, getKycLevel } from "../middleware/auth.js";
import {
  sendTelegramNotification,
  answerCallbackQuery,
  editMessageText,
} from "../services/notifications.js";
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
  app.post("/notifications/telegram/link", { preHandler: [requireAuth] }, async (request, reply) => {
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
        instructions: `Envie /link ${code} para o bot @PayJarvisBot no Telegram. O código expira em 10 minutos.`,
      },
    };
  });

  // Disconnect Telegram
  app.delete("/notifications/telegram", { preHandler: [requireAuth] }, async (request, reply) => {
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
  app.post("/notifications/telegram/webhook", async (request, reply) => {
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
        await answerCallbackQuery(callbackQueryId, "Dados inválidos.");
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
            await answerCallbackQuery(callbackQueryId, "Conta não vinculada.");
            return reply.send({ ok: true });
          }

          const handoff = await prisma.handoffRequest.findFirst({
            where: { id: handoffId, ownerId: user.id },
          });

          if (!handoff) {
            await answerCallbackQuery(callbackQueryId, "Handoff não encontrado.");
            return reply.send({ ok: true });
          }

          if (handoff.status === "RESOLVED" || handoff.status === "CANCELLED" || handoff.status === "EXPIRED") {
            await answerCallbackQuery(callbackQueryId, `Já finalizado: ${handoff.status}`);
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

            await answerCallbackQuery(callbackQueryId, "✅ Handoff concluído!");
            if (chatId && messageId) {
              await editMessageText(chatId, messageId, `${cbq.message.text ?? ""}\n\n✅ <b>CONCLUÍDO</b>`);
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
        await answerCallbackQuery(callbackQueryId, "Ação não reconhecida.");
        return reply.send({ ok: true });
      }

      const [, action, approvalId] = match;

      try {
        // Find user by telegram chat id
        const user = await prisma.user.findFirst({
          where: { telegramChatId: fromId },
        });
        if (!user) {
          await answerCallbackQuery(callbackQueryId, "Conta não vinculada.");
          return reply.send({ ok: true });
        }

        // Find approval and verify ownership
        const approval = await prisma.approvalRequest.findFirst({
          where: { id: approvalId, ownerId: user.id },
          include: { transaction: true, bot: { include: { policy: true, owner: true } } },
        });

        if (!approval) {
          await answerCallbackQuery(callbackQueryId, "Aprovação não encontrada.");
          return reply.send({ ok: true });
        }

        if (approval.status !== "PENDING") {
          await answerCallbackQuery(callbackQueryId, `Já respondido: ${approval.status}`);
          if (chatId && messageId) {
            await editMessageText(
              chatId,
              messageId,
              `${cbq.message.text ?? ""}\n\n⚠️ Já respondido: <b>${approval.status}</b>`
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

          await answerCallbackQuery(callbackQueryId, "Aprovação expirada.");
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
        "PayJarvis Bot ativo.\n\nPara vincular sua conta, use:\n<code>/link SEU_CODIGO</code>\n\nGere o código no dashboard em Configurações > Notificações."
      );
      return reply.send({ ok: true });
    }

    // Handle /link CODE command
    const linkMatch = text.match(/^\/link\s+(\d{6})$/);
    if (!linkMatch) {
      await sendTelegramNotification(chatId, "Comando não reconhecido. Use /link CÓDIGO para vincular sua conta.");
      return reply.send({ ok: true });
    }

    const code = linkMatch[1];
    const linkCode = await prisma.telegramLinkCode.findUnique({ where: { code } });

    if (!linkCode || linkCode.expiresAt < new Date()) {
      await sendTelegramNotification(chatId, "❌ Código inválido ou expirado. Gere um novo código no dashboard.");
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
      "✅ Conta vinculada! Você receberá notificações de aprovação aqui."
    );

    return reply.send({ ok: true });
  });
}
