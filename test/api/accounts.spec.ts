import request from "supertest";
import { expect, it } from "vitest";
import { auth, useApp } from "../app.js";
import { useDatabase } from "../database.js";

useDatabase();
const app = useApp();
const http = () => request(app().getHttpServer());

it("opens an account", async () => {
  const res = await http().post("/v1/accounts").set(auth).send({ code: "cust_1" });

  expect(res.status).toBe(201);
  expect(res.body).toEqual({ id: expect.any(String), code: "cust_1", balance: 0 });

  const fetched = await http().get(`/v1/accounts/${res.body.id}`).set(auth);
  expect(fetched.body).toEqual(res.body);
});

it("refuses a duplicate code", async () => {
  await http().post("/v1/accounts").set(auth).send({ code: "cust_1" });

  const res = await http().post("/v1/accounts").set(auth).send({ code: "cust_1" });

  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe("duplicate_account");
});

it("validates the request body", async () => {
  for (const body of [{}, { code: "" }, { code: "has spaces" }, { code: "x".repeat(101) }, { code: 5 }]) {
    const res = await http().post("/v1/accounts").set(auth).send(body);

    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(res.body.error.code).toBe("invalid_request");
  }
});

it("answers 404 for an unknown or malformed account id", async () => {
  for (const id of ["00000000-0000-0000-0000-000000000000", "not-a-uuid"]) {
    const res = await http().get(`/v1/accounts/${id}`).set(auth);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("account_not_found");
  }
});
