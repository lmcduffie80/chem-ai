import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";
import { INGEST_JOBS } from "@/lib/ingest/jobs";
import { REGULATORY_LIST_CODES, REGULATORY_LISTS } from "@/lib/reglists-meta";
import { RunsTable } from "../runs-table";
import { RemoveSourceButton, SourceUploadForm, TriggerButton } from "./controls";

export const metadata = { title: "Ingestion" };

export default function IngestionPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Ingestion />
    </Suspense>
  );
}

async function Ingestion() {
  await requirePlatformAdmin();
  const uploads = await db.select().from(schema.sourceFiles);
  const sources = [
    { key: "tsca", label: "EPA TSCA Inventory", envVar: "TSCA_INVENTORY_URL" },
    { key: "scil", label: "Safer Chemical Ingredients List", envVar: "SCIL_CSV_URL" },
    ...REGULATORY_LIST_CODES.map((code) => ({
      key: `reglist:${code}`,
      label: REGULATORY_LISTS[code].label,
      envVar: REGULATORY_LISTS[code].envVar,
    })),
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Ingestion</h1>
        <p className="text-muted-foreground text-sm">
          Jobs run as durable workflows on the cron schedule in <code>vercel.json</code>. Trigger one manually below.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(INGEST_JOBS).map(([job, { label }]) => (
          <Card key={job}>
            <CardHeader>
              <CardTitle className="text-sm">{label}</CardTitle>
              <CardDescription className="font-mono text-xs">{job}</CardDescription>
            </CardHeader>
            <CardContent>
              <TriggerButton job={job} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Source files</CardTitle>
          <CardDescription>
            An uploaded file overrides the configured URL for that source until removed. CSV or ZIP for TSCA and lists;
            CSV or the saved SCIL web page for SCIL.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Configured URL</TableHead>
                <TableHead>Override</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((s) => {
                const upload = uploads.find((u) => u.key === s.key);
                const url = process.env[s.envVar];
                return (
                  <TableRow key={s.key}>
                    <TableCell className="font-medium">{s.label}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs">
                      {url ? url : <span className="text-amber-300">{s.envVar} not set</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {upload ? `${upload.filename} · ${upload.updatedAt.toLocaleDateString("en-US")}` : "—"}
                    </TableCell>
                    <TableCell className="text-right">{upload && <RemoveSourceButton sourceKey={s.key} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <SourceUploadForm sources={sources.map(({ key, label }) => ({ key, label }))} />
        </CardContent>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Run history</h2>
        <RunsTable />
      </div>
    </div>
  );
}
