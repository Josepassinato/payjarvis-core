/**
 * Onboarding Bot Service — Conversational onboarding via Telegram/WhatsApp
 *
 * Manages the state machine for zero-friction onboarding:
 * start → name → email → email_confirm → limits → payment → complete
 */

import { prisma } from "@payjarvis/database";
import { randomBytes, createHash } from "crypto";
import { sendOnboardingConfirmation } from "./email.js";
import { StripeProvider } from "./payments/providers/stripe.provider.js";
import { getPaymentProvider } from "./payments/payment-factory.js";
import { initCredits } from "./credit.service.js";
import { initSequence } from "./sequence.service.js";

export interface BotResponse {
  message: string;
  step: string;
  complete: boolean;
}

/**
 * Generate a 6-digit numeric code for email confirmation.
 */
function generateEmailCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}

/**
 * Get the sharedBy name from a share code.
 */
async function getSharedByName(shareCode: string): Promise<string | null> {
  const link = await prisma.botShareLink.findUnique({
    where: { code: shareCode },
    select: { templateConfig: true },
  });
  if (!link) return null;
  const config = link.templateConfig as Record<string, unknown>;
  return (config.sharedByName as string) ?? null;
}

/**
 * Start a new onboarding session.
 */
export async function startOnboarding(
  chatId: string,
  platform: "telegram" | "whatsapp",
  shareCode?: string
): Promise<{ sessionId: string; message: string }> {
  // Check for existing active session
  const existing = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (existing && existing.step !== "complete" && existing.expiresAt > new Date()) {
    // Resume existing session
    const response = await getStepMessage(existing.step, existing);
    return { sessionId: existing.id, message: response };
  }

  // Delete expired session if exists
  if (existing) {
    await prisma.onboardingSession.delete({ where: { id: existing.id } });
  }

  let sharedByName: string | null = null;
  if (shareCode) {
    sharedByName = await getSharedByName(shareCode);
  }

  const session = await prisma.onboardingSession.create({
    data: {
      telegramChatId: platform === "telegram" ? chatId : null,
      whatsappPhone: platform === "whatsapp" ? chatId : null,
      shareCode: shareCode ?? null,
      step: "name",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
    },
  });

  const greeting = sharedByName
    ? `Oi! 👋 ${sharedByName} me compartilhou com você.\n\nSou o Jarvis, seu assistente de compras inteligente. Vou te configurar em menos de 2 minutos!\n\nQual é o seu nome?`
    : `Oi! 👋 Sou o Jarvis, seu assistente de compras inteligente.\n\nVou te configurar em menos de 2 minutos!\n\nQual é o seu nome?`;

  return { sessionId: session.id, message: greeting };
}

/**
 * Process user input at the current step.
 */
export async function processStep(
  chatId: string,
  platform: string,
  userInput: string
): Promise<BotResponse> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session || session.step === "complete") {
    return { message: "Nenhuma sessão de onboarding ativa.", step: "none", complete: false };
  }

  if (session.expiresAt < new Date()) {
    await prisma.onboardingSession.delete({ where: { id: session.id } });
    return { message: "Sessão expirada. Inicie novamente com /start.", step: "expired", complete: false };
  }

  switch (session.step) {
    case "name":
      return handleNameStep(session.id, userInput);
    case "email":
      return handleEmailStep(session.id, userInput);
    case "email_confirm":
      return handleEmailConfirmStep(session.id, userInput);
    case "limits":
      return handleLimitsStep(session.id, userInput);
    case "payment":
      return handlePaymentStep(session.id, userInput);
    default:
      return { message: "Estado inesperado. Tente /start novamente.", step: session.step, complete: false };
  }
}

/**
 * Step: name — collect user's name.
 */
async function handleNameStep(sessionId: string, input: string): Promise<BotResponse> {
  const name = input.trim();

  if (name.length < 2) {
    return {
      message: "Nome muito curto. Qual é o seu nome?",
      step: "name",
      complete: false,
    };
  }

  if (name.length > 100) {
    return {
      message: "Nome muito longo. Qual é o seu nome?",
      step: "name",
      complete: false,
    };
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { fullName: name, step: "email" },
  });

  return {
    message: `Prazer, ${name}! 😊\n\nQual é o seu email?`,
    step: "email",
    complete: false,
  };
}

/**
 * Step: email — validate and send confirmation code.
 */
async function handleEmailStep(sessionId: string, input: string): Promise<BotResponse> {
  const email = input.trim().toLowerCase();

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      message: "Hmm, esse email não parece válido. Tenta de novo:\n\nExemplo: maria@gmail.com",
      step: "email",
      complete: false,
    };
  }

  const code = generateEmailCode();

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { email, emailToken: code, step: "email_confirm" },
  });

  // Send confirmation email (fire-and-forget logging)
  sendOnboardingConfirmation(email, code).catch((err: unknown) => {
    console.error("[Onboarding] Failed to send confirmation email:", err);
  });

  return {
    message: `Perfeito! Enviei um código de 6 dígitos para ${email}.\n\nDigita o código aqui:`,
    step: "email_confirm",
    complete: false,
  };
}

/**
 * Step: email_confirm — verify 6-digit code.
 */
async function handleEmailConfirmStep(sessionId: string, input: string): Promise<BotResponse> {
  const code = input.trim();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Sessão não encontrada.", step: "error", complete: false };

  if (code !== session.emailToken) {
    return {
      message: "Código incorreto. Verifica seu email e tenta de novo.\n\nDigita o código de 6 dígitos:",
      step: "email_confirm",
      complete: false,
    };
  }

  // Create user + bot + policy
  const { userId, botId } = await createUserAndBot(session);

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "limits", userId, botId },
  });

  return {
    message: "✅ Email confirmado!\n\nAgora vamos definir seus limites de compra.\n\nQual o valor máximo por compra?\n\n💰 $20\n💰 $50\n💰 $100\n✏️ Outro valor (digita o número)",
    step: "limits",
    complete: false,
  };
}

/**
 * Step: limits — set spending limit.
 */
async function handleLimitsStep(sessionId: string, input: string): Promise<BotResponse> {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const value = parseFloat(cleaned);

  if (isNaN(value) || value <= 0 || value > 10000) {
    return {
      message: "Valor inválido. Escolhe um número entre 1 e 10000:\n\n💰 $20\n💰 $50\n💰 $100\n✏️ Ou digita o valor",
      step: "limits",
      complete: false,
    };
  }

  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.botId) return { message: "Erro interno.", step: "error", complete: false };

  // Update policy
  const autoApprove = Math.floor(value * 0.5);
  await prisma.policy.updateMany({
    where: { botId: session.botId },
    data: {
      maxPerTransaction: value,
      autoApproveLimit: autoApprove,
    },
  });

  // Generate Stripe payment link
  let paymentMessage = "";
  try {
    const link = await generateStripeSetupLink(session.userId!, sessionId);
    paymentMessage = `\n\nÚltimo passo — adicionar sua forma de pagamento.\n\nClica no link abaixo para adicionar seu cartão (leva 30 segundos):\n\n👉 ${link}\n\nMe avisa quando terminar ou digita "pronto"`;
  } catch {
    paymentMessage = "\n\nÚltimo passo — adicionar forma de pagamento.\n\nVocê pode configurar isso depois no dashboard.\n\nDigita \"pular\" para finalizar ou \"pronto\" quando adicionar.";
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { limitsSet: true, step: "payment" },
  });

  return {
    message: `Ótimo! Limite de $${value.toFixed(0)} por compra definido.${paymentMessage}`,
    step: "payment",
    complete: false,
  };
}

/**
 * Step: payment — wait for Stripe confirmation or skip.
 */
async function handlePaymentStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();

  if (lower === "pular" || lower === "skip") {
    return completeOnboarding(sessionId);
  }

  // Check if Stripe payment was already set up via webhook
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Sessão não encontrada.", step: "error", complete: false };

  if (session.paymentSetup) {
    return completeOnboarding(sessionId);
  }

  // User said "pronto" or similar
  if (lower === "pronto" || lower === "done" || lower === "ok" || lower === "✅") {
    // Check Stripe setup intent status
    if (session.stripeSetupIntent) {
      try {
        const provider = getPaymentProvider("stripe") as StripeProvider;
        const { paymentMethodId } = await provider.getSetupIntentPaymentMethod(session.stripeSetupIntent);
        if (paymentMethodId) {
          await prisma.onboardingSession.update({
            where: { id: sessionId },
            data: { paymentSetup: true },
          });
          return completeOnboarding(sessionId);
        }
      } catch {
        // Setup intent not completed yet
      }
    }

    return {
      message: "Ainda não detectei o pagamento. Tenta clicar no link acima e adicionar o cartão.\n\nOu digita \"pular\" para configurar depois.",
      step: "payment",
      complete: false,
    };
  }

  return {
    message: "Clica no link acima para adicionar seu cartão.\n\nDigita \"pronto\" quando terminar ou \"pular\" para fazer depois.",
    step: "payment",
    complete: false,
  };
}

/**
 * Complete the onboarding session.
 */
export async function completeOnboarding(sessionId: string): Promise<BotResponse> {
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Sessão não encontrada.", step: "error", complete: false };

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "complete" },
  });

  // Mark user onboarding as completed
  if (session.userId) {
    await prisma.user.update({
      where: { id: session.userId },
      data: { onboardingCompleted: true, onboardingStep: 5 },
    });
  }

  // Initialize credits + onboarding sequence
  if (session.userId) {
    const platform = session.telegramChatId ? "telegram" : "whatsapp";
    const chatId = session.telegramChatId ?? session.whatsappPhone ?? "";
    const referrerName = session.shareCode ? await getSharedByName(session.shareCode) : null;

    initCredits(session.userId, session.shareCode ?? undefined).catch((err) => {
      console.error("[Onboarding] initCredits error:", (err as Error).message);
    });

    if (chatId) {
      initSequence(session.userId, platform, chatId, referrerName ?? undefined).catch((err) => {
        console.error("[Onboarding] initSequence error:", (err as Error).message);
      });
    }
  }

  // Notify referrer
  if (session.shareCode) {
    notifyReferrer(session.shareCode, session.fullName ?? session.email ?? "Alguém").catch(() => {});
  }

  const paymentNote = session.paymentSetup
    ? ""
    : "\n\n⚠️ Lembre-se de adicionar um cartão de pagamento no dashboard para fazer compras.";

  return {
    message: `✅ Tudo configurado!\n\nAgora você pode me pedir qualquer compra:\n\n🛒 "Compra cabo USB até $20"\n🛒 "Encontra shampoo barato"\n🛒 "Quero tênis Nike tamanho 42"\n\nO que você quer comprar?${paymentNote}`,
    step: "complete",
    complete: true,
  };
}

/**
 * Generate Stripe Setup Intent link.
 */
export async function generateStripeSetupLink(userId: string, sessionId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const provider = getPaymentProvider("stripe") as StripeProvider;
  if (!provider.isAvailable) throw new Error("Stripe not configured");

  const customerId = await provider.getOrCreateCustomer({
    userId: user.id,
    email: user.email,
    name: user.fullName ?? undefined,
    existingCustomerId: user.stripeCustomerId,
  });

  if (customerId !== user.stripeCustomerId) {
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const result = await provider.createSetupIntent({
    customerId,
    userId: user.id,
    metadata: { onboardingSessionId: sessionId },
  });

  const baseUrl = process.env.WEB_URL || "https://www.payjarvis.com";
  const link = `${baseUrl}/setup-payment?intent=${result.setupIntentId}&session=${sessionId}&secret=${result.clientSecret}`;

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: {
      stripeSetupIntent: result.setupIntentId,
      stripePaymentLink: link,
    },
  });

  return link;
}

/**
 * Check if a chatId has an active onboarding session.
 */
export async function hasActiveSession(chatId: string, platform: string): Promise<boolean> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session) return false;
  return session.step !== "complete" && session.expiresAt > new Date();
}

/**
 * Create user and bot during onboarding.
 */
async function createUserAndBot(session: {
  id: string;
  email: string | null;
  fullName: string | null;
  shareCode: string | null;
  telegramChatId: string | null;
  whatsappPhone: string | null;
}): Promise<{ userId: string; botId: string }> {
  if (!session.email) throw new Error("Email is required");

  // Check if user already exists with this email
  let user = await prisma.user.findUnique({ where: { email: session.email } });

  if (!user) {
    // Create user with a synthetic clerkId (will be linked later if they sign into dashboard)
    const clerkId = `bot_onboard_${randomBytes(12).toString("hex")}`;
    user = await prisma.user.create({
      data: {
        clerkId,
        email: session.email,
        fullName: session.fullName || session.email.split("@")[0],
        kycLevel: "NONE",
        status: "PENDING_KYC",
        onboardingStep: 2,
        telegramChatId: session.telegramChatId ?? undefined,
        notificationChannel: session.telegramChatId ? "telegram" : "none",
      },
    });
  } else {
    // Update telegramChatId if not set
    if (session.telegramChatId && !user.telegramChatId) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          telegramChatId: session.telegramChatId,
          notificationChannel: "telegram",
        },
      });
    }
  }

  // Clone bot from shareCode or create default
  let botId: string;
  if (session.shareCode) {
    const link = await prisma.botShareLink.findUnique({ where: { code: session.shareCode } });
    if (link) {
      const config = link.templateConfig as Record<string, unknown>;
      const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
      const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

      const bot = await prisma.bot.create({
        data: {
          ownerId: user.id,
          name: (config.name as string) ?? "Jarvis",
          platform: (config.platform as any) ?? "TELEGRAM",
          apiKeyHash,
          systemPrompt: (config.systemPrompt as string) ?? null,
          botDisplayName: (config.botDisplayName as string) ?? null,
          capabilities: (config.capabilities as string[]) ?? [],
          language: (config.language as string) ?? "pt-BR",
        },
      });

      const policyConfig = config.policy as Record<string, unknown> | null;
      await prisma.policy.create({
        data: {
          botId: bot.id,
          maxPerTransaction: (policyConfig?.maxPerTransaction as number) ?? 100,
          maxPerDay: (policyConfig?.maxPerDay as number) ?? 500,
          autoApproveLimit: (policyConfig?.autoApproveLimit as number) ?? 50,
          allowedCategories: (policyConfig?.allowedCategories as string[]) ?? [],
          timezone: (policyConfig?.timezone as string) ?? "America/New_York",
        },
      });

      // Create agent
      const agentId = `ag_${randomBytes(12).toString("hex")}`;
      await prisma.agent.create({
        data: { id: agentId, botId: bot.id, ownerId: user.id, name: `Agent for ${bot.name}` },
      });

      // Record clone
      await prisma.botShareLink.update({
        where: { code: session.shareCode },
        data: { useCount: { increment: 1 } },
      });
      await prisma.botClone.create({
        data: {
          shareCode: session.shareCode,
          newBotId: bot.id,
          newUserId: user.id,
          referredByUserId: link.createdByUserId,
        },
      });

      botId = bot.id;
    } else {
      botId = await createDefaultBot(user.id);
    }
  } else {
    botId = await createDefaultBot(user.id);
  }

  return { userId: user.id, botId };
}

async function createDefaultBot(userId: string): Promise<string> {
  const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

  const bot = await prisma.bot.create({
    data: {
      ownerId: userId,
      name: "Jarvis",
      platform: "TELEGRAM",
      apiKeyHash,
      capabilities: ["amazon", "walmart", "target"],
      language: "pt-BR",
    },
  });

  await prisma.policy.create({
    data: {
      botId: bot.id,
      maxPerTransaction: 100,
      maxPerDay: 500,
      autoApproveLimit: 50,
    },
  });

  const agentId = `ag_${randomBytes(12).toString("hex")}`;
  await prisma.agent.create({
    data: { id: agentId, botId: bot.id, ownerId: userId, name: "Agent for Jarvis" },
  });

  return bot.id;
}

/**
 * Get a message for the current step (for session resume).
 */
async function getStepMessage(step: string, session: { email?: string | null }): Promise<string> {
  switch (step) {
    case "name":
      return "Parece que você já começou o cadastro! Qual é o seu nome?";
    case "email":
      return "Parece que você já começou o cadastro! Qual é o seu email?";
    case "email_confirm":
      return `Já enviei o código para ${session.email ?? "seu email"}. Digita o código de 6 dígitos:`;
    case "limits":
      return "Vamos definir seus limites de compra.\n\nQual o valor máximo por compra?\n\n💰 $20\n💰 $50\n💰 $100\n✏️ Outro valor";
    case "payment":
      return "Falta só adicionar seu cartão. Clica no link que enviei ou digita \"pular\" para fazer depois.";
    default:
      return "Qual é o seu nome para começarmos?";
  }
}

/**
 * Notify the referrer that someone completed onboarding.
 */
async function notifyReferrer(shareCode: string, newUserName: string): Promise<void> {
  const link = await prisma.botShareLink.findUnique({
    where: { code: shareCode },
    select: { createdByUserId: true },
  });
  if (!link) return;

  const referrer = await prisma.user.findUnique({
    where: { id: link.createdByUserId },
    select: { telegramChatId: true, notificationChannel: true },
  });

  if (referrer?.telegramChatId && referrer.notificationChannel === "telegram") {
    // Send Telegram notification via the bot
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      const text = `🎉 ${newUserName} ativou o bot que você compartilhou!`;
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: referrer.telegramChatId, text }),
        });
      } catch (err) {
        console.error("[Onboarding] Failed to notify referrer:", err);
      }
    }
  }
}
