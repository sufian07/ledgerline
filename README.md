# Ledgerline

A double-entry credits ledger API in NestJS and PostgreSQL.

Status: early. Nothing usable yet.

## Run the tests

```sh
npm ci
npm test
```

Without `DATABASE_URL`, the tests start a throwaway PostgreSQL with `embedded-postgres`. With it, they use that database.
