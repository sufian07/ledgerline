// Written by hand (contract first). A spec checks that every operation here exists.
const uuid = { type: "string", format: "uuid" };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ content: { "application/json": { schema } } });
const error = (description: string) => ({ description, ...json(ref("Error")) });
const idParam = (name: string) => ({ name, in: "path", required: true, schema: uuid });
const pageParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "nextCursor from the previous page" },
];
const idempotencyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", minLength: 1, maxLength: 200 },
  description: "Repeating a request with the same key returns the original result.",
};
const moneyResponses = {
  "201": { description: "Recorded", ...json(ref("EntryResult")) },
  "200": {
    description: "Replayed: this key was already used for the same request",
    headers: { "Idempotent-Replayed": { schema: { type: "string", enum: ["true"] } } },
    ...json(ref("EntryResult")),
  },
  "400": error("Invalid request"),
  "404": error("Not found"),
  "409": error("Idempotency key reused for a different request"),
  "422": error("Insufficient credits, or refund larger than the purchase"),
};
const moveRequest = { required: true, ...json(ref("MoveRequest")) };

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Ledgerline",
    version: "1.0.0",
    description: "Double-entry credits ledger. /health and /openapi.json are public; everything else needs the API key.",
  },
  security: [{ apiKey: [] }],
  paths: {
    "/v1/accounts": {
      post: {
        summary: "Open a customer account",
        requestBody: { required: true, ...json({ type: "object", required: ["code"], properties: { code: { type: "string" } } }) },
        responses: { "201": { description: "Opened", ...json(ref("Account")) }, "409": error("Code already used") },
      },
      get: {
        summary: "List customer accounts, newest first",
        parameters: pageParams,
        responses: { "200": { description: "A page of accounts", ...json(ref("AccountPage")) } },
      },
    },
    "/v1/accounts/{accountId}": {
      get: {
        summary: "Get an account and its balance",
        parameters: [idParam("accountId")],
        responses: { "200": { description: "The account", ...json(ref("Account")) }, "404": error("Not found") },
      },
    },
    "/v1/accounts/{accountId}/entries": {
      get: {
        summary: "List an account's entries, newest first",
        parameters: [idParam("accountId"), ...pageParams],
        responses: { "200": { description: "A page of entries", ...json(ref("EntryPage")) }, "404": error("Not found") },
      },
    },
    "/v1/accounts/{accountId}/purchases": {
      post: { summary: "Add purchased credits", parameters: [idParam("accountId"), idempotencyHeader], requestBody: moveRequest, responses: moneyResponses },
    },
    "/v1/accounts/{accountId}/spends": {
      post: { summary: "Spend credits", parameters: [idParam("accountId"), idempotencyHeader], requestBody: moveRequest, responses: moneyResponses },
    },
    "/v1/purchases/{purchaseId}/refunds": {
      post: { summary: "Refund part or all of a purchase", parameters: [idParam("purchaseId"), idempotencyHeader], requestBody: moveRequest, responses: moneyResponses },
    },
    "/v1/entries/{entryId}": {
      get: {
        summary: "Get one entry",
        parameters: [idParam("entryId")],
        responses: { "200": { description: "The entry", ...json(ref("Entry")) }, "404": error("Not found") },
      },
    },
    "/v1/ledger/verify": {
      get: {
        summary: "Recompute every balance from the postings and report drift",
        responses: { "200": { description: "Verification result", ...json(ref("Verification")) } },
      },
    },
  },
  components: {
    securitySchemes: { apiKey: { type: "http", scheme: "bearer" } },
    schemas: {
      Account: {
        type: "object",
        required: ["id", "code", "balance"],
        properties: { id: uuid, code: { type: "string" }, balance: { type: "integer" } },
      },
      AccountPage: {
        type: "object",
        properties: { data: { type: "array", items: ref("Account") }, nextCursor: { type: ["string", "null"] } },
      },
      MoveRequest: {
        type: "object",
        required: ["amount"],
        additionalProperties: false,
        properties: {
          amount: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
          reference: { type: "string", maxLength: 200 },
        },
      },
      Entry: {
        type: "object",
        properties: {
          id: uuid,
          kind: { type: "string", enum: ["purchase", "spend", "refund"] },
          accountId: uuid,
          amount: { type: "integer" },
          refundOf: { anyOf: [uuid, { type: "null" }] },
          reference: { type: ["string", "null"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      EntryPage: {
        type: "object",
        properties: { data: { type: "array", items: ref("Entry") }, nextCursor: { type: ["string", "null"] } },
      },
      EntryResult: {
        type: "object",
        properties: { entry: ref("Entry"), balance: { type: "integer" } },
      },
      Verification: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          drifted: {
            type: "array",
            items: {
              type: "object",
              properties: { accountId: uuid, stored: { type: "integer" }, computed: { type: "integer" } },
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" }, details: {} },
          },
        },
      },
    },
  },
} as const;
