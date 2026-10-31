import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSdsLibrary, requireWorkspaceViewer } from "@/lib/workspace";
import { WorkspaceGate } from "../workspace-gate";
import { DeleteSdsButton, SdsUploadForm } from "./upload-form";

export const metadata: Metadata = { title: "SDS library" };

export default function SdsLibraryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Library />
    </Suspense>
  );
}

async function Library() {
  const access = await requireWorkspaceViewer("/workspace/sds");
  if (!access.workspaceEnabled) return <WorkspaceGate access={access} feature="The SDS library" />;
  const docs = await getSdsLibrary(access.orgId!);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">SDS library</h1>
        <p className="text-muted-foreground text-sm">
          Your organization&apos;s uploaded SDSs plus supplier SDSs for products in your inventory.
        </p>
      </div>

      {access.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload an SDS</CardTitle>
            <CardDescription>PDF up to 20 MB. Uploads are private to your organization and parsed automatically.</CardDescription>
          </CardHeader>
          <CardContent>
            <SdsUploadForm />
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Supplier</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead>Status</TableHead>
            {access.canEdit && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
                No SDS documents yet.
              </TableCell>
            </TableRow>
          )}
          {docs.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <Link href={`/sds/${d.id}`} className="font-medium hover:underline">
                  {d.title}
                </Link>
              </TableCell>
              <TableCell>{d.orgId ? <Badge variant="outline">Uploaded</Badge> : (d.supplierName ?? "—")}</TableCell>
              <TableCell>{d.revisionDate ?? "—"}</TableCell>
              <TableCell>
                {d.parseError ? (
                  <Badge variant="destructive">Parse failed</Badge>
                ) : d.parsedAt ? (
                  <Badge variant="secondary">Parsed</Badge>
                ) : (
                  <Badge variant="outline">Processing</Badge>
                )}
              </TableCell>
              {access.canEdit && <TableCell className="text-right">{d.orgId && <DeleteSdsButton id={d.id} />}</TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
