// ─── Payment Wallet Service ─────────────────────────────────────────────
// Central service for managing user payment methods (the "wallet").
// Used by Gemini tools (manage_payment_methods, smart_checkout) and REST routes.

import { prisma, Prisma } from "@payjarvis/database";
import type { PaymentMethod, PaymentProvider } from "@payjarvis/database";
import { getWalletInfo } from "../skyfire.service.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface PaymentOption {
  id: string;
  provider: string;
  displayName: string;
  canPay: boolean;        // can cover the requested amount
  reason?: string;        // why it can't pay (e.g. "Saldo insuficiente")
  balance?: number;       // for wallets with balance (Skyfire)
  isDefault: boolean;
  metadata: Record<string, unknown>;
}

export interface FormattedPaymentOptions {
  options: PaymentOption[];
  message: string;        // formatted for chat
  hasValidOption: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function resolveDisplayName(method: PaymentMethod): string {
  if (method.displayName) return method.displayName;
  if (method.accountId) return `${method.provider} (${method.accountId})`;
  return method.provider;
}

/** Check if a provider is store-specific (only valid for that store) */
function isStoreProvider(provider: string): boolean {
  return ["AMAZON"].includes(provider);
}

/** Check if a provider is currency-restricted */
function getCurrencyRestriction(provider: string): string | null {
  if (provider === "PIX") return "BRL";
  return null;
}

// ─── Core Wallet Operations ─────────────────────────────────────────────

/** List all active payment methods for a user */
export async function getUserPaymentMethods(userId: string): Promise<PaymentMethod[]> {
  return prisma.paymentMethod.findMany({
    where: { userId, status: { in: ["CONNECTED", "PENDING"] } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

/** Add a new payment method to the user's wallet */
export async function addPaymentMethod(params: {
  userId: string;
  provider: PaymentProvider;
  displayName: string;
  accountId?: string;
  credentials?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  isDefault?: boolean;
}): Promise<PaymentMethod> {
  const { userId, provider, displayName, accountId, credentials, metadata, isDefault } = params;

  // If setting as default, unset other defaults first
  if (isDefault) {
    await prisma.paymentMethod.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  return prisma.paymentMethod.create({
    data: {
      userId,
      provider,
      displayName,
      accountId: accountId ?? displayName,
      status: "CONNECTED",
      credentials: (credentials ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      metadata: (metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      isDefault: isDefault ?? false,
    },
  });
}

/** Remove (disable) a payment method */
export async function removePaymentMethod(userId: string, methodId: string): Promise<boolean> {
  const method = await prisma.paymentMethod.findFirst({
    where: { id: methodId, userId },
  });
  if (!method) return false;

  await prisma.paymentMethod.update({
    where: { id: methodId },
    data: { status: "DISABLED" },
  });
  return true;
}

/** Set a payment method as the default */
export async function setDefaultMethod(userId: string, methodId: string): Promise<boolean> {
  const method = await prisma.paymentMethod.findFirst({
    where: { id: methodId, userId, status: "CONNECTED" },
  });
  if (!method) return false;

  await prisma.$transaction([
    prisma.paymentMethod.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.paymentMethod.update({
      where: { id: methodId },
      data: { isDefault: true },
    }),
  ]);
  return true;
}

// ─── Smart Payment Options ──────────────────────────────────────────────

/** Get payment options filtered by amount, currency, and store context */
export async function getPaymentOptions(
  userId: string,
  amount: number,
  currency: string = "USD",
  store?: string, // e.g. "amazon" — filter store-specific methods
): Promise<FormattedPaymentOptions> {
  const methods = await getUserPaymentMethods(userId);

  if (methods.length === 0) {
    return {
      options: [],
      message: "You don't have any payment method set up yet. Want me to help you add PayPal, a credit card, or another option?",
      hasValidOption: false,
    };
  }

  // Enrich methods with real-time data (e.g. Skyfire balance)
  const options: PaymentOption[] = [];

  for (const method of methods) {
    const option = await evaluateMethod(method, amount, currency, store);
    if (option) options.push(option);
  }

  // Sort: default first, then canPay=true, then by provider name
  options.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.canPay !== b.canPay) return a.canPay ? -1 : 1;
    return a.provider.localeCompare(b.provider);
  });

  const message = formatPaymentOptions(options, amount, currency);
  const hasValidOption = options.some((o) => o.canPay);

  return { options, message, hasValidOption };
}

/** Evaluate if a single method can handle a payment */
async function evaluateMethod(
  method: PaymentMethod,
  amount: number,
  currency: string,
  store?: string,
): Promise<PaymentOption | null> {
  const meta = (method.metadata ?? {}) as Record<string, unknown>;
  const display = resolveDisplayName(method);

  // Skip store-specific methods that don't match the store
  if (isStoreProvider(method.provider) && store && method.provider.toLowerCase() !== store.toLowerCase()) {
    return null;
  }

  // Skip currency-restricted methods
  const currencyRestriction = getCurrencyRestriction(method.provider);
  if (currencyRestriction && currency.toUpperCase() !== currencyRestriction) {
    return null;
  }

  const base: PaymentOption = {
    id: method.id,
    provider: method.provider,
    displayName: display,
    canPay: true,
    isDefault: method.isDefault,
    metadata: meta,
  };

  // Provider-specific checks
  switch (method.provider) {
    case "SKYFIRE": {
      try {
        const wallet = await getWalletInfo();
        const balance = wallet.balance ?? 0;
        base.balance = balance;
        base.displayName = `PayJarvis Wallet ($${balance.toFixed(2)})`;
        if (balance < amount) {
          base.canPay = false;
          base.reason = `Balance $${balance.toFixed(2)} — doesn't cover $${amount.toFixed(2)}`;
        }
      } catch {
        base.canPay = false;
        base.reason = "Wallet unavailable";
      }
      break;
    }
    case "AMAZON": {
      const loggedIn = meta.logged_in === true;
      if (!loggedIn) {
        base.canPay = false;
        base.reason = "Amazon session expired — reconnect";
      }
      // Amazon only works for Amazon products
      if (store && store.toLowerCase() !== "amazon") {
        return null;
      }
      break;
    }
    case "PAYPAL":
    case "STRIPE":
    case "CREDIT_CARD":
      // These can pay any amount (within safeguards)
      base.canPay = true;
      break;
    case "PIX":
      // PIX only works for BRL
      if (currency.toUpperCase() !== "BRL") {
        return null;
      }
      base.canPay = true;
      break;
    default:
      base.canPay = true;
  }

  return base;
}

/** Format payment options as a user-friendly message */
export function formatPaymentOptions(
  options: PaymentOption[],
  amount: number,
  currency: string,
): string {
  if (options.length === 0) {
    return "You don't have any payment method set up yet. Want me to help you add PayPal, a credit card, or another option?";
  }

  const symbol = currency === "BRL" ? "R$" : "$";
  const lines: string[] = [`How would you like to pay ${symbol}${amount.toFixed(2)}?`];
  const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣"];

  let idx = 0;
  for (const opt of options) {
    if (opt.canPay) {
      const emoji = emojis[idx] ?? `${idx + 1}.`;
      const defaultTag = opt.isDefault ? " ⭐" : "";
      lines.push(`${emoji} ${opt.displayName}${defaultTag}`);
      idx++;
    }
  }

  // Show methods that can't pay as hints
  const cantPay = options.filter((o) => !o.canPay);
  for (const opt of cantPay) {
    lines.push(`💡 ${opt.displayName} — ${opt.reason}`);
  }

  return lines.join("\n");
}

/** Get a summary of the wallet for system prompt injection */
export async function getWalletSummary(userId: string): Promise<string> {
  const methods = await getUserPaymentMethods(userId);
  if (methods.length === 0) return "No payment methods configured.";

  const lines = methods.map((m) => {
    const display = resolveDisplayName(m);
    const def = m.isDefault ? " (default)" : "";
    return `- ${display}${def}`;
  });

  return `Payment Wallet:\n${lines.join("\n")}`;
}
