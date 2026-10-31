import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PLANS } from "@/lib/entitlements";
import { getInventory, getRelevantChanges, getSdsLibrary, getWatchlist, requireWorkspaceViewer } from "@/lib/workspace";
import { ChangesList } from "./changes-list";
import { WorkspaceGate } from "./workspace-gate";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const access = await requireWorkspaceViewer("/workspace");
  const [inventory, library, watchlist, changes] = await Promise.all([
    access.workspaceEnabled ? getInventory(access.orgId!) : [],
    access.workspaceEnabled ? getSdsLibrary(access.orgId!) : [],
    getWatchlist(access),
    getRelevantChanges(access, 10),
  ]);

  const stats = [
    { label: "Inventory items", value: inventory.length, href: "/workspace/inventory" },
    { label: "SDS documents", value: library.length, href: "/workspace/sds" },
    { label: "Watched chemicals", value: watchlist.length, href: "/workspace/watchlist" },
    { label: "Regulated in inventory", value: inventory.filter((i) => i.listCodes.length > 0).length, href: "/workspace/inventory" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Workspace</h1>
        <p className="text-muted-foreground text-sm">
          Plan: {PLANS[access.plan].label}
          {access.orgRole && ` · Role: ${access.orgRole}`}
        </p>
      </div>
      <WorkspaceGate access={access} feature="The workspace" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="hover:border-primary/50 transition-colors">
              <CardHeader>
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl">{s.value}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent regulatory changes</CardTitle>
          <CardDescription>For chemicals you watch or stock.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangesList changes={changes} />
        </CardContent>
      </Card>
    </div>
  );
}
