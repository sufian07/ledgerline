import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { Public } from "../http/api-key.guard.js";
import { idempotencyKey } from "../http/schemas.js";
import { LedgerService } from "../ledger/ledger.service.js";
import { PAYMENTS_CONFIG, type PaymentsConfig } from "./payments.config.js";
import { InvalidPaymentEvent, PaymentsNotConfigured } from "./payments.errors.js";
import { PaymentsService } from "./payments.service.js";
import { verifyHooklineSignature, verifyStripeSignature } from "./signatures.js";
import { StripeGateway } from "./stripe-gateway.js";

const returnUrl = z.url({ protocol: /^https?$/ });
const checkoutBody = z
  .object({ credits: z.number().int().min(1).max(100_000), successUrl: returnUrl, cancelUrl: returnUrl })
  .strict();

@Controller()
export class PaymentsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly stripe: StripeGateway,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
  ) {}

  @Post("v1/accounts/:accountId/checkout-sessions")
  @HttpCode(201)
  async startCheckout(
    @Param("accountId") accountId: string,
    @Headers("idempotency-key") key: unknown,
    @Body() body: unknown,
  ) {
    const input = checkoutBody.parse(body);
    const idempotency = idempotencyKey.parse(key);
    await this.ledger.getAccount(accountId);
    return this.stripe.createCheckoutSession({ accountId, idempotencyKey: idempotency, ...input });
  }

  /** Events sent straight from Stripe. */
  @Public()
  @Post("webhooks/stripe")
  @HttpCode(200)
  stripeWebhook(@Req() req: RawBodyRequest<Request>, @Headers("stripe-signature") signature = "") {
    const secret = this.requireSecret(this.config.stripeWebhookSecret);
    const body = rawBody(req);
    if (!verifyStripeSignature({ header: signature, body, secret, now: nowSeconds() })) {
      throw new UnauthorizedException("invalid signature");
    }
    return this.payments.handleStripeEvent(parseEvent(body));
  }

  /** Stripe events relayed by Hookline, which verified Stripe's signature and re-signed them. */
  @Public()
  @Post("webhooks/hookline")
  @HttpCode(200)
  hooklineWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hookline-timestamp") timestamp = "",
    @Headers("x-hookline-signature") signature = "",
  ) {
    const secret = this.requireSecret(this.config.hooklineSecret);
    const body = rawBody(req);
    if (!verifyHooklineSignature({ timestamp, signature, body, secret, now: nowSeconds() })) {
      throw new UnauthorizedException("invalid signature");
    }
    return this.payments.handleStripeEvent(parseEvent(body));
  }

  private requireSecret(secret: string | undefined): string {
    if (!secret) throw new PaymentsNotConfigured("this webhook is not configured");
    return secret;
  }
}

function rawBody(req: RawBodyRequest<Request>): string {
  return req.rawBody?.toString("utf8") ?? "";
}

function parseEvent(body: string) {
  try {
    const event: unknown = JSON.parse(body);
    if (event && typeof event === "object") return event as { type?: unknown; data?: { object?: unknown } };
  } catch {
    // fall through
  }
  throw new InvalidPaymentEvent("event body is not a JSON object");
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
