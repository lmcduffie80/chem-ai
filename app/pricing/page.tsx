import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { startCheckout } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanTier } from "@/db/schema";
import { PLANS } from "@/lib/entitlements";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Chemspace plans for individuals, EHS teams and enterprise data programs.",
};

const ORDER: PlanTier[] = ["free", "pro", "team", "enterprise"];

export default function PricingPage() {
  const salesEmail = process.env.NEXT_PUBLIC_SALES_EMAIL ?? "sales@chemspace.app";
  const enterpriseSelfServe = Boolean(process.env.STRIPE_PRICE_ENTERPRISE);

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-muted-foreground">
          Every plan includes the full EPA TSCA inventory, GHS hazards and regulatory listings. Upgrade for SDS access,
          safer alternatives, team workspaces and the API.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {ORDER.map((tier) => {
          const plan = PLANS[tier];
          return (
            <Card key={tier} className={tier === "team" ? "border-primary/60" : undefined}>
              <CardHeader>
                <CardTitle>{plan.label}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <p className="pt-2 text-3xl font-semibold">{plan.price}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  {plan.highlights.map((h) => (
                    <li key={h} className="flex gap-2">
                      <Check className="text-primary mt-0.5 size-4 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {tier === "free" ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/search">Start searching</Link>
                  </Button>
                ) : tier === "enterprise" && !enterpriseSelfServe ? (
                  <Button asChild variant="outline" className="w-full">
                    <a href={`mailto:${salesEmail}?subject=Chemspace%20Enterprise`}>Contact sales</a>
                  </Button>
                ) : (
                  <form action={startCheckout} className="w-full">
                    <input type="hidden" name="plan" value={tier} />
                    <Button type="submit" className="w-full" variant={tier === "team" ? "default" : "secondary"}>
                      Choose {plan.label}
                    </Button>
                  </form>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <p className="text-muted-foreground text-center text-sm">
        Team and Enterprise are billed to your organization. Create or switch to an organization from the account menu
        first.
      </p>
    </div>
  );
}
