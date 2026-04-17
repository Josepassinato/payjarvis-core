/**
 * Rail Selector — picks the best payment rail for a given merchant + context.
 *
 * Inputs: merchant identity, amount, currency, user context (wallet balances, consents).
 * Output: primary rail + ordered fallbacks.
 *
 * Pure function — no DB. Uses a merchant registry keyed on domain/slug patterns.
 * Unknown merchants get a conservative default chain based on currency/country.
 */

export type Rail =
  | "pix_iniciador"     // Open Finance, autonomous PIX from user's bank
  | "pix_manual"        // QR code → user approves in bank app
  | "visa_ctp"          // Visa Click to Pay tokenized card
  | "mastercard_bpa"    // Mastercard Buyer Payment Agent
  | "skyfire_wallet"    // Skyfire agentic USD balance
  | "mercadopago"       // Mercado Pago balance/card (BR)
  | "stripe_card"       // Charge user's saved card via Stripe
  | "paypal_user"       // User's PayPal (requires OAuth)
  | "boleto";           // Banking slip (BR, slow settlement)

export type Provider =
  | "skyfire"
  | "mercadopago"
  | "stripe"
  | "paypal"
  | "visa"
  | "mastercard"
  | "pix_provider";

export interface RailContext {
  merchantId?: string;
  merchantName?: string;
  merchantDomain?: string;
  merchantCountry?: string;
  amount: number;           // in currency units (e.g., 29.99)
  currency: string;         // 'BRL' | 'USD' | 'EUR' | etc
  user?: {
    hasSkyfireBalance?: boolean;
    skyfireBalanceUsd?: number;
    hasIniciadorConsent?: boolean;
    hasStripeCard?: boolean;
    hasMercadoPagoLinked?: boolean;
    hasPayPalLinked?: boolean;
    country?: string;
  };
}

export interface RailDecision {
  provider: Provider;
  rail: Rail;
  autonomous: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  fallbacks: Array<{ provider: Provider; rail: Rail; reason: string }>;
}

interface MerchantCaps {
  country: string;
  rails: Rail[];
  preferred?: Rail[];
}

// Top-50-ish merchants we care about. Expand as real usage evolves.
const MERCHANT_REGISTRY: Record<string, MerchantCaps> = {
  // BR — Retail
  magalu:           { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto","mercadopago"], preferred: ["pix_iniciador","pix_manual"] },
  magazine_luiza:   { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto","mercadopago"], preferred: ["pix_iniciador","pix_manual"] },
  mercadolivre:     { country: "BR", rails: ["pix_iniciador","pix_manual","mercadopago","visa_ctp","mastercard_bpa"], preferred: ["mercadopago","pix_iniciador"] },
  amazon_br:        { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto"], preferred: ["pix_iniciador","visa_ctp"] },
  kabum:            { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto","mercadopago"], preferred: ["pix_iniciador","pix_manual"] },
  americanas:       { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto"] },
  casas_bahia:      { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto"] },
  shopee_br:        { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa","boleto"] },
  shein_br:         { country: "BR", rails: ["pix_iniciador","pix_manual","visa_ctp","mastercard_bpa"] },

  // US — Retail
  amazon:           { country: "US", rails: ["skyfire_wallet","visa_ctp","mastercard_bpa","stripe_card"], preferred: ["skyfire_wallet","visa_ctp"] },
  amazon_us:        { country: "US", rails: ["skyfire_wallet","visa_ctp","mastercard_bpa","stripe_card"], preferred: ["skyfire_wallet","visa_ctp"] },
  aliexpress:       { country: "CN", rails: ["skyfire_wallet","visa_ctp","mastercard_bpa","paypal_user","stripe_card"], preferred: ["skyfire_wallet","visa_ctp"] },
  apple:            { country: "US", rails: ["visa_ctp","mastercard_bpa","stripe_card"], preferred: ["visa_ctp"] },
  ebay:             { country: "US", rails: ["visa_ctp","mastercard_bpa","paypal_user","stripe_card"], preferred: ["paypal_user","visa_ctp"] },
  newegg:           { country: "US", rails: ["visa_ctp","mastercard_bpa","paypal_user","stripe_card"] },
  bestbuy:          { country: "US", rails: ["visa_ctp","mastercard_bpa","stripe_card"] },
  walmart:          { country: "US", rails: ["visa_ctp","mastercard_bpa","stripe_card"] },
  shopify:          { country: "US", rails: ["visa_ctp","mastercard_bpa","stripe_card","paypal_user"] },
};

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export function lookupMerchant(
  ctx: Pick<RailContext, "merchantId" | "merchantName" | "merchantDomain">,
): { key: string | null; caps: MerchantCaps | null } {
  const candidates = [ctx.merchantId, ctx.merchantName, ctx.merchantDomain].filter(Boolean) as string[];
  for (const c of candidates) {
    const key = normalizeKey(c);
    if (MERCHANT_REGISTRY[key]) return { key, caps: MERCHANT_REGISTRY[key] };
    // Partial match: `magazine_luiza_br` → starts-with `magazine_luiza`
    const match = Object.keys(MERCHANT_REGISTRY).find((k) => key.includes(k) || k.includes(key));
    if (match) return { key: match, caps: MERCHANT_REGISTRY[match] };
  }
  return { key: null, caps: null };
}

function defaultCapsForCurrency(currency: string, country?: string): MerchantCaps {
  if (currency === "BRL" || country === "BR") {
    return { country: "BR", rails: ["pix_manual","visa_ctp","mastercard_bpa","boleto"], preferred: ["pix_manual"] };
  }
  if (currency === "USD" || country === "US") {
    return { country: "US", rails: ["visa_ctp","mastercard_bpa","stripe_card","paypal_user"], preferred: ["visa_ctp"] };
  }
  return { country: country ?? "XX", rails: ["visa_ctp","mastercard_bpa","stripe_card","paypal_user"] };
}

const RAIL_TO_PROVIDER: Record<Rail, Provider> = {
  pix_iniciador: "pix_provider",  // via celcoin
  pix_manual: "pix_provider",
  visa_ctp: "visa",
  mastercard_bpa: "mastercard",
  skyfire_wallet: "skyfire",
  mercadopago: "mercadopago",
  stripe_card: "stripe",
  paypal_user: "paypal",
  boleto: "pix_provider",
};

const AUTONOMOUS_RAILS = new Set<Rail>(["pix_iniciador","visa_ctp","mastercard_bpa","skyfire_wallet","mercadopago","stripe_card"]);

function canUseRail(rail: Rail, ctx: RailContext, caps: MerchantCaps): { ok: boolean; reason: string } {
  const u = ctx.user || {};
  switch (rail) {
    case "pix_iniciador":
      if (!u.hasIniciadorConsent) return { ok: false, reason: "iniciador_consent_missing" };
      return { ok: true, reason: "pix_autonomous_via_open_finance" };
    case "pix_manual":
      return { ok: true, reason: "pix_qr_user_confirms_in_bank_app" };
    case "visa_ctp":
      if (!u.hasStripeCard) return { ok: false, reason: "no_card_on_file" };
      return { ok: true, reason: "visa_click_to_pay_tokenized" };
    case "mastercard_bpa":
      if (!u.hasStripeCard) return { ok: false, reason: "no_card_on_file" };
      return { ok: true, reason: "mastercard_buyer_payment_agent" };
    case "skyfire_wallet": {
      const usd = ctx.currency === "USD" ? ctx.amount : ctx.amount / 5; // rough BRL→USD
      if (!u.hasSkyfireBalance) return { ok: false, reason: "no_skyfire_balance" };
      if ((u.skyfireBalanceUsd ?? 0) < usd) return { ok: false, reason: "insufficient_skyfire_balance" };
      return { ok: true, reason: `skyfire_agentic_wallet_${u.skyfireBalanceUsd}usd` };
    }
    case "mercadopago":
      if (!u.hasMercadoPagoLinked) return { ok: false, reason: "mp_not_linked" };
      return { ok: true, reason: "mercadopago_balance_or_card" };
    case "stripe_card":
      if (!u.hasStripeCard) return { ok: false, reason: "no_card_on_file" };
      return { ok: true, reason: "stripe_charge_user_card" };
    case "paypal_user":
      if (!u.hasPayPalLinked) return { ok: false, reason: "paypal_not_linked" };
      return { ok: true, reason: "paypal_wallet_or_card" };
    case "boleto":
      return { ok: true, reason: "bank_slip_slow_settlement" };
  }
}

/**
 * Select the best rail for a given payment context.
 * Returns primary decision + ordered fallbacks.
 */
export function selectRail(ctx: RailContext): RailDecision {
  const { caps: foundCaps } = lookupMerchant(ctx);
  const caps = foundCaps ?? defaultCapsForCurrency(ctx.currency, ctx.merchantCountry);
  const merchantKnown = Boolean(foundCaps);

  // Build prioritized rail list: preferred first (if any), then remaining
  const priority = [
    ...(caps.preferred || []),
    ...caps.rails.filter((r) => !(caps.preferred || []).includes(r)),
  ];

  let primary: { rail: Rail; reason: string } | null = null;
  const fallbacks: Array<{ provider: Provider; rail: Rail; reason: string }> = [];

  for (const rail of priority) {
    const check = canUseRail(rail, ctx, caps);
    if (!check.ok) continue;
    if (!primary) {
      primary = { rail, reason: check.reason };
    } else {
      fallbacks.push({ provider: RAIL_TO_PROVIDER[rail], rail, reason: check.reason });
    }
  }

  // Last-resort default
  if (!primary) {
    const fb: Rail = ctx.currency === "BRL" ? "pix_manual" : "stripe_card";
    primary = { rail: fb, reason: "no_eligible_rail_using_default" };
  }

  return {
    provider: RAIL_TO_PROVIDER[primary.rail],
    rail: primary.rail,
    autonomous: AUTONOMOUS_RAILS.has(primary.rail),
    confidence: merchantKnown ? "high" : "low",
    reason: primary.reason,
    fallbacks,
  };
}
