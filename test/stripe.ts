import { createHmac } from "node:crypto";

export function checkoutCompleted(
  overrides: { id?: string; sessionId?: string; accountId?: string; credits?: string; paymentStatus?: string; type?: string } = {},
) {
  return {
    id: overrides.id ?? "evt_test_1",
    object: "event",
    type: overrides.type ?? "checkout.session.completed",
    data: {
      object: {
        id: overrides.sessionId ?? "cs_test_1",
        object: "checkout.session",
        payment_status: overrides.paymentStatus ?? "paid",
        amount_total: 1000,
        currency: "usd",
        metadata: { account_id: overrides.accountId ?? "", credits: overrides.credits ?? "100" },
      },
    },
  };
}

export function stripeSignature(body: string, secret: string, at = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return `t=${at},v1=${v1}`;
}

export function hooklineHeaders(body: string, secret: string, at = Math.floor(Date.now() / 1000)) {
  return {
    "Content-Type": "application/json",
    "X-Hookline-Timestamp": String(at),
    "X-Hookline-Signature": `sha256=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`,
    "X-Hookline-Event": "checkout.session.completed",
    "X-Hookline-Delivery": "1",
  };
}
