"use server";

import { and, count, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { generateApiKey } from "@/lib/api-keys";
import { ensureAccountRecords, getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";

const MAX_ACTIVE_KEYS = 20;

async function adminContext() {
  const viewer = await getViewer();
  if (!viewer.userId || !viewer.orgId) return { error: "Switch to your organization first." } as const;
  if (viewer.orgRole !== "admin") return { error: "Only organization admins can manage API keys." } as const;
  if (!can(viewer.orgPlan, "api")) return { error: "API access requires an Enterprise plan." } as const;
  return { userId: viewer.userId, orgId: viewer.orgId, viewer } as const;
}

export async function createApiKey(
  _prev: { key?: string; error?: string },
  formData: FormData,
): Promise<{ key?: string; error?: string }> {
  const ctx = await adminContext();
  if ("error" in ctx) return { error: ctx.error };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the key a name." };

  const [{ active }] = await db
    .select({ active: count() })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.orgId, ctx.orgId), isNull(schema.apiKeys.revokedAt)));
  if (active >= MAX_ACTIVE_KEYS) return { error: `Revoke a key first; organizations can have ${MAX_ACTIVE_KEYS} active keys.` };

  await ensureAccountRecords(ctx.viewer);
  const { key, prefix, hashedKey } = generateApiKey();
  await db.insert(schema.apiKeys).values({ orgId: ctx.orgId, name, prefix, hashedKey, createdBy: ctx.userId });
  revalidatePath("/workspace/api-keys");
  return { key };
}

export async function revokeApiKey(id: string): Promise<{ error?: string }> {
  const ctx = await adminContext();
  if ("error" in ctx) return { error: ctx.error };
  await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, ctx.orgId)));
  revalidatePath("/workspace/api-keys");
  return {};
}
