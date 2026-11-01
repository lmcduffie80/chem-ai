import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { HazardBadge, ListBadge } from "@/components/chem-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CompareRow, CompareSummary, ListChange, Share } from "@/lib/compare";
import { getProductComparison } from "@/lib/compare-query";
import { formatPctRange, manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";
import { REGULATORY_LISTS } from "@/lib/reglists-meta";
import { cn } from "@/lib/utils";

type Props = PageProps<"/products/[id]/compare/[otherId]">;
type Comparison = NonNullable<Awaited<ReturnType<typeof getProductComparison>>>;

const GROUP_TITLES: Record<CompareRow["group"], string> = {
  shared: "In both",
  only_a: "Only in this product",
  only_b: "Only in the alternate",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, otherId } = await params;
  const comparison = await getProductComparison(id, otherId);
  return { title: comparison ? `${comparison.a.name} vs ${comparison.b.name}` : "Comparison not found" };
}

export default function ComparePage({ params }: Props) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <CompareContent params={params} />
      </Suspense>
    </div>
  );
}

async function CompareContent({ params }: Pick<Props, "params">) {
  const { id, otherId } = await params;
  if (id === otherId) redirect(`/products/${id}`);
  const comparison = await getProductComparison(id, otherId);
  if (!comparison) notFound();
  const { a, b, rows, summary } = comparison;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          <Link href={`/products/${a.id}`} className="hover:underline">
            ← Back to {a.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Compare products</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ProductCard label="This product" product={a} />
        <ProductCard label="Alternate" product={b} />
      </div>

      <SummaryCard summary={summary} />

      <Card>
        <CardHeader>
          <CardTitle>Ingredients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {(["shared", "only_a", "only_b"] as const).map((group) => (
            <IngredientGroup key={group} title={GROUP_TITLES[group]} rows={rows.filter((r) => r.group === group)} />
          ))}
          <p className="text-muted-foreground text-xs">
            Based on formulations reported to EPA. Confirm against each manufacturer&apos;s current SDS before switching.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ProductCard({ label, product }: { label: string; product: Comparison["a"] }) {
  const sds = product.sdsDocuments[0];
  return (
    <Card>
      <CardHeader className="space-y-1">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
        <CardTitle className="text-lg">
          <Link href={`/products/${product.id}`} className="hover:underline">
            {product.name}
          </Link>
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          {supplierRoleLabel(product.supplier.kind)}{" "}
          <Link href={`/suppliers/${product.supplier.id}`} className="text-foreground hover:underline">
            {product.supplier.name}
          </Link>
        </p>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          {[product.category, product.documentDate && `Document dated ${product.documentDate}`].filter(Boolean).join(" · ") ||
            "No category reported"}
        </p>
        {sds ? (
          <Link href={`/sds/${sds.id}`} className="hover:underline">
            SDS{sds.revisionDate ? ` · revision ${sds.revisionDate}` : ""}
          </Link>
        ) : (
          <a
            href={manufacturerSdsSearchUrl(product.name, product.supplier.name, product.supplier.kind)}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            Find SDS ↗
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCard({ summary }: { summary: CompareSummary }) {
  return (
    <Card>
      <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Match"
          value={`${Math.round(summary.score * 100)}%`}
          detail="Weighted by reported amounts and how common each ingredient is"
        />
        <Stat
          label="Ingredients"
          value={`${summary.shared} shared`}
          detail={`${summary.onlyA} only in this product · ${summary.onlyB} only in the alternate`}
        />
        <Stat
          label="Hazardous ingredients"
          value={changeText(summary.hazardRemoved, summary.hazardAdded)}
          detail="Moderate or high hazard score"
        />
        <Stat
          label="Listed ingredients"
          value={changeText(summary.listedRemoved.count, summary.listedAdded.count)}
          detail={listDetail(summary.listedRemoved, summary.listedAdded)}
        />
        {summary.unassessed > 0 && (
          <p className="text-muted-foreground text-xs sm:col-span-2 lg:col-span-4">
            {summary.unassessed} {summary.unassessed === 1 ? "ingredient has" : "ingredients have"} no hazard assessment
            yet, so the hazard counts may be incomplete.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function changeText(removed: number, added: number) {
  if (removed === 0 && added === 0) return "No change";
  return [removed > 0 && `${removed} removed`, added > 0 && `${added} added`].filter(Boolean).join(", ");
}

function listDetail(removed: ListChange, added: ListChange) {
  const names = (change: ListChange) => change.lists.map((l) => REGULATORY_LISTS[l].label).join(", ");
  const parts = [removed.count > 0 && `Removes: ${names(removed)}`, added.count > 0 && `Adds: ${names(added)}`];
  return parts.filter(Boolean).join(" · ") || "Hazard-related regulatory lists";
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

function IngredientGroup({ title, rows }: { title: string; rows: CompareRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} ({rows.length})
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingredient</TableHead>
            <TableHead>CAS</TableHead>
            <TableHead>This product</TableHead>
            <TableHead>Alternate</TableHead>
            <TableHead>Hazard</TableHead>
            <TableHead>Lists</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} className={cn(r.isWater && "text-muted-foreground")}>
              <TableCell className="max-w-xs min-w-48 whitespace-normal">
                {r.name}
                {r.isWater && <div className="text-xs">Not counted in the match</div>}
                {!r.onTsca && <div className="text-muted-foreground text-xs">Not on TSCA · not counted</div>}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {r.casRn && r.onTsca ? (
                  <Link href={`/chemicals/${r.casRn}`} className="hover:underline">
                    {r.casRn}
                  </Link>
                ) : (
                  (r.casRn ?? "Proprietary")
                )}
              </TableCell>
              <TableCell>{shareText(r.a)}</TableCell>
              <TableCell>{shareText(r.b)}</TableCell>
              <TableCell className="whitespace-normal">
                {r.onTsca && !r.isWater ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <HazardBadge score={r.hazardScore} />
                    {r.signalWord && <span className="text-xs">{r.signalWord}</span>}
                  </div>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex flex-wrap gap-1">
                  {r.lists.map((code) => (
                    <ListBadge key={code} code={code} />
                  ))}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function shareText(share: Share | null) {
  if (!share) return <span className="text-muted-foreground">Absent</span>;
  if (share.minPct === null && share.maxPct === null) {
    return share.weight === null ? "Present" : `${Math.round(share.weight * 1000) / 10}%`;
  }
  return formatPctRange(share.minPct, share.maxPct);
}
