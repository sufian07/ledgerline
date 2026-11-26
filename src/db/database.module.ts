import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import type { Kysely } from "kysely";
import { createDatabase } from "./database.js";
import type { Database } from "./schema.js";

export const KYSELY = Symbol("KYSELY");

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is required");
        return createDatabase(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10) });
      },
    },
  ],
  exports: [KYSELY],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
