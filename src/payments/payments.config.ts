export const PAYMENTS_CONFIG = Symbol("PAYMENTS_CONFIG");

export interface PaymentsConfig {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  hooklineSecret?: string;
  creditPriceCents: number;
  currency: string;
}

// Payments are optional: without Stripe keys the ledger still works and checkout answers 503.
export function paymentsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentsConfig {
  const price = Number(env.LEDGERLINE_CREDIT_PRICE_CENTS ?? 10);
  if (!Number.isInteger(price) || price < 1) throw new Error("LEDGERLINE_CREDIT_PRICE_CENTS must be a whole number of cents");
  return {
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
    hooklineSecret: env.LEDGERLINE_HOOKLINE_SECRET || undefined,
    creditPriceCents: price,
    currency: (env.LEDGERLINE_CURRENCY ?? "usd").toLowerCase(),
  };
}
