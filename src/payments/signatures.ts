import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

// Stripe-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">[,v1=...][,v0=...]
export function verifyStripeSignature(input: { header: string; body: string; secret: string; now: number }): boolean {
  const parts = input.header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const candidates = parts.filter(([key]) => key === "v1").map(([, value]) => value ?? "");
  if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) return false;
  if (Math.abs(input.now - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const expected = hmacHex(input.secret, `${timestamp}.${input.body}`);
  return candidates.some((candidate) => safeEqual(candidate, expected));
}

// Hookline: X-Hookline-Timestamp and X-Hookline-Signature: sha256=<hex HMAC-SHA256 of "timestamp.body">
export function verifyHooklineSignature(input: {
  timestamp: string;
  signature: string;
  body: string;
  secret: string;
  now: number;
}): boolean {
  if (!/^\d+$/.test(input.timestamp) || !input.signature.startsWith("sha256=")) return false;
  if (Math.abs(input.now - Number(input.timestamp)) > TOLERANCE_SECONDS) return false;

  return safeEqual(input.signature.slice(7), hmacHex(input.secret, `${input.timestamp}.${input.body}`));
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
