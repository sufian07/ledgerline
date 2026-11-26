import { Injectable } from "@nestjs/common";
import { AccountNotFound } from "../ledger/ledger.errors.js";
import { LedgerService, MAX_AMOUNT } from "../ledger/ledger.service.js";
import { InvalidPaymentEvent, PaymentAccountNotFound } from "./payments.errors.js";

const PAID_CHECKOUT_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export type PaymentOutcome = { status: "credited" | "replayed"; entryId: string } | { status: "ignored" };

interface CheckoutSession {
  id?: unknown;
  payment_status?: unknown;
  metadata?: { account_id?: unknown; credits?: unknown };
}

@Injectable()
export class PaymentsService {
  constructor(private readonly ledger: LedgerService) {}

  // Applies a verified Stripe event. Both checkout events for one session map to the
  // same idempotency key, so the account is credited once however often they arrive.
  async handleStripeEvent(event: { type?: unknown; data?: { object?: unknown } }): Promise<PaymentOutcome> {
    if (typeof event.type !== "string" || !PAID_CHECKOUT_EVENTS.has(event.type)) return { status: "ignored" };

    const session = (event.data?.object ?? {}) as CheckoutSession;
    if (session.payment_status !== "paid") return { status: "ignored" };

    const sessionId = session.id;
    const accountId = session.metadata?.account_id;
    const credits = session.metadata?.credits;
    if (typeof sessionId !== "string" || typeof accountId !== "string" || typeof credits !== "string") {
      throw new InvalidPaymentEvent("checkout session is missing its id, account or credits");
    }
    if (!/^[1-9]\d{0,9}$/.test(credits) || Number(credits) > MAX_AMOUNT) {
      throw new InvalidPaymentEvent("checkout session has an invalid credit amount");
    }

    try {
      const result = await this.ledger.purchase({
        accountId,
        amount: Number(credits),
        idempotencyKey: `stripe:checkout:${sessionId}`,
        reference: sessionId,
      });
      return { status: result.replayed ? "replayed" : "credited", entryId: result.entry.id };
    } catch (error) {
      if (error instanceof AccountNotFound) throw new PaymentAccountNotFound(error.message);
      throw error;
    }
  }
}
