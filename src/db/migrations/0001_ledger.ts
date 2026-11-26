import { sql, type Kysely } from "kysely";

// The database enforces the ledger's rules, so a bug in application code cannot
// break them: entries must balance, history is append-only, and customer
// balances cannot go negative.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create table accounts (
      id uuid primary key default gen_random_uuid(),
      kind text not null check (kind in ('customer', 'system')),
      code text not null unique,
      allow_negative boolean not null default false,
      balance bigint not null default 0,
      created_at timestamptz not null default now(),
      constraint accounts_balance_not_negative check (allow_negative or balance >= 0)
    )
  `.execute(db);

  // payments: where purchased credits come from (goes negative by design).
  // revenue: where spent credits go.
  await sql`
    insert into accounts (kind, code, allow_negative)
    values ('system', 'payments', true), ('system', 'revenue', false)
  `.execute(db);

  await sql`
    create table entries (
      id uuid primary key default gen_random_uuid(),
      kind text not null check (kind in ('purchase', 'spend', 'refund')),
      idempotency_key text not null unique,
      request_hash text not null,
      account_id uuid not null references accounts (id),
      amount bigint not null check (amount > 0),
      refund_of uuid references entries (id),
      reference text,
      created_at timestamptz not null default now(),
      constraint entries_refund_has_purchase check ((kind = 'refund') = (refund_of is not null))
    )
  `.execute(db);
  await sql`create index entries_refund_of on entries (refund_of) where refund_of is not null`.execute(db);
  await sql`create index entries_account_created on entries (account_id, created_at)`.execute(db);

  await sql`
    create table postings (
      id bigint generated always as identity primary key,
      entry_id uuid not null references entries (id),
      account_id uuid not null references accounts (id),
      amount bigint not null check (amount <> 0)
    )
  `.execute(db);
  await sql`create index postings_entry on postings (entry_id)`.execute(db);
  await sql`create index postings_account on postings (account_id)`.execute(db);

  // Checked at commit, once every posting of the entry is in.
  await sql`
    create function ledger_entry_balanced() returns trigger language plpgsql as $$
    begin
      if (select coalesce(sum(amount), 0) from postings where entry_id = new.entry_id) <> 0 then
        raise exception 'entry % is not balanced', new.entry_id;
      end if;
      return null;
    end
    $$
  `.execute(db);
  await sql`
    create constraint trigger postings_balanced
      after insert on postings
      deferrable initially deferred
      for each row execute function ledger_entry_balanced()
  `.execute(db);

  await sql`
    create function ledger_append_only() returns trigger language plpgsql as $$
    begin
      raise exception 'postings and entries are append-only';
    end
    $$
  `.execute(db);
  await sql`
    create trigger postings_append_only before update or delete on postings
      for each row execute function ledger_append_only()
  `.execute(db);
  await sql`
    create trigger entries_append_only before update or delete on entries
      for each row execute function ledger_append_only()
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`drop table postings, entries, accounts`.execute(db);
  await sql`drop function ledger_entry_balanced, ledger_append_only`.execute(db);
}
