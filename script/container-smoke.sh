#!/usr/bin/env bash
# Checks a running Ledgerline container end to end: health, a purchase over the API,
# and a Hookline-signed payment webhook that credits the account exactly once.
#   BASE_URL API_KEY HOOKLINE_SECRET script/container-smoke.sh
set -euo pipefail

: "${BASE_URL:?}" "${API_KEY:?}" "${HOOKLINE_SECRET:?}"
AUTH="Authorization: Bearer $API_KEY"
JSON="Content-Type: application/json"
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let v=JSON.parse(s);for(const k of process.argv.slice(1))v=v[k];console.log(v)})' "$@"; }
expect() { [ "$2" = "$3" ] || { echo "FAIL: $1: expected $3, got $2"; exit 1; }; echo "ok: $1"; }

for _ in $(seq 60); do curl -sf "$BASE_URL/health" > /dev/null && break; sleep 1; done
expect "health" "$(curl -s "$BASE_URL/health" | field status)" "ok"
expect "API key required" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/v1/accounts")" "401"

ACCOUNT=$(curl -sf -H "$AUTH" -H "$JSON" -d '{"code":"smoke_customer"}' "$BASE_URL/v1/accounts" | field id)
expect "purchase" "$(curl -sf -H "$AUTH" -H "$JSON" -H 'Idempotency-Key: smoke-buy' -d '{"amount":40}' "$BASE_URL/v1/accounts/$ACCOUNT/purchases" | field balance)" "40"

EVENT="{\"id\":\"evt_smoke\",\"type\":\"checkout.session.completed\",\"data\":{\"object\":{\"id\":\"cs_smoke\",\"payment_status\":\"paid\",\"metadata\":{\"account_id\":\"$ACCOUNT\",\"credits\":\"60\"}}}}"
relay() {
  local at sig
  at=$(date +%s)
  sig=$(printf '%s.%s' "$at" "$EVENT" | openssl dgst -sha256 -hmac "$HOOKLINE_SECRET" | sed 's/^.* //')
  curl -sf -H "$JSON" -H "X-Hookline-Timestamp: $at" -H "X-Hookline-Signature: sha256=$sig" -d "$EVENT" "$BASE_URL/webhooks/hookline" | field status
}
expect "payment webhook" "$(relay)" "credited"
expect "payment redelivery" "$(relay)" "replayed"
expect "balance" "$(curl -sf -H "$AUTH" "$BASE_URL/v1/accounts/$ACCOUNT" | field balance)" "100"
expect "ledger verifies" "$(curl -sf -H "$AUTH" "$BASE_URL/v1/ledger/verify" | field ok)" "true"
