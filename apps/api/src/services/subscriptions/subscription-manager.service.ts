/**
 * Subscription Manager Service — Detect, track, and cancel recurring payments.
 *
 * Camada 1: PayPal + Mercado Pago (APIs already integrated, zero extra cost)
 * Camada 2: Gmail scan (future — needs OAuth setup)
 * Camada 3: Plaid bank connection (future — needs paid integration)
 *
 * Flow:
 *   1. scanAllSubscriptions(userId) — detect from all available sources
 *   2. getSubscriptionSummary(userId) — monthly/annual total breakdown
 *   3. cancelSubscription(userId, subId) — cancel via API or flag for manual
 *   4. detectWaste(userId) — find unused subscriptions
 */

import { prisma } from "@payjarvis/database";
import { PayPalProvider } from "../payments/providers/paypal.provider.js";
import { MercadoPagoProvider } from "../payments/providers/mercadopago.provider.js";

const paypal = new PayPalProvider();
const mp = new MercadoPagoProvider();

export interface SubscriptionInfo {
  id: string;
  serviceName: string;
  planName: string | null;
  amount: number;
  currency: string;
  billingCycle: string;
  nextBillingDate: string | null;
  lastBilledDate: string | null;
  status: string;
  paymentMethod: string;
  canCancelViaApi: boolean;
  monthlyEquivalent: number | null;
}

export interface SubscriptionSummary {
  subscriptions: SubscriptionInfo[];
  totalMonthlyUsd: number;
  totalMonthlyBrl: number;
  totalAnnualEstimate: number;
  count: number;
  mostExpensive: SubscriptionInfo | null;
  cheapest: SubscriptionInfo | null;
}

// ─── Scan All Sources ───

export async function scanAllSubscriptions(userId: string): Promise<SubscriptionInfo[]> {
  console.log(`[SUBS] Scanning subscriptions for user ${userId}`);

  const discovered: Array<{
    serviceName: string;
    amount: number;
    currency: string;
    billingCycle: string;
    paymentMethod: string;
    externalId: string | null;
    canCancel: boolean;
    nextBilling: string | null;
    lastBilled: string | null;
    discoveredVia: string;
  }> = [];

  // 1. Scan PayPal
  if (paypal.isAvailable) {
    try {
      const sixMonthsAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().replace(/\.\d{3}Z/, "-0000");
      const now = new Date().toISOString().replace(/\.\d{3}Z/, "-0000");
      const transactions = await paypal.searchTransactions(sixMonthsAgo, now);

      // Group by merchant and detect recurring
      const byMerchant = new Map<string, Array<{ amount: number; date: string }>>();
      for (const tx of transactions) {
        if (tx.amount <= 0) continue;
        const key = tx.merchantName.toLowerCase().trim();
        if (!byMerchant.has(key)) byMerchant.set(key, []);
        byMerchant.get(key)!.push({ amount: tx.amount, date: tx.date });
      }

      for (const [merchantKey, payments] of byMerchant) {
        if (payments.length < 2) continue;
        // Same merchant, 2+ charges with similar amounts → subscription
        const amounts = payments.map(p => p.amount);
        const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
        const isSimilar = amounts.every(a => Math.abs(a - avg) / avg < 0.15);

        if (isSimilar) {
          const cycle = detectBillingCycle(payments.map(p => p.date));
          discovered.push({
            serviceName: titleCase(merchantKey),
            amount: Math.round(avg * 100) / 100,
            currency: "USD",
            billingCycle: cycle,
            paymentMethod: "paypal",
            externalId: null,
            canCancel: false, // PayPal transaction-based subs can't be cancelled via API easily
            nextBilling: estimateNextBilling(payments[0].date, cycle),
            lastBilled: payments[0].date,
            discoveredVia: "paypal_transactions",
          });
        }
      }
      console.log(`[SUBS] PayPal: found ${discovered.filter(d => d.paymentMethod === "paypal").length} recurring`);
    } catch (err) {
      console.error("[SUBS] PayPal scan failed:", (err as Error).message);
    }
  }

  // 2. Scan Mercado Pago
  if (mp.isAvailable) {
    try {
      // Direct subscriptions (preapprovals)
      const mpSubs = await mp.getUserSubscriptions();
      for (const sub of mpSubs) {
        discovered.push({
          serviceName: sub.planName,
          amount: sub.amount,
          currency: sub.currency,
          billingCycle: sub.frequency,
          paymentMethod: "mercadopago",
          externalId: sub.preapprovalId,
          canCancel: true, // MP preapprovals can be cancelled via API
          nextBilling: sub.nextPaymentDate,
          lastBilled: null,
          discoveredVia: "mp_subscriptions",
        });
      }

      // Recurring payments (pattern detection)
      const mpRecurring = await mp.getRecurringPayments(3);
      for (const rec of mpRecurring) {
        // Skip if already found via preapprovals
        if (discovered.some(d => d.serviceName.toLowerCase() === rec.merchantName.toLowerCase())) continue;

        discovered.push({
          serviceName: rec.merchantName,
          amount: rec.amount,
          currency: rec.currency,
          billingCycle: "monthly",
          paymentMethod: "mercadopago",
          externalId: null,
          canCancel: false,
          nextBilling: null,
          lastBilled: rec.lastPaymentDate,
          discoveredVia: "mp_transactions",
        });
      }
      console.log(`[SUBS] Mercado Pago: found ${discovered.filter(d => d.paymentMethod === "mercadopago").length} recurring`);
    } catch (err) {
      console.error("[SUBS] Mercado Pago scan failed:", (err as Error).message);
    }
  }

  // 3. Upsert into database
  for (const d of discovered) {
    try {
      await prisma.userSubscription.upsert({
        where: {
          userId_serviceName_paymentMethod: {
            userId,
            serviceName: d.serviceName,
            paymentMethod: d.paymentMethod,
          },
        },
        create: {
          userId,
          serviceName: d.serviceName,
          amount: d.amount,
          currency: d.currency,
          billingCycle: d.billingCycle,
          paymentMethod: d.paymentMethod,
          externalSubscriptionId: d.externalId,
          canCancelViaApi: d.canCancel,
          nextBillingDate: d.nextBilling ? new Date(d.nextBilling) : null,
          lastBilledDate: d.lastBilled ? new Date(d.lastBilled) : null,
          monthlyEquivalent: toMonthly(d.amount, d.billingCycle),
          discoveredVia: d.discoveredVia,
          status: "active",
        },
        update: {
          amount: d.amount,
          currency: d.currency,
          nextBillingDate: d.nextBilling ? new Date(d.nextBilling) : undefined,
          lastBilledDate: d.lastBilled ? new Date(d.lastBilled) : undefined,
          monthlyEquivalent: toMonthly(d.amount, d.billingCycle),
          canCancelViaApi: d.canCancel,
          externalSubscriptionId: d.externalId ?? undefined,
        },
      });
    } catch (err) {
      console.error(`[SUBS] Failed to upsert ${d.serviceName}:`, (err as Error).message);
    }
  }

  // 4. Return all active subscriptions from DB
  return getSubscriptions(userId);
}

// ─── Get Subscriptions from DB ───

export async function getSubscriptions(userId: string): Promise<SubscriptionInfo[]> {
  const subs = await prisma.userSubscription.findMany({
    where: { userId, status: { in: ["active", "trial", "paused"] } },
    orderBy: { amount: "desc" },
  });

  return subs.map((s: typeof subs[number]) => ({
    id: s.id,
    serviceName: s.serviceName,
    planName: s.planName,
    amount: s.amount,
    currency: s.currency,
    billingCycle: s.billingCycle,
    nextBillingDate: s.nextBillingDate?.toISOString().split("T")[0] ?? null,
    lastBilledDate: s.lastBilledDate?.toISOString().split("T")[0] ?? null,
    status: s.status,
    paymentMethod: s.paymentMethod,
    canCancelViaApi: s.canCancelViaApi,
    monthlyEquivalent: s.monthlyEquivalent,
  }));
}

// ─── Summary ───

export async function getSubscriptionSummary(userId: string): Promise<SubscriptionSummary> {
  const subs = await getSubscriptions(userId);
  if (subs.length === 0) {
    return { subscriptions: subs, totalMonthlyUsd: 0, totalMonthlyBrl: 0, totalAnnualEstimate: 0, count: 0, mostExpensive: null, cheapest: null };
  }

  let totalUsd = 0;
  let totalBrl = 0;
  for (const s of subs) {
    const monthly = s.monthlyEquivalent ?? s.amount;
    if (s.currency === "BRL") totalBrl += monthly;
    else totalUsd += monthly;
  }

  const sorted = [...subs].sort((a, b) => (b.monthlyEquivalent ?? b.amount) - (a.monthlyEquivalent ?? a.amount));

  return {
    subscriptions: subs,
    totalMonthlyUsd: Math.round(totalUsd * 100) / 100,
    totalMonthlyBrl: Math.round(totalBrl * 100) / 100,
    totalAnnualEstimate: Math.round((totalUsd * 12 + totalBrl * 12) * 100) / 100,
    count: subs.length,
    mostExpensive: sorted[0] || null,
    cheapest: sorted[sorted.length - 1] || null,
  };
}

// ─── Cancel ───

export async function cancelSubscription(
  userId: string,
  subscriptionId: string,
  reason: string = "User requested cancellation",
): Promise<{ success: boolean; message: string; savings?: string }> {
  const sub = await prisma.userSubscription.findFirst({
    where: { id: subscriptionId, userId },
  });

  if (!sub) return { success: false, message: "Subscription not found" };
  if (sub.status === "cancelled") return { success: false, message: "Already cancelled" };

  // Try API cancellation
  if (sub.canCancelViaApi && sub.externalSubscriptionId) {
    let result: { success: boolean; message: string };

    if (sub.paymentMethod === "paypal") {
      result = await paypal.cancelSubscription(sub.externalSubscriptionId, reason);
    } else if (sub.paymentMethod === "mercadopago") {
      result = await mp.cancelPreapproval(sub.externalSubscriptionId);
    } else {
      return { success: false, message: `No API cancellation available for ${sub.paymentMethod}. Visit ${sub.cancelUrl || sub.serviceDomain || "the service website"} to cancel manually.` };
    }

    if (result.success) {
      await prisma.userSubscription.update({
        where: { id: subscriptionId },
        data: { status: "cancelled", updatedAt: new Date() },
      });

      const monthlySavings = sub.monthlyEquivalent ?? sub.amount;
      const annualSavings = Math.round(monthlySavings * 12 * 100) / 100;
      const curr = sub.currency === "BRL" ? "R$" : "$";

      return {
        success: true,
        message: `${sub.serviceName} cancelled successfully via ${sub.paymentMethod}!`,
        savings: `${curr}${monthlySavings}/month = ${curr}${annualSavings}/year`,
      };
    }

    return result;
  }

  // No API cancellation — give user instructions
  return {
    success: false,
    message: `Can't cancel ${sub.serviceName} via API. ${sub.cancelUrl ? `Cancel here: ${sub.cancelUrl}` : `Visit ${sub.serviceDomain || sub.serviceName + ".com"} to cancel manually.`}`,
  };
}

// ─── Detect Waste ───

export async function detectWaste(userId: string): Promise<Array<{
  subscription: SubscriptionInfo;
  daysSinceLastBilled: number;
  potentialAnnualSavings: number;
}>> {
  const subs = await getSubscriptions(userId);
  const waste: Array<{
    subscription: SubscriptionInfo;
    daysSinceLastBilled: number;
    potentialAnnualSavings: number;
  }> = [];

  const now = Date.now();

  for (const s of subs) {
    if (s.status !== "active") continue;
    if (!s.lastBilledDate) continue;

    const lastBilled = new Date(s.lastBilledDate).getTime();
    const daysSince = Math.floor((now - lastBilled) / 86_400_000);

    // Flag if 60+ days since last billing (for monthly) or 400+ days (for annual)
    const threshold = s.billingCycle === "yearly" ? 400 : 60;

    if (daysSince > threshold) {
      const monthly = s.monthlyEquivalent ?? s.amount;
      waste.push({
        subscription: s,
        daysSinceLastBilled: daysSince,
        potentialAnnualSavings: Math.round(monthly * 12 * 100) / 100,
      });
    }
  }

  return waste.sort((a, b) => b.potentialAnnualSavings - a.potentialAnnualSavings);
}

// ─── Renewal Alerts ───

export async function getUpcomingRenewals(userId: string, withinDays: number = 3): Promise<SubscriptionInfo[]> {
  const now = new Date();
  const future = new Date(now.getTime() + withinDays * 86_400_000);

  const subs = await prisma.userSubscription.findMany({
    where: {
      userId,
      status: "active",
      nextBillingDate: { gte: now, lte: future },
    },
    orderBy: { nextBillingDate: "asc" },
  });

  return subs.map((s: typeof subs[number]) => ({
    id: s.id,
    serviceName: s.serviceName,
    planName: s.planName,
    amount: s.amount,
    currency: s.currency,
    billingCycle: s.billingCycle,
    nextBillingDate: s.nextBillingDate?.toISOString().split("T")[0] ?? null,
    lastBilledDate: s.lastBilledDate?.toISOString().split("T")[0] ?? null,
    status: s.status,
    paymentMethod: s.paymentMethod,
    canCancelViaApi: s.canCancelViaApi,
    monthlyEquivalent: s.monthlyEquivalent,
  }));
}

// ─── Manual Add ───

export async function addSubscriptionManually(
  userId: string,
  data: { serviceName: string; amount: number; currency?: string; billingCycle?: string; paymentMethod?: string },
): Promise<SubscriptionInfo> {
  const sub = await prisma.userSubscription.create({
    data: {
      userId,
      serviceName: data.serviceName,
      amount: data.amount,
      currency: data.currency ?? "USD",
      billingCycle: data.billingCycle ?? "monthly",
      paymentMethod: data.paymentMethod ?? "manual",
      monthlyEquivalent: toMonthly(data.amount, data.billingCycle ?? "monthly"),
      discoveredVia: "manual",
      status: "active",
    },
  });

  return {
    id: sub.id,
    serviceName: sub.serviceName,
    planName: sub.planName,
    amount: sub.amount,
    currency: sub.currency,
    billingCycle: sub.billingCycle,
    nextBillingDate: null,
    lastBilledDate: null,
    status: sub.status,
    paymentMethod: sub.paymentMethod,
    canCancelViaApi: false,
    monthlyEquivalent: sub.monthlyEquivalent,
  };
}

// ─── Helpers ───

function detectBillingCycle(dates: string[]): string {
  if (dates.length < 2) return "monthly";
  const sorted = dates.map(d => new Date(d).getTime()).sort((a, b) => b - a);
  const gaps: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    gaps.push(Math.round((sorted[i] - sorted[i + 1]) / 86_400_000));
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avgGap < 10) return "weekly";
  if (avgGap < 45) return "monthly";
  if (avgGap < 100) return "quarterly";
  return "yearly";
}

function estimateNextBilling(lastDate: string, cycle: string): string | null {
  try {
    const last = new Date(lastDate);
    const daysToAdd = cycle === "weekly" ? 7 : cycle === "monthly" ? 30 : cycle === "quarterly" ? 90 : 365;
    const next = new Date(last.getTime() + daysToAdd * 86_400_000);
    // If estimated next is in the past, project forward
    while (next.getTime() < Date.now()) {
      next.setTime(next.getTime() + daysToAdd * 86_400_000);
    }
    return next.toISOString();
  } catch {
    return null;
  }
}

function toMonthly(amount: number, cycle: string): number {
  switch (cycle) {
    case "weekly": return Math.round(amount * 4.33 * 100) / 100;
    case "monthly": return amount;
    case "quarterly": return Math.round(amount / 3 * 100) / 100;
    case "yearly": return Math.round(amount / 12 * 100) / 100;
    default: return amount;
  }
}

function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}
