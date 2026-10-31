import { sql } from "drizzle-orm";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";

export const metadata = { title: "Usage" };

export default function UsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Usage />
    </Suspense>
  );
}

async function Usage() {
  await requirePlatformAdmin();
  const [byKind, daily, top] = await Promise.all([
    db.execute<{ kind: string; month: number; last30: number }>(sql`
      select kind::text,
        count(*) filter (where created_at >= date_trunc('month', now()))::int as month,
        count(*) filter (where created_at >= now() - interval '30 days')::int as last30
      from usage_events group by kind order by kind
    `),
    db.execute<{ day: string; n: number }>(sql`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n
      from usage_events where created_at >= now() - interval '30 days'
      group by 1 order by 1
    `),
    db.execute<{ owner_type: string; owner_id: string; label: string | null; kind: string; n: number }>(sql`
      select e.owner_type::text, e.owner_id, coalesce(o.name, u.email) as label, e.kind::text, count(*)::int as n
      from usage_events e
      left join organizations o on e.owner_type = 'org' and o.id = e.owner_id
      left join users u on e.owner_type = 'user' and u.id = e.owner_id
      where e.created_at >= date_trunc('month', now())
      group by 1, 2, 3, 4 order by n desc limit 25
    `),
  ]);
  const counts = new Map(daily.rows.map((d) => [d.day, d.n]));
  const today = new Date();
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 29 + i));
    const day = d.toISOString().slice(0, 10);
    return { day, n: counts.get(day) ?? 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.n));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Usage</h1>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {byKind.rows.map((k) => (
          <Card key={k.kind}>
            <CardHeader>
              <CardDescription>{k.kind}</CardDescription>
              <CardTitle className="text-xl">{k.month.toLocaleString()}</CardTitle>
              <CardDescription>this month · {k.last30.toLocaleString()} in 30 days</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events per day (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {daily.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No usage yet.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {days.map((d) => (
                <div
                  key={d.day}
                  className={d.n ? "bg-primary/70 flex-1 rounded-t" : "bg-muted flex-1 rounded-t"}
                  style={{ height: d.n ? `${(100 * d.n) / max}%` : "2px" }}
                  title={`${d.day}: ${d.n}`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top consumers this month</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Events</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.rows.map((t) => (
                <TableRow key={`${t.owner_id}-${t.kind}`}>
                  <TableCell>
                    <div className="font-medium">{t.label ?? t.owner_id}</div>
                    <div className="text-muted-foreground text-xs">
                      {t.owner_type} · {t.owner_id}
                    </div>
                  </TableCell>
                  <TableCell>{t.kind}</TableCell>
                  <TableCell className="text-right">{t.n.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
