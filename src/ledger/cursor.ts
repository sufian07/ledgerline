import { InvalidCursor } from "./ledger.errors.js";

// Cursors are opaque to clients: the base64url of the last row's sequence number.
export function encodeCursor(seq: number): string {
  return Buffer.from(String(seq)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined;
  const decoded = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, "base64url").toString() : "";
  if (!/^[1-9]\d{0,15}$/.test(decoded)) throw new InvalidCursor("cursor is not valid");
  return Number(decoded);
}
