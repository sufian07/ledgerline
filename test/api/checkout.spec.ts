import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { FETCH } from "../../src/payments/stripe-gateway.js";
import { auth, STRIPE_SECRET_KEY, useApp } from "../app.js";
import { useDatabase } from "../database.js";

const stripeFetch = vi.fn();
useDatabase();
const app = useApp({ override: (builder) => builder.overrideProvider(FETCH).useValue(stripeFetch) });
const http = () => request(app().getHttpServer());

async function openAccount() {
  return (await http().post("/v1/accounts").set(auth).send({ code: "cust_1" })).body.id as string;
}

function startCheckout(accountId: string, body: object = { credits: 250 }) {
  return http()
    .post(`/v1/accounts/${accountId}/checkout-sessions`)
    .set(auth)
    .set("Idempotency-Key", "checkout-1")
    .send({ successUrl: "https://shop.example.com/ok", cancelUrl: "https://shop.example.com/cancel", ...body });
}

describe("POST /v1/accounts/{id}/checkout-sessions", () => {
  it("creates a Stripe Checkout session priced from the credits", async () => {
    stripeFetch.mockReset().mockResolvedValue(
      Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }),
    );
    const accountId = await openAccount();

    const res = await startCheckout(accountId);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" });

    const [url, init] = stripeFetch.mock.calls[0];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Idempotency-Key": "checkout-1" });
    const form = new URLSearchParams(init.body);
    expect(form.get("mode")).toBe("payment");
    expect(form.get("line_items[0][quantity]")).toBe("250");
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("10");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(form.get("metadata[account_id]")).toBe(accountId);
    expect(form.get("metadata[credits]")).toBe("250");
    expect(form.get("success_url")).toBe("https://shop.example.com/ok");
  });

  it("checks the account before calling Stripe", async () => {
    stripeFetch.mockReset();

    const res = await startCheckout("00000000-0000-0000-0000-000000000000");

    expect(res.status).toBe(404);
    expect(stripeFetch).not.toHaveBeenCalled();
  });

  it("validates credits and return URLs", async () => {
    stripeFetch.mockReset();
    const accountId = await openAccount();

    for (const body of [{ credits: 0 }, { credits: 2.5 }, { credits: 100_001 }, { successUrl: "not a url" }]) {
      const res = await startCheckout(accountId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(stripeFetch).not.toHaveBeenCalled();
  });

  it("reports a Stripe failure as 502 without leaking Stripe's message", async () => {
    stripeFetch
      .mockReset()
      .mockResolvedValue(Response.json({ error: { message: "Invalid API Key provided: sk_test_***" } }, { status: 401 }));
    const accountId = await openAccount();

    const res = await startCheckout(accountId);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("payment_provider_error");
    expect(JSON.stringify(res.body)).not.toContain("sk_test");
  });
});

describe("without Stripe configured", () => {
  const unconfigured = useApp({ env: { STRIPE_SECRET_KEY: undefined } });

  it("answers 503", async () => {
    const accountId = (await request(unconfigured().getHttpServer()).post("/v1/accounts").set(auth).send({ code: "c2" })).body.id;

    const res = await request(unconfigured().getHttpServer())
      .post(`/v1/accounts/${accountId}/checkout-sessions`)
      .set(auth)
      .set("Idempotency-Key", "k")
      .send({ credits: 5, successUrl: "https://a.example.com", cancelUrl: "https://a.example.com" });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("payments_not_configured");
  });
});
