import { z } from "zod";

export const accountCode = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/, "use 1 to 100 letters, digits or _ . : -");

export const openAccountBody = z.object({ code: accountCode }).strict();

export const moveBody = z
  .object({
    amount: z.number().int().positive(),
    reference: z.string().min(1).max(200).optional(),
  })
  .strict();

export const idempotencyKey = z.string({ error: "Idempotency-Key header is required" }).min(1).max(200);

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});
