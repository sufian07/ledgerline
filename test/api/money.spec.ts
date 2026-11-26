import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { auth, useApp } from "../app.js";
import { useDatabase } from "../database.js";

useDatabase();
const app = useApp();
const http = () => request(app().getHttpServer());
let accountId: string;

beforeEach(async () => {
  accountId = (await http().post("/v1/accounts").set(auth).send({ code: "cust_1" })).body.id;
});

function purchase(amount: number, key = "buy-1") {
  return http().post(`/v1/accounts/${accountId}/purchases`).set(auth).set("Idempotency-Key", key).send({ amount });
}

it("records a purchase and returns the new balance", async () => {
  const res = await purchase(100);

  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ balance: 100, entry: { kind: "purchase", amount: 100, accountId } });
  expect(res.headers["idempotent-replayed"]).toBeUndefined();
});

it("replays a repeated request with 200 and a header", async () => {
  const first = await purchase(100);
  const again = await purchase(100);

  expect(again.status).toBe(200);
  expect(again.headers["idempotent-replayed"]).toBe("true");
  expect(again.body.entry.id).toBe(first.body.entry.id);
  expect(again.body.balance).toBe(100);
});

it("requires an Idempotency-Key header on money movements", async () => {
  const res = await http().post(`/v1/accounts/${accountId}/purchases`).set(auth).send({ amount: 5 });

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("invalid_request");
});

it("rejects amounts that are not whole positive numbers", async () => {
  for (const amount of ["10", 0, -1, 2.5, null]) {
    const res = await http()
      .post(`/v1/accounts/${accountId}/purchases`)
      .set(auth)
      .set("Idempotency-Key", `k-${String(amount)}`)
      .send({ amount });

    expect(res.status, String(amount)).toBe(400);
  }
});

it("spends credits and refuses to overspend with 422", async () => {
  await purchase(10);

  const ok = await http().post(`/v1/accounts/${accountId}/spends`).set(auth).set("Idempotency-Key", "s1").send({ amount: 4, reference: "lead_7" });
  expect(ok.status).toBe(201);
  expect(ok.body).toMatchObject({ balance: 6, entry: { kind: "spend", reference: "lead_7" } });

  const over = await http().post(`/v1/accounts/${accountId}/spends`).set(auth).set("Idempotency-Key", "s2").send({ amount: 7 });
  expect(over.status).toBe(422);
  expect(over.body.error.code).toBe("insufficient_credits");
});

it("refunds part of a purchase, never more than it", async () => {
  const bought = await purchase(100);
  const refundUrl = `/v1/purchases/${bought.body.entry.id}/refunds`;

  const ok = await http().post(refundUrl).set(auth).set("Idempotency-Key", "r1").send({ amount: 60 });
  expect(ok.status).toBe(201);
  expect(ok.body).toMatchObject({ balance: 40, entry: { kind: "refund", refundOf: bought.body.entry.id } });

  const over = await http().post(refundUrl).set(auth).set("Idempotency-Key", "r2").send({ amount: 41 });
  expect(over.status).toBe(422);
  expect(over.body.error.code).toBe("refund_exceeds_purchase");

  const missing = await http().post("/v1/purchases/00000000-0000-0000-0000-000000000000/refunds").set(auth).set("Idempotency-Key", "r3").send({ amount: 1 });
  expect(missing.status).toBe(404);
  expect(missing.body.error.code).toBe("purchase_not_found");
});

it("refuses to reuse a key for a different request with 409", async () => {
  await purchase(100, "same");

  const res = await purchase(99, "same");

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("idempotency_conflict");
});

it("lists an account's entries newest first, a page at a time", async () => {
  await purchase(100);
  for (const n of [1, 2, 3]) {
    await http().post(`/v1/accounts/${accountId}/spends`).set(auth).set("Idempotency-Key", `s${n}`).send({ amount: n });
  }

  const first = await http().get(`/v1/accounts/${accountId}/entries?limit=3`).set(auth);
  expect(first.status).toBe(200);
  expect(first.body.data.map((e: { amount: number }) => e.amount)).toEqual([3, 2, 1]);
  expect(first.body.nextCursor).toEqual(expect.any(String));

  const second = await http().get(`/v1/accounts/${accountId}/entries?limit=3&cursor=${first.body.nextCursor}`).set(auth);
  expect(second.body.data.map((e: { kind: string }) => e.kind)).toEqual(["purchase"]);
  expect(second.body.nextCursor).toBeNull();
});

it("reports a healthy ledger", async () => {
  await purchase(100);

  const res = await http().get("/v1/ledger/verify").set(auth);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, drifted: [] });
});
