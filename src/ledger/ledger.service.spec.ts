import { sql } from "kysely";
import { describe, expect, it } from "vitest";
import { useDatabase } from "../../test/database.js";
import {
  AccountNotFound,
  DuplicateAccount,
  IdempotencyConflict,
  InsufficientCredits,
  InvalidAmount,
  PurchaseNotFound,
  RefundExceedsPurchase,
} from "./ledger.errors.js";
import { LedgerService, MAX_AMOUNT } from "./ledger.service.js";

const db = useDatabase();
const ledger = () => new LedgerService(db());

async function fundedAccount(credits = 100) {
  const account = await ledger().openAccount("cust_1");
  const purchase = await ledger().purchase({ accountId: account.id, amount: credits, idempotencyKey: "buy-1" });
  return { account, purchase };
}

describe("accounts", () => {
  it("opens a customer account with a zero balance", async () => {
    const account = await ledger().openAccount("cust_1");

    expect(account).toMatchObject({ code: "cust_1", balance: 0 });
    expect(await ledger().balance(account.id)).toBe(0);
  });

  it("refuses a second account with the same code", async () => {
    await ledger().openAccount("cust_1");

    await expect(ledger().openAccount("cust_1")).rejects.toThrow(DuplicateAccount);
  });

  it("reports an unknown account", async () => {
    await expect(ledger().balance("00000000-0000-0000-0000-000000000000")).rejects.toThrow(AccountNotFound);
  });
});

describe("purchase", () => {
  it("credits the customer from the payments account", async () => {
    const { account, purchase } = await fundedAccount(100);

    expect(purchase).toMatchObject({ balance: 100, replayed: false });
    expect(purchase.entry).toMatchObject({ kind: "purchase", accountId: account.id, amount: 100 });
    expect(await ledger().balance(account.id)).toBe(100);
  });

  it("only accepts whole, positive amounts up to the maximum", async () => {
    const account = await ledger().openAccount("cust_1");

    for (const amount of [0, -5, 1.5, MAX_AMOUNT + 1, Number.NaN]) {
      await expect(
        ledger().purchase({ accountId: account.id, amount, idempotencyKey: `k-${amount}` }),
      ).rejects.toThrow(InvalidAmount);
    }
  });

  it("refuses an unknown account and records nothing", async () => {
    await expect(
      ledger().purchase({ accountId: "00000000-0000-0000-0000-000000000000", amount: 5, idempotencyKey: "k" }),
    ).rejects.toThrow(AccountNotFound);

    expect(await db().selectFrom("entries").select("id").execute()).toHaveLength(0);
  });
});

describe("spend", () => {
  it("moves credits from the customer to revenue", async () => {
    const { account } = await fundedAccount(100);

    const result = await ledger().spend({ accountId: account.id, amount: 30, idempotencyKey: "spend-1", reference: "lead_42" });

    expect(result).toMatchObject({ balance: 70, entry: { kind: "spend", amount: 30, reference: "lead_42" } });
  });

  it("refuses to overspend and records nothing", async () => {
    const { account } = await fundedAccount(10);

    await expect(ledger().spend({ accountId: account.id, amount: 11, idempotencyKey: "spend-1" })).rejects.toThrow(
      InsufficientCredits,
    );

    expect(await ledger().balance(account.id)).toBe(10);
    expect(await db().selectFrom("entries").where("kind", "=", "spend").select("id").execute()).toHaveLength(0);
  });
});

describe("refund", () => {
  it("returns credits from a purchase back to the payments account", async () => {
    const { account, purchase } = await fundedAccount(100);

    const result = await ledger().refund({ purchaseId: purchase.entry.id, amount: 40, idempotencyKey: "refund-1" });

    expect(result).toMatchObject({ balance: 60, entry: { kind: "refund", refundOf: purchase.entry.id, accountId: account.id } });
  });

  it("never refunds more than was purchased, across several refunds", async () => {
    const { purchase } = await fundedAccount(100);
    await ledger().refund({ purchaseId: purchase.entry.id, amount: 70, idempotencyKey: "refund-1" });

    await expect(
      ledger().refund({ purchaseId: purchase.entry.id, amount: 31, idempotencyKey: "refund-2" }),
    ).rejects.toThrow(RefundExceedsPurchase);
  });

  it("cannot refund credits that were already spent", async () => {
    const { account, purchase } = await fundedAccount(100);
    await ledger().spend({ accountId: account.id, amount: 90, idempotencyKey: "spend-1" });

    await expect(
      ledger().refund({ purchaseId: purchase.entry.id, amount: 20, idempotencyKey: "refund-1" }),
    ).rejects.toThrow(InsufficientCredits);
  });

  it("only refunds purchases", async () => {
    const { account } = await fundedAccount(100);
    const spend = await ledger().spend({ accountId: account.id, amount: 5, idempotencyKey: "spend-1" });

    await expect(ledger().refund({ purchaseId: spend.entry.id, amount: 1, idempotencyKey: "r" })).rejects.toThrow(
      PurchaseNotFound,
    );
  });
});

describe("idempotency", () => {
  it("returns the original result when a request is repeated", async () => {
    const { account, purchase } = await fundedAccount(100);

    const again = await ledger().purchase({ accountId: account.id, amount: 100, idempotencyKey: "buy-1" });

    expect(again).toMatchObject({ replayed: true, entry: { id: purchase.entry.id } });
    expect(await ledger().balance(account.id)).toBe(100);
  });

  it("refuses to reuse a key for a different request", async () => {
    const { account } = await fundedAccount(100);

    await expect(ledger().purchase({ accountId: account.id, amount: 99, idempotencyKey: "buy-1" })).rejects.toThrow(
      IdempotencyConflict,
    );
    await expect(ledger().spend({ accountId: account.id, amount: 100, idempotencyKey: "buy-1" })).rejects.toThrow(
      IdempotencyConflict,
    );
  });
});

describe("integrity", () => {
  it("records every entry as postings that sum to zero", async () => {
    const { account, purchase } = await fundedAccount(100);
    await ledger().spend({ accountId: account.id, amount: 30, idempotencyKey: "spend-1" });
    await ledger().refund({ purchaseId: purchase.entry.id, amount: 20, idempotencyKey: "refund-1" });

    const sums = await db()
      .selectFrom("postings")
      .select(["entry_id", sql<number>`sum(amount)::bigint`.as("total")])
      .groupBy("entry_id")
      .execute();
    expect(sums).toHaveLength(3);
    expect(sums.map((s) => s.total)).toEqual([0, 0, 0]);
  });

  it("finds no drift in a healthy ledger", async () => {
    const { account } = await fundedAccount(100);
    await ledger().spend({ accountId: account.id, amount: 30, idempotencyKey: "spend-1" });

    expect(await ledger().verify()).toEqual({ ok: true, drifted: [] });
  });

  it("detects a stored balance that no longer matches the postings", async () => {
    const { account } = await fundedAccount(100);
    await sql`update accounts set balance = 999 where id = ${account.id}`.execute(db());

    expect(await ledger().verify()).toEqual({
      ok: false,
      drifted: [{ accountId: account.id, stored: 999, computed: 100 }],
    });
  });

  it("makes the database reject an unbalanced entry", async () => {
    const { account, purchase } = await fundedAccount(100);

    await expect(
      db()
        .insertInto("postings")
        .values({ entry_id: purchase.entry.id, account_id: account.id, amount: 5 })
        .execute(),
    ).rejects.toThrow(/not balanced/);
  });

  it("makes postings and entries append-only", async () => {
    const { purchase } = await fundedAccount(100);

    await expect(sql`update postings set amount = 1`.execute(db())).rejects.toThrow(/append-only/);
    await expect(sql`delete from entries where id = ${purchase.entry.id}`.execute(db())).rejects.toThrow(/append-only/);
  });

  it("makes the database refuse a negative customer balance", async () => {
    const { account } = await fundedAccount(10);

    await expect(sql`update accounts set balance = -1 where id = ${account.id}`.execute(db())).rejects.toThrow(
      /accounts_balance_not_negative/,
    );
  });
});
