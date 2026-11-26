# Ledgerline

[![CI](https://github.com/sufian07/ledgerline/actions/workflows/ci.yml/badge.svg)](https://github.com/sufian07/ledgerline/actions/workflows/ci.yml)

A double-entry credits ledger in TypeScript and PostgreSQL. Customers buy credits, spend them, and get refunds; every change is recorded so balances can always be rebuilt and checked.

Status: the ledger core and HTTP API are done. Stripe payments and deployment are next.

## How it works

Every change is an **entry** made of **postings** that sum to zero:

| Entry | Postings |
|---|---|
| Purchase of 100 | payments −100, customer +100 |
| Spend of 30 | customer −30, revenue +30 |
| Refund of 20 | customer −20, payments +20 |

`payments` and `revenue` are system accounts. `payments` goes negative by design: it represents money that came in from outside.

## Guarantees

PostgreSQL enforces the rules, so a bug in the application cannot break them:

- **Balanced entries:** a deferred constraint trigger rejects any entry whose postings don't sum to zero at commit.
- **Append-only history:** triggers block updates and deletes on entries and postings.
- **No negative customer balances:** a check constraint, plus a conditional `UPDATE` that fails instead of overdrawing.
- **Refunds never exceed their purchase:** the purchase row is locked first, so refunds of it run one at a time.
- **Exactly once:** each request carries an idempotency key. A repeat returns the original result; reusing a key for a different request is refused.
- **Checkable:** `verify()` recomputes every balance from the postings and reports any that disagree.

These are tested against a real PostgreSQL, including under concurrency: 50 simultaneous spends against 20 credits (exactly 20 succeed), 20 simultaneous copies of one request (applied once), and 10 simultaneous refunds of one purchase (never more than it).

## API

Every `/v1` request needs `Authorization: Bearer $LEDGERLINE_API_KEY`. The full description is served at `/openapi.json` (OpenAPI 3.1, written by hand; a spec checks every documented operation exists).

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/accounts` | `{ "code": "cust_42" }` |
| `GET` | `/v1/accounts`, `/v1/accounts/{id}` | Balance included |
| `GET` | `/v1/accounts/{id}/entries` | Newest first |
| `POST` | `/v1/accounts/{id}/purchases` | `{ "amount": 100 }` |
| `POST` | `/v1/accounts/{id}/spends` | `{ "amount": 30, "reference": "lead_9" }` |
| `POST` | `/v1/purchases/{id}/refunds` | `{ "amount": 20 }` |
| `GET` | `/v1/entries/{id}` | |
| `GET` | `/v1/ledger/verify` | Recomputes balances and reports drift |
| `GET` | `/health` | Public; checks the database |

- **Idempotency:** purchases, spends and refunds need an `Idempotency-Key` header. A repeat returns the original result with `200` and `Idempotent-Replayed: true`; a new entry returns `201`.
- **Paging:** lists return `{ "data": [...], "nextCursor": ... }`. Pass `cursor` for the next page and `limit` (up to 100).
- **Errors:** always `{ "error": { "code", "message" } }`. Codes: `invalid_request` (400), `unauthorized` (401), `account_not_found`, `purchase_not_found`, `entry_not_found` (404), `duplicate_account`, `idempotency_conflict` (409), `payload_too_large` (413), `insufficient_credits`, `refund_exceeds_purchase` (422).

```sh
curl -X POST localhost:3000/v1/accounts/$ACCOUNT/purchases \
  -H "Authorization: Bearer $LEDGERLINE_API_KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-1001" -d '{"amount":100}'
```

## Run

```sh
npm ci
npm run build
DATABASE_URL=postgres://... npm run db:migrate
DATABASE_URL=postgres://... LEDGERLINE_API_KEY=at-least-16-characters npm start
```

## Run the tests

```sh
npm ci
npm test
```

Without `DATABASE_URL`, the tests start a throwaway PostgreSQL 18 with `embedded-postgres`. CI runs them against a PostgreSQL 18 service container.

## Stack

Node.js 24, TypeScript, NestJS, Kysely, PostgreSQL 18, Vitest.
