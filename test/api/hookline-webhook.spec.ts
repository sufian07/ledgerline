import request from "supertest";
import { beforeEach, expect, it } from "vitest";
import { auth, HOOKLINE_SECRET, useApp } from "../app.js";
import { useDatabase } from "../database.js";
import { checkoutCompleted, hooklineHeaders } from "../stripe.js";

useDatabase();
const app = useApp();
const http = () => request(app().getHttpServer());
let accountId: string;

beforeEach(async () => {
  accountId = (await http().post("/v1/accounts").set(auth).send({ code: "cust_1" })).body.id;
});

function relay(event: object, secret = HOOKLINE_SECRET, at?: number) {
  const body = JSON.stringify(event);
  return http().post("/webhooks/hookline").set(hooklineHeaders(body, secret, at)).send(body);
}

it("applies a Stripe event relayed and signed by Hookline", async () => {
  const res = await relay(checkoutCompleted({ accountId }));

  expect(res.status).toBe(200);
  expect(res.body.status).toBe("credited");
  expect((await http().get(`/v1/accounts/${accountId}`).set(auth)).body.balance).toBe(100);
});

it("rejects a wrong or stale Hookline signature", async () => {
  expect((await relay(checkoutCompleted({ accountId }), "wrong")).status).toBe(401);
  expect((await relay(checkoutCompleted({ accountId }), HOOKLINE_SECRET, Math.floor(Date.now() / 1000) - 600)).status).toBe(401);
});
