import request from "supertest";
import { expect, it } from "vitest";
import { useApp } from "../app.js";

const app = useApp();

it("documents only routes that exist, each protected by the API key", async () => {
  const doc = (await request(app().getHttpServer()).get("/openapi.json")).body as {
    paths: Record<string, Record<string, unknown>>;
  };
  const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
    Object.keys(methods).map((method) => ({ method, path })),
  );
  expect(operations.length).toBeGreaterThanOrEqual(9);

  for (const { method, path } of operations) {
    const url = path.replace(/\{[^}]+\}/g, "00000000-0000-0000-0000-000000000000");
    const res = await request(app().getHttpServer())[method as "get" | "post"](url);

    expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
  }
});
