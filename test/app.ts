import type { INestApplication } from "@nestjs/common";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import { afterAll, beforeAll, inject } from "vitest";
import { AppModule } from "../src/app.module.js";
import { configureApp } from "../src/configure-app.js";

export const API_KEY = "test-api-key-0123456789";
export const STRIPE_SECRET_KEY = "sk_test_ledgerline";
export const STRIPE_WEBHOOK_SECRET = "whsec_test_ledgerline";
export const HOOKLINE_SECRET = "hookline-subscription-secret";

const DEFAULT_ENV: Record<string, string | undefined> = {
  LEDGERLINE_API_KEY: API_KEY,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  LEDGERLINE_HOOKLINE_SECRET: HOOKLINE_SECRET,
  LEDGERLINE_CREDIT_PRICE_CENTS: "10",
  LEDGERLINE_CURRENCY: "usd",
};

interface AppOptions {
  env?: Record<string, string | undefined>;
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

// Boots the real application (same module and setup as production) for a spec file.
export function useApp(options: AppOptions = {}): () => INestApplication {
  let app: INestApplication;

  beforeAll(async () => {
    const env = { ...DEFAULT_ENV, ...options.env, DATABASE_URL: inject("databaseUrl") };
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    const builder = Test.createTestingModule({ imports: [AppModule] });
    const moduleRef = await (options.override ? options.override(builder) : builder).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false, rawBody: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  return () => app;
}

export const auth = { Authorization: `Bearer ${API_KEY}` };
