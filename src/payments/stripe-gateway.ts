import { Inject, Injectable, Logger } from "@nestjs/common";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments.config.js";
import { PaymentProviderError, PaymentsNotConfigured } from "./payments.errors.js";

export const FETCH = Symbol("FETCH");
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Talks to the Stripe REST API directly: one endpoint, so no SDK is needed.
@Injectable()
export class StripeGateway {
  private readonly logger = new Logger(StripeGateway.name);

  constructor(
    @Inject(FETCH) private readonly fetch: Fetch,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  async createCheckoutSession(input: {
    accountId: string;
    credits: number;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string }> {
    if (!this.config.stripeSecretKey) throw new PaymentsNotConfigured("payments are not configured");

    const form = new URLSearchParams({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.accountId,
      "line_items[0][quantity]": String(input.credits),
      "line_items[0][price_data][currency]": this.config.currency,
      "line_items[0][price_data][unit_amount]": String(this.config.creditPriceCents),
      "line_items[0][price_data][product_data][name]": "Ledgerline credits",
      "metadata[account_id]": input.accountId,
      "metadata[credits]": String(input.credits),
    });

    let response: Response;
    try {
      response = await this.fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          // Stripe de-duplicates on this key too, so a retried request never makes two sessions.
          "Idempotency-Key": input.idempotencyKey,
        },
        body: form.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      this.logger.error(`Stripe request failed: ${(error as Error).message}`);
      throw new PaymentProviderError("the payment provider could not be reached");
    }

    const body = (await response.json().catch(() => null)) as { id?: string; url?: string } | null;
    if (!response.ok || !body?.id || !body.url) {
      this.logger.error(`Stripe answered ${response.status}`);
      throw new PaymentProviderError("the payment provider refused the request");
    }
    return { id: body.id, url: body.url };
  }
}
