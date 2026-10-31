import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";

const KEY_PATTERN = /^cs_([a-z0-9]{8})_([A-Za-z0-9_-]{32,})$/;

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

/** Returns the plaintext key exactly once; only its SHA-256 hash is stored. */
export function generateApiKey() {
  const prefix = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "0").slice(0, 8);
  const secret = randomBytes(24).toString("base64url");
  const key = `cs_${prefix}_${secret}`;
  return { key, prefix, hashedKey: hashApiKey(key) };
}

export function readApiKey(request: Request) {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const key = bearer ?? request.headers.get("x-api-key")?.trim() ?? null;
  return key && KEY_PATTERN.test(key) ? key : null;
}

export async function findActiveKey(key: string) {
  const [row] = await db
    .select({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId, name: schema.apiKeys.name })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.hashedKey, hashApiKey(key)), isNull(schema.apiKeys.revokedAt)));
  return row ?? null;
}

/** Writes at most once a minute per key to keep hot keys from hammering the row. */
export async function touchApiKey(id: string) {
  const cutoff = new Date(Date.now() - 60_000);
  await db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), or(isNull(schema.apiKeys.lastUsedAt), lt(schema.apiKeys.lastUsedAt, cutoff))));
}
