import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HazardBadge, ListBadge } from "@/components/chem-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RegulatoryListCode } from "@/db/schema";
import { getInventory, requireWorkspaceViewer } from "@/lib/workspace";
import { WorkspaceGate } from "../workspace-gate";
import { InventoryForm, RemoveInventoryButton } from "./inventory-form";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Inventory />
    </Suspense>
  );
}

async function Inventory() {
  const access = await requireWorkspaceViewer("/workspace/inventory");
  if (!access.workspaceEnabled) return <WorkspaceGate access={access} feature="Chemical inventory" />;
  const items = await getInventory(access.orgId!);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chemical inventory</h1>
          <p className="text-muted-foreground text-sm">{items.length} items</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/api/workspace/export?type=inventory">
            <Download /> Export CSV
          </a>
        </Button>
      </div>

      {access.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add item</CardTitle>
          </CardHeader>
          <CardContent>
            <InventoryForm />
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead>CAS</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Hazard</TableHead>
            <TableHead>Lists</TableHead>
            {access.canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                No inventory yet.
              </TableCell>
            </TableRow>
          )}
          {items.map(({ item, casRn, hazardScore, listCodes }) => (
            <TableRow key={item.id}>
              <TableCell className="font-medium">{item.label}</TableCell>
              <TableCell className="font-mono text-xs">
                {casRn ? (
                  <Link href={`/chemicals/${casRn}`} className="hover:underline">
                    {casRn}
                  </Link>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell>{item.location ?? "—"}</TableCell>
              <TableCell>{item.quantity !== null ? `${item.quantity} ${item.unit ?? ""}` : "—"}</TableCell>
              <TableCell>
                <HazardBadge score={hazardScore} />
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {listCodes.map((code) => (
                    <ListBadge key={code} code={code as RegulatoryListCode} />
                  ))}
                </div>
              </TableCell>
              {access.canEdit && (
                <TableCell className="text-right">
                  <RemoveInventoryButton id={item.id} />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
