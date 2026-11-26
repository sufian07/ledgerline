import { sql, type Kysely } from "kysely";

// Monotonic sequence numbers give stable, cheap keyset pagination (newest first).
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`alter table accounts add column seq bigint generated always as identity`.execute(db);
  await sql`create unique index accounts_seq on accounts (seq)`.execute(db);
  await sql`alter table entries add column seq bigint generated always as identity`.execute(db);
  await sql`create index entries_account_seq on entries (account_id, seq desc)`.execute(db);
  await sql`drop index entries_account_created`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`create index entries_account_created on entries (account_id, created_at)`.execute(db);
  await sql`drop index entries_account_seq`.execute(db);
  await sql`alter table entries drop column seq`.execute(db);
  await sql`drop index accounts_seq`.execute(db);
  await sql`alter table accounts drop column seq`.execute(db);
}
