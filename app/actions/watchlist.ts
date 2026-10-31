"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { billingOwner, ensureAccountRecords, getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";

/** Defaults to the viewer's billing owner; pass `ownerType` to act on a specific (personal or team) watchlist. */
export async function toggleWatch(
  chemicalId: number,
  ownerType?: "user" | "org",
): Promise<{ watching?: boolean; error?: string }> {
  const viewer = await getViewer();
  if (!viewer.userId) return { error: "Sign in to use watchlists." };
  if (ownerType === "org" && !viewer.orgId) return { error: "Switch to the organization that owns this watchlist." };
  const owner =
    ownerType === "user"
      ? { ownerType: "user" as const, ownerId: viewer.userId }
      : ownerType === "org"
        ? { ownerType: "org" as const, ownerId: viewer.orgId! }
        : billingOwner(viewer);
  if (!owner) return { error: "Sign in to use watchlists." };
  if (!can(viewer.plan, "watchlists")) return { error: "Watchlists require a Pro plan or higher." };
  if (owner.ownerType === "org" && viewer.orgRole === "viewer") return { error: "Viewers cannot change the team watchlist." };

  await ensureAccountRecords(viewer);
  const where = and(
    eq(schema.watchlists.ownerType, owner.ownerType),
    eq(schema.watchlists.ownerId, owner.ownerId),
    eq(schema.watchlists.chemicalId, chemicalId),
  );
  const [existing] = await db.select({ id: schema.watchlists.id }).from(schema.watchlists).where(where);
  if (existing) {
    await db.delete(schema.watchlists).where(where);
  } else {
    await db.insert(schema.watchlists).values({ ...owner, chemicalId, createdBy: viewer.userId });
  }
  revalidatePath("/workspace/watchlist");
  return { watching: !existing };
}
