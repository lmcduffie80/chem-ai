import { sql } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { HazardBadge, SaferChoiceBadge } from "@/components/chem-badges";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";
import { ReviewButtons } from "./review-buttons";

export const metadata = { title: "Alternatives review" };

const STATUSES = ["pending", "approved", "rejected"] as const;

type Row = {
  id: number;
  status: (typeof STATUSES)[number];
  score: number;
  hazard_delta: number | null;
  function_class: string | null;
  rationale: string | null;
  method: string;
  target_cas: string;
  target_name: string;
  target_hazard: number | null;
  alt_cas: string;
  alt_name: string;
  alt_hazard: number | null;
  alt_safer_choice: string | null;
};

export default function AlternativesReviewPage({ searchParams }: PageProps<"/admin/alternatives">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Review searchParams={searchParams} />
    </Suspense>
  );
}

async function Review({ searchParams }: Pick<PageProps<"/admin/alternatives">, "searchParams">) {
  await requirePlatformAdmin();
  const { status: statusParam } = await searchParams;
  const status = STATUSES.find((s) => s === statusParam) ?? "pending";

  const { rows } = await db.execute<Row>(sql`
    select a.id, a.status, a.score, a.hazard_delta, a.function_class, a.rationale, a.method,
      t.cas_rn as target_cas, t.preferred_name as target_name, t.hazard_score as target_hazard,
      c.cas_rn as alt_cas, c.preferred_name as alt_name, c.hazard_score as alt_hazard, c.safer_choice_status as alt_safer_choice
    from alternatives a
    join chemicals t on t.id = a.chemical_id
    join chemicals c on c.id = a.alt_chemical_id
    where a.status = ${status}
    order by t.preferred_name, a.score desc
    limit 200
  `);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Alternatives review</h1>
        <p className="text-muted-foreground text-sm">
          Approved suggestions show an &quot;Expert reviewed&quot; badge to customers; rejected ones are hidden everywhere.
        </p>
        <div className="flex gap-2">
          {STATUSES.map((s) => (
            <Link key={s} href={`/admin/alternatives?status=${s}`}>
              <Badge variant={s === status ? "default" : "outline"}>{s}</Badge>
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing to review.</p>
      ) : (
        <ul className="divide-border/60 divide-y">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-2 py-4 md:grid-cols-[1fr_auto]">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/chemicals/${r.target_cas}`} className="font-medium hover:underline">
                    {r.target_name}
                  </Link>
                  <HazardBadge score={r.target_hazard} />
                  <span className="text-muted-foreground">→</span>
                  <Link href={`/chemicals/${r.alt_cas}`} className="font-medium hover:underline">
                    {r.alt_name}
                  </Link>
                  <HazardBadge score={r.alt_hazard} />
                  <SaferChoiceBadge status={r.alt_safer_choice} />
                  <Badge variant="outline">score {Math.round(r.score)}</Badge>
                  <Badge variant="outline">{r.method}</Badge>
                  {r.function_class && <Badge variant="outline">{r.function_class}</Badge>}
                </div>
                {r.rationale && <p className="text-muted-foreground text-sm">{r.rationale}</p>}
              </div>
              <ReviewButtons id={r.id} status={r.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
