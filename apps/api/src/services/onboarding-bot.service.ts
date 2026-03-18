/**
 * Onboarding Bot Service — Conversational onboarding via Telegram/WhatsApp
 *
 * Flow (100% in chat, English by default):
 * name → bot_nickname → email_password → email_confirm → beta_choice → limits → stores → shipping_address → payment → complete
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

// ─── Helpers ─────────────────────────────────────────────

function generateEmailCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}

async function getSharedByName(shareCode: string): Promise<string | null> {
  const link = await prisma.botShareLink.findUnique({
    where: { code: shareCode },
    select: { templateConfig: true },
  });
  if (!link) return null;
  const config = link.templateConfig as Record<string, unknown>;
  return (config.sharedByName as string) ?? null;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = 3,
): Promise<T> {
  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[Onboarding] CRITICAL: ${label} failed after ${maxRetries + 1} attempts:`, (err as Error).message);
        throw err;
      }
      const delay = delays[attempt] ?? 4000;
      console.warn(`[Onboarding] ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// ─── Start ───────────────────────────────────────────────

export async function startOnboarding(
  chatId: string,
  platform: "telegram" | "whatsapp",
  shareCode?: string
): Promise<{ sessionId: string; message: string }> {
  const existing = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (existing && existing.step !== "complete" && existing.expiresAt > new Date()) {
    const response = await getStepMessage(existing.step, existing);
    return { sessionId: existing.id, message: response };
  }

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
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72h
    },
  });

  const referralIntro = sharedByName
    ? `Your friend ${sharedByName} invited you to try PayJarvis!\n\n`
    : "";

  const greeting = `${referralIntro}Hi! 👋 I'm PayJarvis, your personal shopping and research assistant.\n\nI can help you with:\n🛒 Shop online for you\n🔍 Search and compare products\n💰 Control your spending automatically\n📋 Organize your personal tasks\n\nWhat's your name?`;

  return { sessionId: session.id, message: greeting };
}

// ─── Process Step ────────────────────────────────────────

export async function processStep(
  chatId: string,
  platform: string,
  userInput: string
): Promise<BotResponse> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session || session.step === "complete") {
    return { message: "No active onboarding session.", step: "none", complete: false };
  }

  if (session.expiresAt < new Date()) {
    await prisma.onboardingSession.delete({ where: { id: session.id } });
    return { message: "Session expired. Start again with /start.", step: "expired", complete: false };
  }

  switch (session.step) {
    case "name":
      return handleNameStep(session.id, userInput);
    case "bot_nickname":
      return handleBotNicknameStep(session.id, userInput);
    case "email_password":
      return handleEmailPasswordStep(session.id, userInput);
    case "email_confirm":
      return handleEmailConfirmStep(session.id, userInput);
    case "beta_choice":
      return handleBetaChoiceStep(session.id, userInput);
    case "limits":
      return handleLimitsStep(session.id, userInput);
    case "stores":
      return handleStoresStep(session.id, userInput);
    case "shipping_address":
      return handleShippingAddressStep(session.id, userInput);
    case "payment":
      return handlePaymentStep(session.id, userInput);
    default:
      return { message: "Unexpected state. Try /start again.", step: session.step, complete: false };
  }
}

// ─── Step: name ──────────────────────────────────────────

async function handleNameStep(sessionId: string, input: string): Promise<BotResponse> {
  const name = input.trim();

  if (name.length < 2) {
    return { message: "Name too short. What's your name?", step: "name", complete: false };
  }
  if (name.length > 100) {
    return { message: "Name too long. What's your name?", step: "name", complete: false };
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { fullName: name, step: "bot_nickname" },
  });

  return {
    message: `Nice to meet you, ${name}! 😊\n\nWould you like to give me a special name or keep calling me Jarvis?`,
    step: "bot_nickname",
    complete: false,
  };
}

// ─── Step: bot_nickname ──────────────────────────────────

async function handleBotNicknameStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const keepDefault = ["no", "nah", "jarvis", "keep", "that's fine", "fine", "n", "não", "nao", "pode ser"];
  const notAName = ["falar", "português", "portugues", "english", "spanish", "please", "can you", "speak", "language", "idioma", "sim", "yes", "como", "what", "help", "ajuda", "quero", "want", "could", "would"];

  let nickname: string;
  let response: string;

  if (keepDefault.some((k) => lower === k || lower.startsWith(k))) {
    nickname = "Jarvis";
    response = "Alright, just call me Jarvis! 😄";
  } else if (input.trim().length > 20 || notAName.some((w) => lower.includes(w))) {
    // Not a valid bot name — likely a sentence or language request
    return {
      message: "Just type a short name like Luna, Max, or say 'Jarvis is fine' 😊",
      step: "bot_nickname",
      complete: false,
    };
  } else {
    nickname = input.trim().slice(0, 50);
    response = `Love it! From now on, call me ${nickname}! 🎉`;
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { botNickname: nickname, step: "email_password" },
  });

  return {
    message: `${response}\n\nNow I need to register you. Send me your email and create a password:\n\n📧 Email:\n🔒 Password:\n\n(You can send both in one message, e.g.: myemail@gmail.com MyPassword123)`,
    step: "email_password",
    complete: false,
  };
}

// ─── Step: email_password ────────────────────────────────

async function handleEmailPasswordStep(sessionId: string, input: string): Promise<BotResponse> {
  const trimmed = input.trim();

  // Detect if user sent a question/sentence instead of email+password
  if (!trimmed.includes("@")) {
    return {
      message: "No worries! When you're ready, send your email and a password together.\n\nExample: john@gmail.com MyPassword123",
      step: "email_password",
      complete: false,
    };
  }

  const parts = trimmed.split(/\s+/);

  let email: string | null = null;
  let password: string | null = null;

  for (const part of parts) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
      email = part.toLowerCase();
    } else if (!password && part.length >= 6) {
      password = part;
    }
  }

  if (!email) {
    return {
      message: "Hmm, that doesn't look like a valid email. Send your email and password together:\n\nExample: john@gmail.com MyPassword123",
      step: "email_password",
      complete: false,
    };
  }

  if (!password) {
    return {
      message: "I also need a password (minimum 6 characters). Send email and password:\n\nExample: john@gmail.com MyPassword123",
      step: "email_password",
      complete: false,
    };
  }

  if (password.length < 6) {
    return {
      message: "Password must be at least 6 characters. Try again:\n\nExample: john@gmail.com MyPassword123",
      step: "email_password",
      complete: false,
    };
  }

  const code = generateEmailCode();

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { email, password, emailToken: code, step: "email_confirm" },
  });

  sendOnboardingConfirmation(email, code).catch((err: unknown) => {
    console.error("[Onboarding] Failed to send confirmation email:", err);
  });

  return {
    message: `I sent a 6-digit code to your email. What is it?\n\n💡 If you can't find it in your inbox, check your Spam folder!`,
    step: "email_confirm",
    complete: false,
  };
}

// ─── Step: email_confirm ─────────────────────────────────

async function handleEmailConfirmStep(sessionId: string, input: string): Promise<BotResponse> {
  const code = input.trim();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  if (code !== session.emailToken) {
    const attempts = (session.emailAttempts ?? 0) + 1;
    const MAX_ATTEMPTS = 5;

    if (attempts >= MAX_ATTEMPTS) {
      const newCode = generateEmailCode();
      await prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { emailToken: newCode, emailAttempts: 0 },
      });

      if (session.email) {
        sendOnboardingConfirmation(session.email, newCode).catch((err: unknown) => {
          console.error("[Onboarding] Failed to resend confirmation email:", err);
        });
      }

      return {
        message: "Too many incorrect attempts. I sent a new code to your email.\n\nEnter the new 6-digit code:",
        step: "email_confirm",
        complete: false,
      };
    }

    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { emailAttempts: attempts },
    });

    const remaining = MAX_ATTEMPTS - attempts;
    return {
      message: `Incorrect code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.\n\nEnter the 6-digit code:`,
      step: "email_confirm",
      complete: false,
    };
  }

  // Create user + bot + policy
  const { userId, botId } = await createUserAndBot(session);

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "beta_choice", userId, botId, password: null },
  });

  return {
    message: `Account created! 🎉\n\nYou arrived at the right time! We're in Beta and access is completely free. Try me out with no commitment!\n\nWant to set up your shopping system now or explore first?\n\n1️⃣ Set up now\n2️⃣ Explore first — I'll set up later`,
    step: "beta_choice",
    complete: false,
  };
}

// ─── Step: beta_choice ───────────────────────────────────

async function handleBetaChoiceStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();

  if (lower === "2" || lower.includes("later") || lower.includes("explore") || lower.includes("depois")) {
    return completeOnboarding(sessionId);
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "limits" },
  });

  return {
    message: "What spending limit per purchase would you like? (e.g.: $50, $100, $200)",
    step: "limits",
    complete: false,
  };
}

// ─── Step: limits ────────────────────────────────────────

async function handleLimitsStep(sessionId: string, input: string): Promise<BotResponse> {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const value = parseFloat(cleaned);

  if (isNaN(value) || value <= 0 || value > 10000) {
    return {
      message: "Invalid amount. Choose a number between 1 and 10,000:\n\nExample: $50, $100, $200",
      step: "limits",
      complete: false,
    };
  }

  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.botId) return { message: "Internal error.", step: "error", complete: false };

  const autoApprove = Math.floor(value * 0.5);
  await prisma.policy.updateMany({
    where: { botId: session.botId },
    data: {
      maxPerTransaction: value,
      autoApproveLimit: autoApprove,
    },
  });

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { limitsSet: true, step: "stores" },
  });

  return {
    message: `Great! $${value.toFixed(0)} per purchase limit set.\n\nRight now I can shop on Amazon for you! More stores coming soon.\n\nWant to connect your Amazon account now?\n\n1️⃣ Yes — let's set it up\n2️⃣ Later — I'll explore first`,
    step: "stores",
    complete: false,
  };
}

// ─── Step: stores ────────────────────────────────────────

async function handleStoresStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  // "Later" / Skip / 2
  if (lower === "2" || lower === "later" || lower === "skip" || lower === "done" || lower === "pular" || lower === "pronto" || lower === "depois") {
    return moveToShippingStep(sessionId, "No problem! You can connect Amazon anytime from Settings.\n\n");
  }

  // "Yes" / 1 / Amazon
  if (lower === "1" || lower === "yes" || lower === "sim" || lower === "amazon" || lower.includes("yes") || lower.includes("amazon") || lower.includes("set")) {
    await connectStore(session.userId, "amazon", "https://www.amazon.com", "Amazon", true);

    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { storesConfigured: true },
    });

    return moveToShippingStep(sessionId, "Amazon connected! ✅ I can now shop for you anytime.\n\n");
  }

  // Coming soon stores
  const comingSoon = ["ebay", "walmart", "target", "best buy", "bestbuy", "nike", "zara"];
  if (comingSoon.some((s) => lower.includes(s))) {
    return {
      message: "That store is coming soon! Right now I can shop on Amazon.\n\nWant to connect Amazon?\n\n1️⃣ Yes\n2️⃣ Later",
      step: "stores",
      complete: false,
    };
  }

  return {
    message: "Right now I can shop on Amazon. Want to connect it?\n\n1️⃣ Yes — let's set it up\n2️⃣ Later — I'll explore first",
    step: "stores",
    complete: false,
  };
}

async function checkStoreCapabilities(
  userId: string,
  storeName: string,
  storeUrl: string,
  storeLabel: string,
): Promise<void> {
  const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || "http://localhost:3003";
  const BROWSER_AGENT_KEY = process.env.BROWSER_AGENT_API_KEY || "";

  try {
    const res = await fetch(`${BROWSER_AGENT_URL}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": BROWSER_AGENT_KEY },
      body: JSON.stringify({
        site: storeUrl,
        action: `Navigate to ${storeUrl}. Check if the site has a login/account system and if it supports guest checkout. Return JSON: { requiresAuth: boolean, hasGuestCheckout: boolean }`,
        priority: 3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.warn(`[STORE CHECK] Browser agent returned ${res.status} for ${storeUrl}`);
      return;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const taskId = data.task_id as string;
    if (!taskId) return;

    // Poll for result (max 60s)
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const check = await fetch(`${BROWSER_AGENT_URL}/tasks/${taskId}`, {
        headers: { "x-api-key": BROWSER_AGENT_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (!check.ok) continue;
      const task = (await check.json()) as Record<string, unknown>;
      if (task.status === "completed") {
        const result = task.result as Record<string, unknown> | undefined;
        const requiresAuth = !!(result?.requiresAuth);
        const hasGuestCheckout = !!(result?.hasGuestCheckout);

        // Save to store_connections
        await prisma.$executeRaw`
          INSERT INTO store_connections (id, user_id, store_url, store_name, requires_auth, has_guest_checkout, last_checked_at, status)
          VALUES (gen_random_uuid()::text, ${userId}, ${storeUrl}, ${storeLabel}, ${requiresAuth}, ${hasGuestCheckout}, NOW(), 'checked')
          ON CONFLICT (id) DO NOTHING
        `;

        console.log(`[STORE CHECK] ${storeLabel}: requiresAuth=${requiresAuth}, guestCheckout=${hasGuestCheckout}`);
        return;
      }
      if (task.status === "failed") {
        console.warn(`[STORE CHECK] Browser agent failed for ${storeUrl}`);
        return;
      }
    }
  } catch (err) {
    console.warn(`[STORE CHECK] Error checking ${storeUrl}:`, (err as Error).message);
  }
}

async function connectStore(
  userId: string,
  store: string,
  storeUrl: string,
  storeLabel: string,
  requiresAuth: boolean
): Promise<void> {
  const existing = await prisma.storeContext.findUnique({
    where: { userId_store: { userId, store } },
  });
  if (existing) return;

  await prisma.storeContext.create({
    data: {
      userId,
      store,
      storeUrl,
      storeLabel,
      status: "configured",
    },
  });
}

async function moveToShippingStep(
  sessionId: string,
  prefix = ""
): Promise<BotResponse> {
  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "shipping_address" },
  });

  return {
    message: `${prefix}Where should I deliver your purchases? Send me your shipping address:\n\n📍 Street, City, State, ZIP code\n\n(Example: 1234 Main St, Miami, FL 33101)\n\nOr type "skip" to add later.`,
    step: "shipping_address",
    complete: false,
  };
}

// ─── Step: shipping_address ─────────────────────────────

async function handleShippingAddressStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session?.userId) return { message: "Internal error.", step: "error", complete: false };

  if (lower === "skip" || lower === "pular") {
    return moveToPaymentStep(sessionId, session.userId);
  }

  const address = input.trim();
  if (address.length < 10) {
    return {
      message: "That seems too short for an address. Please include street, city, state and ZIP code.\n\n(Example: 1234 Main St, Miami, FL 33101)\n\nOr type \"skip\" to add later.",
      step: "shipping_address",
      complete: false,
    };
  }

  await prisma.user.update({
    where: { id: session.userId },
    data: { shippingAddress: address },
  });

  return moveToPaymentStep(sessionId, session.userId, `Got it! All purchases will be delivered to:\n📍 ${address}\n\nYou can change this anytime by saying "update my address".\n\n`);
}

async function moveToPaymentStep(
  sessionId: string,
  userId: string,
  prefix = ""
): Promise<BotResponse> {
  let paymentMessage = "";
  try {
    const link = await generateStripeSetupLink(userId, sessionId);
    paymentMessage = `Last step — add your card so I can shop for you.\n\nClick here to register securely (powered by Stripe): ${link}\n\nOr type "skip" to add later.`;
  } catch {
    paymentMessage = "Last step — add a payment method.\n\nYou can set this up later in the dashboard.\n\nType \"skip\" to finish.";
  }

  await prisma.onboardingSession.update({
    where: { id: sessionId },
    data: { step: "payment" },
  });

  return {
    message: `${prefix}${paymentMessage}`,
    step: "payment",
    complete: false,
  };
}

// ─── Step: payment ───────────────────────────────────────

async function handlePaymentStep(sessionId: string, input: string): Promise<BotResponse> {
  const lower = input.trim().toLowerCase();

  if (lower === "skip" || lower === "pular") {
    return completeOnboarding(sessionId);
  }

  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  if (session.paymentSetup) {
    return completeOnboarding(sessionId);
  }

  if (lower === "done" || lower === "pronto" || lower === "ok" || lower === "✅") {
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
      message: "I haven't detected the payment yet. Try clicking the link above to add your card.\n\nOr type \"skip\" to set up later.",
      step: "payment",
      complete: false,
    };
  }

  return {
    message: "Click the link above to add your card.\n\nType \"done\" when finished or \"skip\" to do it later.",
    step: "payment",
    complete: false,
  };
}

// ─── Complete ────────────────────────────────────────────

export async function completeOnboarding(sessionId: string): Promise<BotResponse> {
  const session = await prisma.onboardingSession.findUnique({ where: { id: sessionId } });
  if (!session) return { message: "Session not found.", step: "error", complete: false };

  const nickname = session.botNickname || "Jarvis";

  if (session.userId) {
    await prisma.$transaction(async (tx) => {
      await tx.onboardingSession.update({
        where: { id: sessionId },
        data: { step: "complete" },
      });

      await tx.user.update({
        where: { id: session.userId! },
        data: { onboardingCompleted: true, onboardingStep: 5, botNickname: nickname },
      });

      const existingCredit = await tx.llmCredit.findUnique({ where: { userId: session.userId! } });
      if (!existingCredit) {
        await tx.llmCredit.create({
          data: {
            userId: session.userId!,
            messagesTotal: 5000,
            messagesUsed: 0,
            messagesRemaining: 5000,
            freeTrialActive: false,
            freeTrialEndsAt: null,
          },
        });
        console.log(`[Credit] Initialized for ${session.userId} (beta user) [via transaction]`);
      }
    });

    // Sequence init with retry
    const platform = session.telegramChatId ? "telegram" : "whatsapp";
    const chatId = session.telegramChatId ?? session.whatsappPhone ?? "";
    const referrerName = session.shareCode ? await getSharedByName(session.shareCode) : null;

    if (chatId) {
      withRetry(
        () => initSequence(session.userId!, platform, chatId, referrerName ?? undefined),
        `initSequence(${session.userId})`,
      ).catch((err) => {
        console.error(`[Onboarding] CRITICAL: initSequence permanently failed for ${session.userId}:`, (err as Error).message);
      });
    }
  } else {
    await prisma.onboardingSession.update({
      where: { id: sessionId },
      data: { step: "complete" },
    });
  }

  // Notify referrer
  if (session.shareCode) {
    notifyReferrer(session.shareCode, session.fullName ?? session.email ?? "Someone").catch(() => {});
  }

  return {
    message: `${nickname} is ready to help! 🚀\n\nYou arrived at the right time! We're in Beta — completely free, no commitment!\n\nAsk me anything — I'm here 24/7 for you!`,
    step: "complete",
    complete: true,
  };
}

// ─── Stripe Setup ────────────────────────────────────────

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

// ─── Session check ───────────────────────────────────────

export async function hasActiveSession(chatId: string, platform: string): Promise<boolean> {
  const session = platform === "telegram"
    ? await prisma.onboardingSession.findUnique({ where: { telegramChatId: chatId } })
    : await prisma.onboardingSession.findUnique({ where: { whatsappPhone: chatId } });

  if (!session) return false;
  return session.step !== "complete" && session.expiresAt > new Date();
}

// ─── User + Bot creation ─────────────────────────────────

async function createUserAndBot(session: {
  id: string;
  email: string | null;
  fullName: string | null;
  botNickname: string | null;
  shareCode: string | null;
  telegramChatId: string | null;
  whatsappPhone: string | null;
}): Promise<{ userId: string; botId: string }> {
  if (!session.email) throw new Error("Email is required");

  let user = await prisma.user.findUnique({ where: { email: session.email } });

  if (!user) {
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
        phone: session.whatsappPhone?.replace("whatsapp:", "") ?? undefined,
        notificationChannel: session.telegramChatId ? "telegram" : session.whatsappPhone ? "whatsapp" : "none",
        botNickname: session.botNickname ?? "Jarvis",
      },
    });
  } else {
    const updates: Record<string, unknown> = {};
    if (session.telegramChatId && !user.telegramChatId) {
      updates.telegramChatId = session.telegramChatId;
      updates.notificationChannel = "telegram";
    }
    if (session.botNickname) {
      updates.botNickname = session.botNickname;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updates });
    }
  }

  const botName = session.botNickname || "Jarvis";

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
          name: botName,
          platform: (config.platform as any) ?? "TELEGRAM",
          apiKeyHash,
          systemPrompt: (config.systemPrompt as string) ?? null,
          botDisplayName: botName,
          capabilities: (config.capabilities as string[]) ?? [],
          language: (config.language as string) ?? "en",
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

      const agentId = `ag_${randomBytes(12).toString("hex")}`;
      await prisma.agent.create({
        data: { id: agentId, botId: bot.id, ownerId: user.id, name: `Agent for ${botName}` },
      });

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
      botId = await createDefaultBot(user.id, botName);
    }
  } else {
    botId = await createDefaultBot(user.id, botName);
  }

  return { userId: user.id, botId };
}

async function createDefaultBot(userId: string, botName = "Jarvis"): Promise<string> {
  const rawKey = `pj_bot_${randomBytes(24).toString("hex")}`;
  const apiKeyHash = createHash("sha256").update(rawKey).digest("hex");

  const bot = await prisma.bot.create({
    data: {
      ownerId: userId,
      name: botName,
      platform: "TELEGRAM",
      apiKeyHash,
      botDisplayName: botName,
      capabilities: ["amazon", "walmart", "target"],
      language: "en",
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
    data: { id: agentId, botId: bot.id, ownerId: userId, name: `Agent for ${botName}` },
  });

  return bot.id;
}

// ─── Step message (resume) ───────────────────────────────

async function getStepMessage(step: string, session: { email?: string | null; fullName?: string | null }): Promise<string> {
  switch (step) {
    case "name":
      return "Looks like you already started! What's your name?";
    case "bot_nickname":
      return `${session.fullName ?? "Hey"}! Would you like to give me a special name or keep calling me Jarvis?`;
    case "email_password":
      return "Send me your email and create a password:\n\n(e.g.: myemail@gmail.com MyPassword123)";
    case "email_confirm":
      return `I already sent the code to ${session.email ?? "your email"}. Enter the 6-digit code:`;
    case "beta_choice":
      return "Want to set up your shopping system now or explore first?\n\n1️⃣ Set up now\n2️⃣ Explore first";
    case "limits":
      return "What spending limit per purchase would you like? (e.g.: $50, $100, $200)";
    case "stores":
      return "Which stores can I shop for you?\n\n🟢 Amazon\n🔜 eBay, Walmart, Target, Best Buy — coming soon\n\nOr type a store website. Type \"done\" to continue.";
    case "shipping_address":
      return "Where should I deliver your purchases? Send your address (Street, City, State, ZIP).\n\nOr type \"skip\" to add later.";
    case "payment":
      return "Just need to add your card. Click the link I sent or type \"skip\" to do it later.";
    default:
      return "What's your name so we can get started?";
  }
}

// ─── Notify referrer ─────────────────────────────────────

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
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      const text = `🎉 ${newUserName} activated the bot you shared!`;
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
