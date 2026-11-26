import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";

// Shared by main.ts and the specs, so tests run the app exactly as production does.
export function configureApp<T extends INestApplication>(app: T): T {
  const express = app as unknown as NestExpressApplication;
  express.disable("x-powered-by");
  express.useBodyParser("json", { limit: "16kb" });
  app.enableShutdownHooks();
  return app;
}
