import type { ColumnType, Generated } from "kysely";

export type AccountKind = "customer" | "system";
export type EntryKind = "purchase" | "spend" | "refund";

export interface AccountsTable {
  id: Generated<string>;
  kind: AccountKind;
  code: string;
  allow_negative: ColumnType<boolean, boolean | undefined, never>;
  balance: ColumnType<number, number | undefined, number>;
  seq: ColumnType<number, never, never>;
  created_at: ColumnType<Date, never, never>;
}

export interface EntriesTable {
  id: Generated<string>;
  kind: EntryKind;
  idempotency_key: string;
  request_hash: string;
  account_id: string;
  amount: number;
  refund_of: string | null;
  reference: string | null;
  seq: ColumnType<number, never, never>;
  created_at: ColumnType<Date, never, never>;
}

export interface PostingsTable {
  id: Generated<number>;
  entry_id: string;
  account_id: string;
  amount: number;
}

export interface Database {
  accounts: AccountsTable;
  entries: EntriesTable;
  postings: PostingsTable;
}
