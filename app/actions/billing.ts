"use server";

import { currentUser } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import type { PlanTier } from "@/db/schema";
import { ensureAccountRecords, getViewer } from "@/lib/auth";
import { type BillingOwner, customerIdFor, getOrCreateCustomer, priceIdFor, stripe } from "@/lib/billing/stripe";

const PAID_PLANS = ["pro", "team", "enterprise"] as const;
type PaidPlan = (typeof PAID_PLANS)[number];

async function origin() {
  const h = await headers();
  return h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function hasActiveSubscription(owner: BillingOwner) {
  const [row] = await db
    .select({ id: schema.subscriptions.id })
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.ownerType, owner.ownerType),
        eq(schema.subscriptions.ownerId, owner.ownerId),
        inArray(schema.subscriptions.status, ["active", "trialing", "past_due"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function startCheckout(formData: FormData) {
  const plan = formData.get("plan") as PlanTier;
  if (!PAID_PLANS.includes(plan as PaidPlan)) redirect("/pricing");

  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/billing?plan=${plan}`)}`);

  // Team and Enterprise are billed to the active organization; only its admins can purchase.
  const orgPlan = plan === "team" || plan === "enterprise";
  if (orgPlan && !viewer.orgId) redirect(`/billing?plan=${plan}&error=org_required`);
  if (orgPlan && viewer.orgRole !== "admin") redirect(`/billing?plan=${plan}&error=org_admin_required`);

  const price = priceIdFor(plan as PaidPlan);
  if (!price) redirect(`/billing?plan=${plan}&error=${plan === "enterprise" ? "contact_sales" : "unconfigured"}`);

  await ensureAccountRecords(viewer);
  const owner: BillingOwner = orgPlan
    ? { ownerType: "org", ownerId: viewer.orgId! }
    : { ownerType: "user", ownerId: viewer.userId };
  const base = await origin();

  // Plan changes for existing subscribers go through the portal so proration is handled by Stripe.
  if (await hasActiveSubscription(owner)) {
    const customer = await customerIdFor(owner);
    if (customer) {
      const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${base}/billing` });
      redirect(portal.url);
    }
  }

  const user = await currentUser();
  let name = user?.fullName ?? null;
  if (owner.ownerType === "org") {
    const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, owner.ownerId));
    name = org?.name ?? name;
  }
  const customer = await getOrCreateCustomer(owner, { email: user?.primaryEmailAddress?.emailAddress, name });

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer,
    client_reference_id: owner.ownerId,
    line_items: [{ price, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { ownerType: owner.ownerType, ownerId: owner.ownerId, plan } },
    success_url: `${base}/billing?success=1`,
    cancel_url: `${base}/pricing`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  redirect(session.url);
}

export async function openBillingPortal(formData: FormData) {
  const viewer = await getViewer();
  if (!viewer.userId) redirect("/sign-in");
  const ownerType = formData.get("ownerType") === "org" ? "org" : "user";
  if (ownerType === "org" && (!viewer.orgId || viewer.orgRole !== "admin")) redirect("/billing?error=org_admin_required");

  const owner: BillingOwner = ownerType === "org" ? { ownerType, ownerId: viewer.orgId! } : { ownerType, ownerId: viewer.userId };
  const customer = await customerIdFor(owner);
  if (!customer) redirect("/pricing");
  const portal = await stripe().billingPortal.sessions.create({ customer, return_url: `${await origin()}/billing` });
  redirect(portal.url);
}
