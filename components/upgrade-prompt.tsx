import { Lock } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { PlanTier } from "@/db/schema";
import { PLANS } from "@/lib/entitlements";

export function UpgradePrompt({
  plan,
  title,
  description,
  signedIn = true,
}: {
  plan: PlanTier;
  title: string;
  description: string;
  signedIn?: boolean;
}) {
  return (
    <div className="border-border bg-muted/30 flex flex-col items-start gap-3 rounded-lg border border-dashed p-5">
      <div className="flex items-center gap-2 font-medium">
        <Lock className="size-4" />
        {title}
      </div>
      <p className="text-muted-foreground text-sm">{description}</p>
      <Button asChild size="sm">
        <Link href={signedIn ? `/billing?plan=${plan}` : "/sign-in"}>
          {signedIn ? `Upgrade to ${PLANS[plan].label}` : "Sign in to continue"}
        </Link>
      </Button>
    </div>
  );
}
