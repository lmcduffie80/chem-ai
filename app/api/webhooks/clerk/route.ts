import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { and, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, schema } from "@/db";

function normalizeRole(role: string) {
  if (role === "org:admin") return "admin";
  if (role === "org:viewer") return "viewer";
  return "editor";
}

/** Mirrors Clerk users, organizations and memberships. Requires CLERK_WEBHOOK_SIGNING_SECRET. */
export async function POST(request: NextRequest) {
  let event;
  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.warn("Clerk webhook verification failed", error instanceof Error ? error.message : error);
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const u = event.data;
      const email = u.email_addresses.find((e) => e.id === u.primary_email_address_id)?.email_address ?? null;
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
      await db
        .insert(schema.users)
        .values({ id: u.id, email, name })
        .onConflictDoUpdate({ target: schema.users.id, set: { email, name, updatedAt: new Date() } });
      break;
    }
    case "user.deleted": {
      if (event.data.id) {
        await db.delete(schema.memberships).where(eq(schema.memberships.userId, event.data.id));
        await db.delete(schema.users).where(eq(schema.users.id, event.data.id));
      }
      break;
    }
    case "organization.created":
    case "organization.updated": {
      const o = event.data;
      await db
        .insert(schema.organizations)
        .values({ id: o.id, name: o.name, slug: o.slug })
        .onConflictDoUpdate({ target: schema.organizations.id, set: { name: o.name, slug: o.slug, updatedAt: new Date() } });
      break;
    }
    case "organization.deleted": {
      if (event.data.id) await db.delete(schema.organizations).where(eq(schema.organizations.id, event.data.id));
      break;
    }
    case "organizationMembership.created":
    case "organizationMembership.updated": {
      const m = event.data;
      await db
        .insert(schema.organizations)
        .values({ id: m.organization.id, name: m.organization.name, slug: m.organization.slug })
        .onConflictDoNothing();
      const role = normalizeRole(m.role);
      await db
        .insert(schema.memberships)
        .values({ orgId: m.organization.id, userId: m.public_user_data.user_id, role })
        .onConflictDoUpdate({
          target: [schema.memberships.orgId, schema.memberships.userId],
          set: { role, updatedAt: new Date() },
        });
      break;
    }
    case "organizationMembership.deleted": {
      const m = event.data;
      await db
        .delete(schema.memberships)
        .where(and(eq(schema.memberships.orgId, m.organization.id), eq(schema.memberships.userId, m.public_user_data.user_id)));
      break;
    }
  }

  return Response.json({ received: true });
}
