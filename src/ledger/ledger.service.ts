import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Kysely, Selectable, Transaction } from "kysely";
import { KYSELY } from "../db/database.module.js";
import type { Database, EntriesTable, EntryKind } from "../db/schema.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import {
  AccountNotFound,
  EntryNotFound,
  DuplicateAccount,
  IdempotencyConflict,
  InsufficientCredits,
  InvalidAmount,
  InvalidIdempotencyKey,
  PurchaseNotFound,
  RefundExceedsPurchase,
} from "./ledger.errors.js";

export const MAX_AMOUNT = 1_000_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAYMENTS = "payments";
const REVENUE = "revenue";

export interface Account {
  id: string;
  code: string;
  balance: number;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  accountId: string;
  amount: number;
  refundOf: string | null;
  reference: string | null;
  createdAt: Date;
}

export interface EntryResult {
  entry: Entry;
  /** The customer's balance after this entry (or now, for a replayed request). */
  balance: number;
  /** True when the idempotency key was already used for this same request. */
  replayed: boolean;
}

interface MoveInput {
  accountId: string;
  amount: number;
  idempotencyKey: string;
  reference?: string;
}

interface RefundInput {
  purchaseId: string;
  amount: number;
  idempotencyKey: string;
  reference?: string;
}

interface Leg {
  accountId: string;
  amount: number;
}

type Trx = Transaction<Database>;

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async getAccount(accountId: string): Promise<Account> {
    return this.findCustomer(this.db, accountId);
  }

  async listAccounts(page: { limit: number; cursor?: string }): Promise<Page<Account>> {
    const before = decodeCursor(page.cursor);
    let query = this.db
      .selectFrom("accounts")
      .select(["id", "code", "balance", "seq"])
      .where("kind", "=", "customer")
      .orderBy("seq", "desc")
      .limit(page.limit + 1);
    if (before) query = query.where("seq", "<", before);
    return toPage(await query.execute(), page.limit, ({ id, code, balance }) => ({ id, code, balance }));
  }

  async listEntries(accountId: string, page: { limit: number; cursor?: string }): Promise<Page<Entry>> {
    const before = decodeCursor(page.cursor);
    await this.findCustomer(this.db, accountId);
    let query = this.db
      .selectFrom("entries")
      .selectAll()
      .where("account_id", "=", accountId)
      .orderBy("seq", "desc")
      .limit(page.limit + 1);
    if (before) query = query.where("seq", "<", before);
    return toPage(await query.execute(), page.limit, toEntry);
  }

  async getEntry(entryId: string): Promise<Entry> {
    const row = UUID.test(entryId)
      ? await this.db.selectFrom("entries").selectAll().where("id", "=", entryId).executeTakeFirst()
      : undefined;
    if (!row) throw new EntryNotFound(`entry ${entryId} not found`);
    return toEntry(row);
  }

  async openAccount(code: string): Promise<Account> {
    try {
      const row = await this.db
        .insertInto("accounts")
        .values({ kind: "customer", code })
        .returning(["id", "code", "balance"])
        .executeTakeFirstOrThrow();
      return row;
    } catch (error) {
      if (isPgError(error, "23505")) throw new DuplicateAccount(`account ${code} already exists`);
      throw error;
    }
  }

  async balance(accountId: string): Promise<number> {
    const row = await this.findCustomer(this.db, accountId);
    return row.balance;
  }

  /** Credits bought with real money: payments account to customer. */
  purchase(input: MoveInput): Promise<EntryResult> {
    return this.record("purchase", input, null, async (trx) => {
      await this.findCustomer(trx, input.accountId);
      return {
        accountId: input.accountId,
        legs: async () => [
          { accountId: await this.systemAccountId(trx, PAYMENTS), amount: -input.amount },
          { accountId: input.accountId, amount: input.amount },
        ],
      };
    });
  }

  /** Credits used up: customer to revenue. Fails rather than going below zero. */
  spend(input: MoveInput): Promise<EntryResult> {
    return this.record("spend", input, null, async (trx) => {
      await this.findCustomer(trx, input.accountId);
      return {
        accountId: input.accountId,
        legs: async () => [
          { accountId: input.accountId, amount: -input.amount },
          { accountId: await this.systemAccountId(trx, REVENUE), amount: input.amount },
        ],
      };
    });
  }

  /** Returns credits of one purchase: customer back to payments, never more than was bought. */
  refund(input: RefundInput): Promise<EntryResult> {
    return this.record("refund", input, input.purchaseId, async (trx) => {
      // Lock the purchase before anything else: refunds of it then run one at a time,
      // so their total is checked safely. Locking after inserting the refund (whose
      // foreign key already holds a share lock on the purchase) would deadlock.
      const purchase = await this.findPurchase(trx, input.purchaseId, { lock: true });
      return {
        accountId: purchase.account_id,
        legs: async (entryId) => {
          const refunded = await trx
            .selectFrom("entries")
            .select((eb) => eb.fn.coalesce(eb.fn.sum<number>("amount"), eb.lit(0)).as("total"))
            .where("refund_of", "=", purchase.id)
            .where("id", "<>", entryId)
            .executeTakeFirstOrThrow();
          if (Number(refunded.total) + input.amount > purchase.amount) {
            throw new RefundExceedsPurchase(`refunds would exceed purchase ${purchase.id}`);
          }
          return [
            { accountId: purchase.account_id, amount: -input.amount },
            { accountId: await this.systemAccountId(trx, PAYMENTS), amount: input.amount },
          ];
        },
      };
    });
  }

  /** Recomputes every balance from the postings and reports any that disagree. */
  async verify(): Promise<{ ok: boolean; drifted: { accountId: string; stored: number; computed: number }[] }> {
    const rows = await this.db
      .selectFrom("accounts as a")
      .leftJoin("postings as p", "p.account_id", "a.id")
      .select((eb) => [
        "a.id",
        "a.balance",
        eb.fn.coalesce(eb.fn.sum<number>("p.amount"), eb.lit(0)).as("computed"),
      ])
      .groupBy("a.id")
      .execute();
    const drifted = rows
      .filter((row) => Number(row.computed) !== row.balance)
      .map((row) => ({ accountId: row.id, stored: row.balance, computed: Number(row.computed) }));
    return { ok: drifted.length === 0, drifted };
  }

  private async record(
    kind: EntryKind,
    input: { amount: number; idempotencyKey: string; reference?: string },
    refundOf: string | null,
    prepare: (trx: Trx) => Promise<{ accountId: string; legs: (entryId: string) => Promise<Leg[]> }>,
  ): Promise<EntryResult> {
    assertAmount(input.amount);
    assertIdempotencyKey(input.idempotencyKey);
    const requestHash = hashRequest(kind, input, refundOf);

    return this.db.transaction().execute(async (trx) => {
      const { accountId, legs } = await prepare(trx);

      // Concurrent requests with one key wait here for the first to commit, then see it.
      const inserted = await trx
        .insertInto("entries")
        .values({
          kind,
          idempotency_key: input.idempotencyKey,
          request_hash: requestHash,
          account_id: accountId,
          amount: input.amount,
          refund_of: refundOf,
          reference: input.reference ?? null,
        })
        .onConflict((oc) => oc.column("idempotency_key").doNothing())
        .returningAll()
        .executeTakeFirst();

      if (!inserted) return this.replay(trx, input.idempotencyKey, requestHash);

      const balance = await this.post(trx, inserted.id, await legs(inserted.id), accountId);
      return { entry: toEntry(inserted), balance, replayed: false };
    });
  }

  private async post(trx: Trx, entryId: string, legs: Leg[], customerId: string): Promise<number> {
    let customerBalance = 0;
    // A fixed lock order (by account id) avoids deadlocks between concurrent entries.
    for (const leg of [...legs].sort((a, b) => a.accountId.localeCompare(b.accountId))) {
      const updated = await trx
        .updateTable("accounts")
        .set((eb) => ({ balance: eb("balance", "+", leg.amount) }))
        .where("id", "=", leg.accountId)
        .where((eb) => eb.or([eb("allow_negative", "=", true), eb(eb("balance", "+", leg.amount), ">=", 0)]))
        .returning("balance")
        .executeTakeFirst();
      if (!updated) throw new InsufficientCredits(`not enough credits in account ${leg.accountId}`);
      if (leg.accountId === customerId) customerBalance = updated.balance;
    }
    await trx
      .insertInto("postings")
      .values(legs.map((leg) => ({ entry_id: entryId, account_id: leg.accountId, amount: leg.amount })))
      .execute();
    return customerBalance;
  }

  private async replay(trx: Trx, idempotencyKey: string, requestHash: string): Promise<EntryResult> {
    const existing = await trx
      .selectFrom("entries")
      .selectAll()
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirstOrThrow();
    if (existing.request_hash !== requestHash) {
      throw new IdempotencyConflict(`idempotency key ${idempotencyKey} was used for a different request`);
    }
    const account = await this.findCustomer(trx, existing.account_id);
    return { entry: toEntry(existing), balance: account.balance, replayed: true };
  }

  private async findCustomer(db: Kysely<Database>, accountId: string) {
    const row = UUID.test(accountId)
      ? await db
          .selectFrom("accounts")
          .select(["id", "code", "balance"])
          .where("id", "=", accountId)
          .where("kind", "=", "customer")
          .executeTakeFirst()
      : undefined;
    if (!row) throw new AccountNotFound(`account ${accountId} not found`);
    return row;
  }

  private async findPurchase(db: Kysely<Database>, purchaseId: string, { lock = false } = {}) {
    let query = db
      .selectFrom("entries")
      .select(["id", "account_id", "amount"])
      .where("id", "=", purchaseId)
      .where("kind", "=", "purchase");
    if (lock) query = query.forUpdate();
    const row = UUID.test(purchaseId) ? await query.executeTakeFirst() : undefined;
    if (!row) throw new PurchaseNotFound(`purchase ${purchaseId} not found`);
    return row;
  }

  private async systemAccountId(db: Kysely<Database>, code: string): Promise<string> {
    const row = await db
      .selectFrom("accounts")
      .select("id")
      .where("kind", "=", "system")
      .where("code", "=", code)
      .executeTakeFirstOrThrow();
    return row.id;
  }
}

function assertAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    throw new InvalidAmount(`amount must be a whole number from 1 to ${MAX_AMOUNT}`);
  }
}

function assertIdempotencyKey(key: string) {
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    throw new InvalidIdempotencyKey("idempotency key must be 1 to 200 characters");
  }
}

function hashRequest(kind: EntryKind, input: object, refundOf: string | null): string {
  const { idempotencyKey: _key, ...rest } = input as { idempotencyKey: string } & Record<string, unknown>;
  const canonical = JSON.stringify({ kind, refundOf, ...rest }, Object.keys({ kind, refundOf, ...rest }).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

function toPage<R extends { seq: number }, T>(rows: R[], limit: number, map: (row: R) => T): Page<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { data: items.map(map), nextCursor: rows.length > limit && last ? encodeCursor(last.seq) : null };
}

function toEntry(row: Selectable<EntriesTable>): Entry {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id,
    amount: row.amount,
    refundOf: row.refund_of,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

function isPgError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
