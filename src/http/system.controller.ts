import { Controller, Get, Inject } from "@nestjs/common";
import { sql, type Kysely } from "kysely";
import { KYSELY } from "../db/database.module.js";
import type { Database } from "../db/schema.js";
import { openApiDocument } from "./openapi.js";
import { Public } from "./api-key.guard.js";

@Public()
@Controller()
export class SystemController {
  constructor(@Inject(KYSELY) private readonly db: Kysely<Database>) {}

  @Get("health")
  async health() {
    await sql`select 1`.execute(this.db);
    return { status: "ok", database: "ok" };
  }

  @Get("openapi.json")
  openapi() {
    return openApiDocument;
  }
}
