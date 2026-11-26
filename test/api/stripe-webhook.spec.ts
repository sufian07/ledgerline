import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { auth, STRIPE_WEBHOOK_SECRET, useApp } from "../app.js";
import { useDatabase } from "../database.js";
import { checkoutCompleted, stripeSignature } from "../stripe.js";

useDatabase();
const app = useApp();
const http = () => request(app().getHttpServer());
let accountId: string;

beforeEach(async () => {
  accountId = (await http().post("/v1/accounts").set(auth).send({ code: "cust_1" })).body.id;
});

function deliver(event: object, secret = STRIPE_WEBHOOK_SECRET) {
  const body = JSON.stringify(event);
  return http()
    .post("/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", stripeSignature(body, secret))
    .send(body);
}

const balance = async () => (await http().get(`/v1/accounts/${accountId}`).set(auth)).body.balance;

it("credits the account once when a checkout is paid", async () => {
  const res = await deliver(checkoutCompleted({ accountId }));

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: "credited", entryId: expect.any(String) });
  expect(await balance()).toBe(100);
});

it("treats a redelivered event, or a second event for the same checkout, as already applied", async () => {
  await deliver(checkoutCompleted({ accountId }));

  const again = await deliver(checkoutCompleted({ accountId }));
  const asyncEvent = await deliver(
    checkoutCompleted({ accountId, id: "evt_test_2", type: "checkout.session.async_payment_succeeded" }),
  );

  expect(again.body.status).toBe("replayed");
  expect(asyncEvent.body.status).toBe("replayed");
  expect(await balance()).toBe(100);
});

it("ignores unpaid checkouts and other event types", async () => {
  const unpaid = await deliver(checkoutCompleted({ accountId, paymentStatus: "unpaid" }));
  const other = await deliver({ id: "evt_x", type: "customer.created", data: { object: {} } });

  expect(unpaid.body).toEqual({ status: "ignored" });
  expect(other.body).toEqual({ status: "ignored" });
  expect(await balance()).toBe(0);
});

it("rejects a bad signature without applying anything", async () => {
  const res = await deliver(checkoutCompleted({ accountId }), "whsec_wrong");

  expect(res.status).toBe(401);
  expect(await balance()).toBe(0);
});

it("answers 422 when a paid checkout cannot be applied, so the sender retries and it stays visible", async () => {
  const unknown = await deliver(checkoutCompleted({ accountId: "00000000-0000-0000-0000-000000000000" }));
  expect(unknown.status).toBe(422);
  expect(unknown.body.error.code).toBe("account_not_found");

  const badCredits = await deliver(checkoutCompleted({ accountId, credits: "lots", sessionId: "cs_test_2" }));
  expect(badCredits.status).toBe(422);
  expect(badCredits.body.error.code).toBe("invalid_payment_event");
});

it("does not need the API key, only the signature", async () => {
  const res = await deliver(checkoutCompleted({ accountId }));

  expect(res.status).toBe(200);
});
