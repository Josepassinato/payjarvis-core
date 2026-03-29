import type { BasePaymentProvider } from "./base.provider.js";
import { StripeProvider } from "./providers/stripe.provider.js";
import { PayPalProvider } from "./providers/paypal.provider.js";
import { SkyfirePaymentProvider } from "./providers/skyfire.provider.js";
import { MercadoPagoProvider } from "./providers/mercadopago.provider.js";

const providers: Record<string, BasePaymentProvider> = {
  stripe: new StripeProvider(),
  paypal: new PayPalProvider(),
  skyfire: new SkyfirePaymentProvider(),
  mercadopago: new MercadoPagoProvider(),
};

export function getPaymentProvider(name: string): BasePaymentProvider {
  const provider = providers[name.toLowerCase()];
  if (!provider) {
    throw new Error(`Unknown payment provider: ${name}`);
  }
  return provider;
}

export function getAvailableProviders(): { name: string; displayName: string; available: boolean }[] {
  return Object.values(providers).map((p) => ({
    name: p.name,
    displayName: p.displayName,
    available: p.isAvailable,
  }));
}

export function getDefaultProvider(): BasePaymentProvider {
  return providers.stripe;
}
