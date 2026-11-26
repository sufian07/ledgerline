import request from "supertest";
import { expect, it } from "vitest";
import { auth, useApp } from "../app.js";
import { useDatabase } from "../database.js";

useDatabase();
const app = useApp();
const http = () => request(app().getHttpServer());

it("lists accounts newest first, a page at a time", async () => {
  for (const code of ["a", "b", "c"]) await http().post("/v1/accounts").set(auth).send({ code });

  const first = await http().get("/v1/accounts?limit=2").set(auth);
  expect(first.status).toBe(200);
  expect(first.body.data.map((a: { code: string }) => a.code)).toEqual(["c", "b"]);

  const second = await http().get(`/v1/accounts?limit=2&cursor=${first.body.nextCursor}`).set(auth);
  expect(second.body.data.map((a: { code: string }) => a.code)).toEqual(["a"]);
  expect(second.body.nextCursor).toBeNull();
});

it("looks up a single entry", async () => {
  const account = (await http().post("/v1/accounts").set(auth).send({ code: "a" })).body;
  const bought = await http().post(`/v1/accounts/${account.id}/purchases`).set(auth).set("Idempotency-Key", "k").send({ amount: 5 });

  const res = await http().get(`/v1/entries/${bought.body.entry.id}`).set(auth);

  expect(res.status).toBe(200);
  expect(res.body).toEqual(bought.body.entry);
  expect((await http().get("/v1/entries/00000000-0000-0000-0000-000000000000").set(auth)).body.error.code).toBe(
    "entry_not_found",
  );
});

it("rejects a malformed cursor", async () => {
  const res = await http().get("/v1/accounts?cursor=%%%").set(auth);

  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe("invalid_request");
});
