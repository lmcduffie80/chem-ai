import { sql } from "drizzle-orm";
import { Suspense } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";
import { RunsTable } from "./runs-table";

export const metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  await requirePlatformAdmin();
  const { rows } = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from chemicals)::int as chemicals,
      (select count(*) from chemicals where enriched_at is not null)::int as comptox,
      (select count(*) from chemicals where ghs_checked_at is not null)::int as ghs,
      (select count(*) from chemicals where embedding is not null)::int as embedded,
      (select count(*) from chemicals where safer_choice_status is not null)::int as scil,
      (select count(distinct chemical_id) from regulatory_listings)::int as regulated,
      (select count(*) from suppliers)::int as suppliers,
      (select count(*) from products)::int as products,
      (select count(*) from sds_documents where org_id is null)::int as sds,
      (select count(*) from sds_documents where org_id is not null)::int as uploads,
      (select count(*) from alternatives where status = 'pending')::int as pending_alternatives,
      (select count(*) from data_quality_issues where status = 'open')::int as open_issues,
      (select count(*) from organizations)::int as orgs,
      (select count(*) from users)::int as users,
      (select count(*) from subscriptions where status in ('active', 'trialing', 'past_due'))::int as active_subs
  `);
  const s = rows[0];
  const pct = (n: number) => (s.chemicals ? `${((100 * n) / s.chemicals).toFixed(1)}%` : "—");

  const cards = [
    { label: "Chemicals (TSCA)", value: s.chemicals.toLocaleString() },
    { label: "CompTox enriched", value: `${s.comptox.toLocaleString()} · ${pct(s.comptox)}` },
    { label: "GHS checked", value: `${s.ghs.toLocaleString()} · ${pct(s.ghs)}` },
    { label: "Embedded", value: `${s.embedded.toLocaleString()} · ${pct(s.embedded)}` },
    { label: "On SCIL", value: s.scil.toLocaleString() },
    { label: "On a regulatory list", value: s.regulated.toLocaleString() },
    { label: "Suppliers / products", value: `${s.suppliers} / ${s.products}` },
    { label: "SDS (licensed / uploaded)", value: `${s.sds} / ${s.uploads}` },
    { label: "Alternatives pending review", value: s.pending_alternatives },
    { label: "Open data-quality issues", value: s.open_issues },
    { label: "Organizations / users", value: `${s.orgs} / ${s.users}` },
    { label: "Active subscriptions", value: s.active_subs },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Platform overview</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-xl">{c.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <h2 className="text-lg font-medium">Recent ingestion runs</h2>
      <RunsTable limit={10} />
    </div>
  );
}
