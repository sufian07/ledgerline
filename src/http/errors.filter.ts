import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import {
  AccountNotFound,
  DuplicateAccount,
  EntryNotFound,
  IdempotencyConflict,
  InsufficientCredits,
  InvalidAmount,
  InvalidCursor,
  InvalidIdempotencyKey,
  PurchaseNotFound,
  RefundExceedsPurchase,
} from "../ledger/ledger.errors.js";
import {
  InvalidPaymentEvent,
  PaymentAccountNotFound,
  PaymentProviderError,
  PaymentsNotConfigured,
} from "../payments/payments.errors.js";

const KNOWN_ERRORS: [new (...args: never[]) => Error, number, string][] = [
  [InvalidAmount, 400, "invalid_request"],
  [InvalidIdempotencyKey, 400, "invalid_request"],
  [InvalidCursor, 400, "invalid_request"],
  [AccountNotFound, 404, "account_not_found"],
  [PurchaseNotFound, 404, "purchase_not_found"],
  [EntryNotFound, 404, "entry_not_found"],
  [DuplicateAccount, 409, "duplicate_account"],
  [IdempotencyConflict, 409, "idempotency_conflict"],
  [InsufficientCredits, 422, "insufficient_credits"],
  [RefundExceedsPurchase, 422, "refund_exceeds_purchase"],
  [PaymentAccountNotFound, 422, "account_not_found"],
  [InvalidPaymentEvent, 422, "invalid_payment_event"],
  [PaymentProviderError, 502, "payment_provider_error"],
  [PaymentsNotConfigured, 503, "payments_not_configured"],
];

const HTTP_CODES: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  404: "not_found",
  413: "payload_too_large",
};

// Every error leaves the API in one shape: { error: { code, message, details? } }.
@Catch()
export class ErrorsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.describe(exception);
    response.status(status).json({ error: body });
  }

  private describe(exception: unknown): [number, { code: string; message: string; details?: unknown }] {
    const known = KNOWN_ERRORS.find(([type]) => exception instanceof type);
    if (known && exception instanceof Error) return [known[1], { code: known[2], message: exception.message }];

    if (exception instanceof ZodError) {
      const details = exception.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
      return [400, { code: "invalid_request", message: "the request is not valid", details }];
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return [status, { code: HTTP_CODES[status] ?? "http_error", message: exception.message }];
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    return [500, { code: "internal_error", message: "something went wrong" }];
  }
}
