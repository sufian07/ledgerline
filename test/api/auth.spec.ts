import request from "supertest";
import { expect, it } from "vitest";
import { useApp } from "../app.js";

const app = useApp();

it("refuses requests without the API key", async () => {
  const res = await request(app().getHttpServer()).get("/v1/ledger/verify");

  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
});

it("refuses a wrong API key", async () => {
  const res = await request(app().getHttpServer()).get("/v1/ledger/verify").set("Authorization", "Bearer nope");

  expect(res.status).toBe(401);
});

it("leaves the health check and API description open", async () => {
  const health = await request(app().getHttpServer()).get("/health");
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ status: "ok", database: "ok" });

  const openapi = await request(app().getHttpServer()).get("/openapi.json");
  expect(openapi.status).toBe(200);
  expect(openapi.body.openapi).toMatch(/^3\.1/);
});
