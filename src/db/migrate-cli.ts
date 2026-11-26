import { createDatabase } from "./database.js";
import { migrateToLatest } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDatabase(url);
try {
  await migrateToLatest(db);
  console.log("Migrations are up to date.");
} finally {
  await db.destroy();
}
