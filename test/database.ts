import { sql, type Kysely } from "kysely";
import { afterAll, beforeEach, inject } from "vitest";
import { createDatabase } from "../src/db/database.js";
import type { Database } from "../src/db/schema.js";

// One pool per spec file; every test starts from an empty ledger (system accounts kept).
export function useDatabase(): () => Kysely<Database> {
  const db = createDatabase(inject("databaseUrl"), { max: 60 });

  beforeEach(async () => {
    await sql`truncate postings, entries restart identity cascade`.execute(db);
    await sql`delete from accounts where kind = 'customer'`.execute(db);
    await sql`update accounts set balance = 0`.execute(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  return () => db;
}
