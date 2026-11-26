import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, inject } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";

export const API_KEY = "test-api-key";

// Boots the real application (same module and setup as production) for a spec file.
export function useApp(): () => INestApplication {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = inject("databaseUrl");
    process.env.LEDGERLINE_API_KEY = API_KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  return () => app;
}

export const auth = { Authorization: `Bearer ${API_KEY}` };
