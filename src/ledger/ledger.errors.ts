export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidAmount extends LedgerError {}
export class InvalidIdempotencyKey extends LedgerError {}
export class AccountNotFound extends LedgerError {}
export class DuplicateAccount extends LedgerError {}
export class PurchaseNotFound extends LedgerError {}
export class InsufficientCredits extends LedgerError {}
export class RefundExceedsPurchase extends LedgerError {}
export class IdempotencyConflict extends LedgerError {}
export class EntryNotFound extends LedgerError {}
export class InvalidCursor extends LedgerError {}
