import "server-only";
import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { db, schema } from "@/db";
import type { PlanTier } from "@/db/schema";

export type BillingOwner = { ownerType: "user" | "org"; ownerId: string };
type PaidPlan = Exclude<PlanTier, "free">;

let client: Stripe | null = null;

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

export function isBillingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function priceIdFor(plan: PaidPlan): string | null {
  const env = { pro: "STRIPE_PRICE_PRO", team: "STRIPE_PRICE_TEAM", enterprise: "STRIPE_PRICE_ENTERPRISE" }[plan];
  return process.env[env] || null;
}

function planForPrice(priceId: string | undefined): PlanTier | null {
  if (!priceId) return null;
  for (const plan of ["enterprise", "team", "pro"] as const) {
    if (priceIdFor(plan) === priceId) return plan;
  }
  return null;
}

/** Reuses the customer stored on the user/org row, creating one in Stripe the first time. */
export async function getOrCreateCustomer(owner: BillingOwner, details: { email?: string | null; name?: string | null }) {
  const table = owner.ownerType === "org" ? schema.organizations : schema.users;
  const [row] = await db.select({ customerId: table.stripeCustomerId }).from(table).where(eq(table.id, owner.ownerId));
  if (row?.customerId) return row.customerId;

  const customer = await stripe().customers.create({
    email: details.email ?? undefined,
    name: details.name ?? undefined,
    metadata: { ownerType: owner.ownerType, ownerId: owner.ownerId },
  });
  await db.update(table).set({ stripeCustomerId: customer.id }).where(eq(table.id, owner.ownerId));
  return customer.id;
}

export async function customerIdFor(owner: BillingOwner) {
  const table = owner.ownerType === "org" ? schema.organizations : schema.users;
  const [row] = await db.select({ customerId: table.stripeCustomerId }).from(table).where(eq(table.id, owner.ownerId));
  return row?.customerId ?? null;
}

/** Mirrors a Stripe subscription into Postgres. Owner identity travels in subscription metadata. */
export async function syncSubscription(sub: Stripe.Subscription) {
  const ownerType = sub.metadata.ownerType as BillingOwner["ownerType"] | undefined;
  const ownerId = sub.metadata.ownerId;
  if ((ownerType !== "user" && ownerType !== "org") || !ownerId) {
    console.warn(`Stripe subscription ${sub.id} has no Chemspace owner metadata; ignoring`);
    return;
  }

  const item = sub.items.data[0];
  const plan = planForPrice(item?.price.id) ?? (sub.metadata.plan as PlanTier | undefined) ?? null;
  if (!plan || plan === "free") {
    console.warn(`Stripe subscription ${sub.id} uses an unknown price ${item?.price.id}; ignoring`);
    return;
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const currentPeriodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  await db
    .insert(schema.subscriptions)
    .values({
      id: sub.id,
      ownerType,
      ownerId,
      stripeCustomerId: customerId,
      plan,
      status: sub.status,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: schema.subscriptions.id,
      set: {
        plan,
        status: sub.status,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        stripeCustomerId: customerId,
        updatedAt: sql`now()`,
      },
    });
}
