import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import type { PlanTier } from "@/db/schema";
import { higherPlan, planAtLeast } from "@/lib/entitlements";

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export type OrgRole = "admin" | "editor" | "viewer";

export type Viewer = {
  userId: string | null;
  orgId: string | null;
  orgRole: OrgRole | null;
  userPlan: PlanTier;
  orgPlan: PlanTier;
  plan: PlanTier;
  isPlatformAdmin: boolean;
};

export async function planFor(ownerType: "user" | "org", ownerId: string): Promise<PlanTier> {
  const subs = await db
    .select({ plan: schema.subscriptions.plan })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.ownerType, ownerType),
        eq(schema.subscriptions.ownerId, ownerId),
        inArray(schema.subscriptions.status, ACTIVE_STATUSES),
      ),
    );
  return subs.reduce<PlanTier>((best, s) => higherPlan(best, s.plan), "free");
}

/** Clerk's default `org:member` role is treated as an editor; `org:viewer` is read-only. */
function normalizeOrgRole(role: string | null | undefined): OrgRole | null {
  if (!role) return null;
  if (role === "org:admin") return "admin";
  if (role === "org:viewer") return "viewer";
  return "editor";
}

export const getViewer = cache(async (): Promise<Viewer> => {
  const { userId, orgId, orgRole, sessionClaims } = await auth();
  if (!userId) {
    return { userId: null, orgId: null, orgRole: null, userPlan: "free", orgPlan: "free", plan: "free", isPlatformAdmin: false };
  }

  const [userPlan, orgPlan] = await Promise.all([
    planFor("user", userId),
    orgId ? planFor("org", orgId) : Promise.resolve<PlanTier>("free"),
  ]);

  const adminIds = (process.env.PLATFORM_ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim());
  const metadata = (sessionClaims?.metadata ?? {}) as { role?: string };

  return {
    userId,
    orgId: orgId ?? null,
    orgRole: normalizeOrgRole(orgRole),
    userPlan,
    orgPlan,
    plan: higherPlan(userPlan, orgPlan),
    isPlatformAdmin: adminIds.includes(userId) || metadata.role === "admin",
  };
});

/** Usage and quotas accrue to the organization when it holds a Team+ plan, otherwise to the user. */
export function billingOwner(viewer: Viewer): { ownerType: "user" | "org"; ownerId: string } | null {
  if (viewer.orgId && planAtLeast(viewer.orgPlan, "team")) return { ownerType: "org", ownerId: viewer.orgId };
  if (viewer.userId) return { ownerType: "user", ownerId: viewer.userId };
  return null;
}

/** Mirrors the Clerk user (and active org + membership) into Postgres; webhooks keep them fresh afterwards. */
export async function ensureAccountRecords(viewer: Viewer) {
  if (!viewer.userId) return;
  const user = await currentUser();
  await db
    .insert(schema.users)
    .values({
      id: viewer.userId,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      name: user?.fullName ?? null,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: user?.primaryEmailAddress?.emailAddress ?? null, name: user?.fullName ?? null },
    });

  if (viewer.orgId) {
    const [existing] = await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, viewer.orgId));
    if (!existing) {
      const client = await clerkClient();
      const org = await client.organizations.getOrganization({ organizationId: viewer.orgId });
      await db
        .insert(schema.organizations)
        .values({ id: org.id, name: org.name, slug: org.slug })
        .onConflictDoNothing();
    }
    await db
      .insert(schema.memberships)
      .values({ orgId: viewer.orgId, userId: viewer.userId, role: viewer.orgRole ?? "editor" })
      .onConflictDoUpdate({
        target: [schema.memberships.orgId, schema.memberships.userId],
        set: { role: viewer.orgRole ?? "editor" },
      });
  }
}

export function canEditWorkspace(viewer: Viewer) {
  return viewer.orgRole === "admin" || viewer.orgRole === "editor";
}

export function ownerFilter(viewer: Viewer) {
  const owners = [viewer.userId ? { t: "user" as const, id: viewer.userId } : null, viewer.orgId ? { t: "org" as const, id: viewer.orgId } : null].filter(
    (o): o is { t: "user" | "org"; id: string } => o !== null,
  );
  return or(...owners.map((o) => and(eq(schema.watchlists.ownerType, o.t), eq(schema.watchlists.ownerId, o.id))));
}
