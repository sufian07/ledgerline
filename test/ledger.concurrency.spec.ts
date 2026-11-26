import { describe, expect, it } from "vitest";
import { InsufficientCredits } from "../src/ledger/ledger.errors.js";
import { LedgerService } from "../src/ledger/ledger.service.js";
import { useDatabase } from "./database.js";

const db = useDatabase();
const ledger = () => new LedgerService(db());

describe("under concurrent requests", () => {
  it("lets exactly as many spends succeed as the balance allows", async () => {
    const account = await ledger().openAccount("cust_1");
    await ledger().purchase({ accountId: account.id, amount: 20, idempotencyKey: "buy" });

    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, n) => ledger().spend({ accountId: account.id, amount: 1, idempotencyKey: `spend-${n}` })),
    );

    const failures = results.filter((r) => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(failures).toHaveLength(30);
    expect(failures.every((f) => f.status === "rejected" && f.reason instanceof InsufficientCredits)).toBe(true);
    expect(await ledger().balance(account.id)).toBe(0);
    expect((await ledger().verify()).ok).toBe(true);
  });

  it("applies a request sent many times at once exactly once", async () => {
    const account = await ledger().openAccount("cust_1");

    const results = await Promise.all(
      Array.from({ length: 20 }, () => ledger().purchase({ accountId: account.id, amount: 50, idempotencyKey: "same-key" })),
    );

    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await ledger().balance(account.id)).toBe(50);
  });

  it("never lets concurrent refunds exceed the purchase", async () => {
    const account = await ledger().openAccount("cust_1");
    const purchase = await ledger().purchase({ accountId: account.id, amount: 100, idempotencyKey: "buy" });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, n) =>
        ledger().refund({ purchaseId: purchase.entry.id, amount: 30, idempotencyKey: `refund-${n}` }),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await ledger().balance(account.id)).toBe(10);
    expect((await ledger().verify()).ok).toBe(true);
  });
});
