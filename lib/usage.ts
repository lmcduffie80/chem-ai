import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { UsageKind } from "@/db/schema";
import { billingOwner, type Viewer } from "@/lib/auth";
import { PLANS } from "@/lib/entitlements";

export function startOfMonth() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function recordUsage(input: {
  ownerType: "user" | "org";
  ownerId: string;
  kind: UsageKind;
  userId?: string | null;
  apiKeyId?: string | null;
  path?: string;
}) {
  await db.insert(schema.usageEvents).values(input);
}

export async function countUsageThisMonth(ownerId: string, kind: UsageKind) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.ownerId, ownerId),
        eq(schema.usageEvents.kind, kind),
        gte(schema.usageEvents.createdAt, startOfMonth()),
      ),
    );
  return row.count;
}

export type SdsAccess =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "signed_out" | "quota_exceeded"; limit: number };

/**
 * Counts one SDS view per document per month against the plan's quota.
 * Re-opening the same SDS (page or PDF) in the same month is free.
 */
export async function consumeSdsView(viewer: Viewer, sdsId: string): Promise<SdsAccess> {
  const owner = billingOwner(viewer);
  const limit = PLANS[viewer.plan].sdsViewsPerMonth;
  if (!owner) return { allowed: false, reason: "signed_out", limit: limit ?? 0 };

  const path = `/sds/${sdsId}`;
  const [already] = await db
    .select({ id: schema.usageEvents.id })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.ownerId, owner.ownerId),
        eq(schema.usageEvents.kind, "sds_view"),
        eq(schema.usageEvents.path, path),
        gte(schema.usageEvents.createdAt, startOfMonth()),
      ),
    )
    .limit(1);
  if (already) return { allowed: true, remaining: null };

  if (limit !== null) {
    const used = await countUsageThisMonth(owner.ownerId, "sds_view");
    if (used >= limit) return { allowed: false, reason: "quota_exceeded", limit };
    await recordUsage({ ...owner, kind: "sds_view", userId: viewer.userId, path });
    return { allowed: true, remaining: limit - used - 1 };
  }

  await recordUsage({ ...owner, kind: "sds_view", userId: viewer.userId, path });
  return { allowed: true, remaining: null };
}
