import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { db, schema } from "@/db";
import { can, PLANS } from "@/lib/entitlements";
import { countUsageThisMonth } from "@/lib/usage";
import { requireWorkspaceViewer } from "@/lib/workspace";
import { WorkspaceGate } from "../workspace-gate";
import { CreateKeyForm, RevokeKeyButton } from "./key-forms";

export const metadata: Metadata = { title: "API keys" };

export default function ApiKeysPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ApiKeys />
    </Suspense>
  );
}

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "Never");

async function ApiKeys() {
  const access = await requireWorkspaceViewer("/workspace/api-keys");
  if (!access.orgId) return <WorkspaceGate access={access} feature="API access" />;
  if (!can(access.orgPlan, "api")) {
    return (
      <UpgradePrompt
        plan="enterprise"
        title="API access requires Enterprise"
        description="Query chemicals, alternatives and SDS data from your own systems with organization API keys."
      />
    );
  }

  const [keys, used] = await Promise.all([
    db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, access.orgId)).orderBy(desc(schema.apiKeys.createdAt)),
    countUsageThisMonth(access.orgId, "api_request"),
  ]);
  const isAdmin = access.orgRole === "admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-muted-foreground text-sm">
          {used.toLocaleString()} of {PLANS.enterprise.apiRequestsPerMonth.toLocaleString()} requests used this month ·{" "}
          <Link href="/docs/api" className="underline underline-offset-4">
            API documentation
          </Link>
        </p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a key</CardTitle>
            <CardDescription>The key is shown once. Store it in a secret manager.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateKeyForm />
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Status</TableHead>
            {isAdmin && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                No API keys yet.
              </TableCell>
            </TableRow>
          )}
          {keys.map((k) => (
            <TableRow key={k.id}>
              <TableCell className="font-medium">{k.name}</TableCell>
              <TableCell className="font-mono text-xs">cs_{k.prefix}_••••</TableCell>
              <TableCell>{fmt(k.createdAt)}</TableCell>
              <TableCell>{fmt(k.lastUsedAt)}</TableCell>
              <TableCell>
                {k.revokedAt ? <Badge variant="destructive">Revoked</Badge> : <Badge variant="secondary">Active</Badge>}
              </TableCell>
              {isAdmin && <TableCell className="text-right">{!k.revokedAt && <RevokeKeyButton id={k.id} />}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
