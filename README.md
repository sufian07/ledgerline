# Ledgerline

[![CI](https://github.com/sufian07/ledgerline/actions/workflows/ci.yml/badge.svg)](https://github.com/sufian07/ledgerline/actions/workflows/ci.yml)

A double-entry credits ledger in TypeScript and PostgreSQL. Customers buy credits, spend them, and get refunds; every change is recorded so balances can always be rebuilt and checked.

Status: the ledger core is done. The HTTP API, Stripe payments and deployment are next.

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

## Run the tests

```sh
npm ci
npm test
```

Without `DATABASE_URL`, the tests start a throwaway PostgreSQL 18 with `embedded-postgres`. CI runs them against a PostgreSQL 18 service container.

## Stack

Node.js 24, TypeScript, NestJS, Kysely, PostgreSQL 18, Vitest.
