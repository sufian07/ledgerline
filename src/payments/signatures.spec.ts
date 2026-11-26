import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHooklineSignature, verifyStripeSignature } from "./signatures.js";

const now = 1_800_000_000;
const body = '{"id":"evt_1"}';
const hmac = (secret: string, at: number, payload = body) =>
  createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex");

describe("Stripe signatures", () => {
  const check = (header: string, payload = body) =>
    verifyStripeSignature({ header, body: payload, secret: "whsec_x", now });

  it("accepts a valid signature", () => {
    expect(check(`t=${now},v1=${hmac("whsec_x", now)}`)).toBe(true);
  });

  it("accepts any matching v1 among several, as during secret rotation", () => {
    expect(check(`t=${now},v1=${"0".repeat(64)},v1=${hmac("whsec_x", now)},v0=abc`)).toBe(true);
  });

  it("rejects a wrong secret, a changed body and an old timestamp", () => {
    expect(check(`t=${now},v1=${hmac("other", now)}`)).toBe(false);
    expect(check(`t=${now},v1=${hmac("whsec_x", now)}`, '{"id":"evt_2"}')).toBe(false);
    expect(check(`t=${now - 301},v1=${hmac("whsec_x", now - 301)}`)).toBe(false);
  });

  it("rejects malformed headers", () => {
    for (const header of ["", "t=abc,v1=00", `v1=${hmac("whsec_x", now)}`, `t=${now}`]) {
      expect(check(header), header).toBe(false);
    }
  });
});

describe("Hookline signatures", () => {
  const check = (timestamp: string, signature: string) =>
    verifyHooklineSignature({ timestamp, signature, body, secret: "hk", now });

  it("accepts a valid signature and rejects a wrong or stale one", () => {
    expect(check(String(now), `sha256=${hmac("hk", now)}`)).toBe(true);
    expect(check(String(now), `sha256=${hmac("nope", now)}`)).toBe(false);
    expect(check(String(now - 301), `sha256=${hmac("hk", now - 301)}`)).toBe(false);
    expect(check("x", "sha256=00")).toBe(false);
  });
});
