import type { Kysely } from "kysely";
import { Migrator, type Migration } from "kysely/migration";
import * as ledger from "./migrations/0001_ledger.js";
import * as sequences from "./migrations/0002_sequences.js";
import type { Database } from "./schema.js";

const migrations: Record<string, Migration> = {
  "0001_ledger": ledger,
  "0002_sequences": sequences,
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({ db, provider: { getMigrations: async () => migrations } });
  const { error } = await migrator.migrateToLatest();
  if (error) throw error;
}
