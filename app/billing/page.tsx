import { and, eq, or } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { openBillingPortal, startCheckout } from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db, schema } from "@/db";
import type { PlanTier } from "@/db/schema";
import { getViewer } from "@/lib/auth";
import { isBillingConfigured } from "@/lib/billing/stripe";
import { PLANS } from "@/lib/entitlements";

export const metadata: Metadata = { title: "Billing" };

const MESSAGES: Record<string, string> = {
  org_required: "Team and Enterprise plans belong to an organization. Create or switch to one from the account menu, then try again.",
  org_admin_required: "Only organization admins can manage the organization's subscription.",
  unconfigured: "Billing is not configured for this plan yet.",
  contact_sales: "Enterprise is sold through our sales team.",
};

export default function BillingPage({ searchParams }: PageProps<"/billing">) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">Billing</h1>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <BillingContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BillingContent({ searchParams }: Pick<PageProps<"/billing">, "searchParams">) {
  const params = await searchParams;
  const viewer = await getViewer();
  if (!viewer.userId) redirect("/sign-in?redirect_url=/billing");

  const error = typeof params.error === "string" ? MESSAGES[params.error] : null;
  const requested = typeof params.plan === "string" && params.plan in PLANS ? (params.plan as PlanTier) : null;

  const subs = await db
    .select()
    .from(schema.subscriptions)
    .where(
      or(
        and(eq(schema.subscriptions.ownerType, "user"), eq(schema.subscriptions.ownerId, viewer.userId)),
        viewer.orgId ? and(eq(schema.subscriptions.ownerType, "org"), eq(schema.subscriptions.ownerId, viewer.orgId)) : undefined,
      ),
    );

  return (
    <div className="space-y-6">
      {params.success && (
        <p className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300">
          Thanks! Your subscription is being activated. It can take a few seconds to appear.
        </p>
      )}
      {error && <p className="border-border bg-muted/40 rounded-md border p-3 text-sm">{error}</p>}
      {!isBillingConfigured() && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Stripe is not configured in this environment.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current access: {PLANS[viewer.plan].label}</CardTitle>
          <CardDescription>
            Personal plan: {PLANS[viewer.userPlan].label}
            {viewer.orgId && ` · Organization plan: ${PLANS[viewer.orgPlan].label}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {subs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No subscriptions yet.</p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {subs.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      {PLANS[s.plan].label} <Badge variant="outline">{s.ownerType === "org" ? "Organization" : "Personal"}</Badge>
                      <Badge variant={s.status === "active" || s.status === "trialing" ? "secondary" : "destructive"}>{s.status}</Badge>
                    </div>
                    {s.currentPeriodEnd && (
                      <p className="text-muted-foreground text-sm">
                        {s.cancelAtPeriodEnd ? "Ends" : "Renews"} {s.currentPeriodEnd.toLocaleDateString("en-US", { dateStyle: "medium" })}
                      </p>
                    )}
                  </div>
                  {(s.ownerType === "user" || viewer.orgRole === "admin") && (
                    <form action={openBillingPortal}>
                      <input type="hidden" name="ownerType" value={s.ownerType} />
                      <Button type="submit" variant="outline" size="sm">
                        Manage
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {requested && requested !== "free" && viewer.plan !== requested && (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade to {PLANS[requested].label}</CardTitle>
            <CardDescription>{PLANS[requested].description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={startCheckout}>
              <input type="hidden" name="plan" value={requested} />
              <Button type="submit">Continue to checkout · {PLANS[requested].price}</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-sm">
        Compare plans on the{" "}
        <Link href="/pricing" className="underline underline-offset-4">
          pricing page
        </Link>
        .
      </p>
    </div>
  );
}
