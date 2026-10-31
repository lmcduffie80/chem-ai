import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";

const STATUS_VARIANT = { running: "outline", succeeded: "secondary", failed: "destructive" } as const;

function duration(start: Date, end: Date | null) {
  if (!end) return "—";
  const s = Math.round((end.getTime() - start.getTime()) / 1000);
  return s < 120 ? `${s}s` : `${Math.round(s / 60)}m`;
}

export async function RunsTable({ limit = 50 }: { limit?: number }) {
  const runs = await db.select().from(schema.ingestRuns).orderBy(desc(schema.ingestRuns.startedAt)).limit(limit);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Trigger</TableHead>
          <TableHead>Started</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Stats</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
              No runs yet.
            </TableCell>
          </TableRow>
        )}
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.source}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[r.status as keyof typeof STATUS_VARIANT] ?? "outline"}>{r.status}</Badge>
            </TableCell>
            <TableCell>{r.trigger}</TableCell>
            <TableCell className="text-xs">{r.startedAt.toLocaleString("en-US")}</TableCell>
            <TableCell>{duration(r.startedAt, r.finishedAt)}</TableCell>
            <TableCell className="max-w-md min-w-48 text-xs whitespace-normal">
              {r.error ? (
                <span className="text-destructive">{r.error.slice(0, 200)}</span>
              ) : (
                Object.entries(r.stats)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(" · ")
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
