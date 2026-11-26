import { sql } from "kysely";
import { afterAll, expect, inject, it } from "vitest";
import { createDatabase } from "../src/db/database.js";

const db = createDatabase(inject("databaseUrl"));
afterAll(() => db.destroy());

it("connects to PostgreSQL 18", async () => {
  const { rows } = await sql<{ server_version: string }>`show server_version`.execute(db);

  expect(rows[0]?.server_version).toMatch(/^18\./);
});
