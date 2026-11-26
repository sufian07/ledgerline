import EmbeddedPostgres from "embedded-postgres";
import { createDatabase } from "../src/db/database.js";
import { migrateToLatest } from "../src/db/migrate.js";

// Uses DATABASE_URL when set (CI); otherwise starts a throwaway local PostgreSQL.
export default async function setup({ provide }: { provide: (key: string, value: string) => void }) {
  let embedded: EmbeddedPostgres | undefined;
  let url = process.env.DATABASE_URL;

  if (!url) {
    const port = 54329;
    embedded = new EmbeddedPostgres({
      databaseDir: ".pg/test",
      user: "ledgerline",
      password: "ledgerline",
      port,
      persistent: false,
      onLog: () => undefined,
    });
    await embedded.initialise();
    await embedded.start();
    await embedded.createDatabase("ledgerline_test");
    url = `postgres://ledgerline:ledgerline@127.0.0.1:${port}/ledgerline_test`;
  }

  const db = createDatabase(url);
  await migrateToLatest(db);
  await db.destroy();
  provide("databaseUrl", url);

  return async () => {
    await embedded?.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
