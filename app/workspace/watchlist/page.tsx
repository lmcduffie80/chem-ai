import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HazardBadge, ListBadge } from "@/components/chem-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import type { RegulatoryListCode } from "@/db/schema";
import { can } from "@/lib/entitlements";
import { getRelevantChanges, getWatchlist, requireWorkspaceViewer } from "@/lib/workspace";
import { WatchToggle } from "@/app/chemicals/[cas]/watch-toggle";
import { ChangesList } from "../changes-list";

export const metadata: Metadata = { title: "Watchlist & alerts" };

export default function WatchlistPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Watchlist />
    </Suspense>
  );
}

async function Watchlist() {
  const access = await requireWorkspaceViewer("/workspace/watchlist");
  if (!can(access.plan, "watchlists")) {
    return (
      <UpgradePrompt
        plan="pro"
        title="Watchlists require Pro"
        description="Watch chemicals to track regulatory list changes. Team plans add email alerts for the whole organization."
      />
    );
  }
  const [items, changes] = await Promise.all([getWatchlist(access), getRelevantChanges(access)]);
  const alerts = can(access.plan, "regulatoryAlerts");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Watchlist & alerts</h1>
          <p className="text-muted-foreground text-sm">
            {alerts
              ? "Watchers get a daily email when a watched chemical is added to or removed from a regulatory list."
              : "Upgrade to Team for email alerts; changes are always listed here."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/api/workspace/export?type=watchlist">
            <Download /> Export CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Watched chemicals ({items.length})</CardTitle>
          <CardDescription>Add chemicals from any chemical page.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing watched yet. <Link href="/search" className="underline underline-offset-4">Search for a chemical</Link>{" "}
              and choose &quot;Watch for changes&quot;.
            </p>
          ) : (
            <ul className="divide-border/60 divide-y">
              {items.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link href={`/chemicals/${w.casRn}`} className="font-medium hover:underline">
                    {w.name}
                  </Link>
                  <span className="text-muted-foreground font-mono text-xs">{w.casRn}</span>
                  {w.ownerType === "org" && <Badge variant="outline">Team</Badge>}
                  <HazardBadge score={w.hazardScore} />
                  {w.listCodes.map((code) => (
                    <ListBadge key={code} code={code as RegulatoryListCode} />
                  ))}
                  <div className="ml-auto">
                    <WatchToggle chemicalId={w.chemicalId} watching state="ok" ownerType={w.ownerType} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regulatory changes</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangesList changes={changes} />
        </CardContent>
      </Card>
    </div>
  );
}
