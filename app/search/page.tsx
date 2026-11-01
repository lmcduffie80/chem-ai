import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { HazardBadge, ListBadge, SaferChoiceBadge, TscaBadge } from "@/components/chem-badges";
import { SearchBox } from "@/components/search-box";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { normalizeCas } from "@/lib/cas";
import { supplierRoleLabel } from "@/lib/product-sources";
import { REGULATORY_LIST_CODES, REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";
import {
  type ProductSearchResult,
  type SearchFilters,
  type SearchResult,
  searchChemicals,
  searchProducts,
} from "@/lib/search";

export const metadata: Metadata = { title: "Search" };

type Mode = "standard" | "products" | "ai";

const PAGE_SIZE = 25;
const PRODUCT_PREVIEW = 5;
/** Keeps offsets small for hostile `page` values. */
const MAX_PAGE = 1000;

type Params = Awaited<PageProps<"/search">["searchParams"]>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseFilters(sp: Params): SearchFilters {
  const list = first(sp.list);
  const maxHazard = first(sp.maxHazard);
  return {
    lists: list && list in REGULATORY_LISTS ? [list as RegulatoryListCode] : undefined,
    maxHazardScore: maxHazard ? Number(maxHazard) : undefined,
    tscaActiveOnly: first(sp.active) === "1",
  };
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Suspense fallback={<SearchSkeleton />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SearchContent({ searchParams }: Pick<PageProps<"/search">, "searchParams">) {
  const sp = await searchParams;
  const q = first(sp.q) ?? "";
  const modeParam = first(sp.mode);
  const mode: Mode = modeParam === "ai" || modeParam === "products" ? modeParam : "standard";
  const page = Math.min(Math.max(1, Number(first(sp.page) ?? 1) || 1), MAX_PAGE);
  const filters = parseFilters(sp);

  return (
    <div className={mode === "products" ? "space-y-6" : "grid gap-8 lg:grid-cols-[220px_1fr]"}>
      {mode !== "products" && (
        <aside className="space-y-6 text-sm">
          <FilterLinks q={q} sp={sp} />
        </aside>
      )}
      <div className="space-y-6">
        <SearchBox defaultValue={q} />
        <ModeTabs q={q} mode={mode} />
        {mode === "ai" ? (
          <Suspense fallback={<ResultsSkeleton />}>
            <AiResults q={q} filters={filters} />
          </Suspense>
        ) : mode === "products" ? (
          <ProductResults q={q} page={page} sp={sp} />
        ) : (
          <StandardResults q={q} filters={filters} page={page} sp={sp} />
        )}
      </div>
    </div>
  );
}

function pageHref(sp: Params, page: number) {
  return `/search?${new URLSearchParams({ ...(sp as Record<string, string>), page: String(page) })}`;
}

async function StandardResults({ q, filters, page, sp }: { q: string; filters: SearchFilters; page: number; sp: Params }) {
  if (!q && !filters.lists?.length) {
    return (
      <p className="text-muted-foreground">
        Enter a product name, a maker, a CAS number (e.g. 67-64-1), a chemical name, or a synonym.
      </p>
    );
  }
  const [results, products] = await Promise.all([
    searchChemicals(q, filters, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE),
    page === 1 ? searchProducts(q, PRODUCT_PREVIEW) : null,
  ]);
  const hasMore = results.length > PAGE_SIZE;

  return (
    <>
      {products && products.total > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-medium">Products</h2>
            {products.total > PRODUCT_PREVIEW && (
              <Link
                href={`/search?${new URLSearchParams({ q, mode: "products" })}`}
                className="text-muted-foreground text-sm hover:text-foreground hover:underline"
              >
                See all {products.total.toLocaleString()} products →
              </Link>
            )}
          </div>
          <ProductList results={products.results} />
        </section>
      )}
      <section className="space-y-3">
        {products && products.total > 0 && <h2 className="font-medium">Chemicals</h2>}
        <ResultList results={results.slice(0, PAGE_SIZE)} />
        <div className="flex justify-between text-sm">
          {page > 1 ? <Link href={pageHref(sp, page - 1)}>← Previous</Link> : <span />}
          {hasMore && <Link href={pageHref(sp, page + 1)}>Next →</Link>}
        </div>
      </section>
    </>
  );
}

async function ProductResults({ q, page, sp }: { q: string; page: number; sp: Params }) {
  if (!q) return <p className="text-muted-foreground">Enter a product name or a maker, e.g. “wood cleaner” or “Vi-Jon”.</p>;
  if (normalizeCas(q)) {
    return (
      <p className="text-muted-foreground">
        For a CAS number, open the{" "}
        <Link href={`/chemicals/${normalizeCas(q)}#products`} className="text-foreground hover:underline">
          chemical page
        </Link>{" "}
        to see every product that contains it.
      </p>
    );
  }
  const { total, results } = await searchProducts(q, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  if (results.length === 0) return <p className="text-muted-foreground">No products matched.</p>;
  return (
    <>
      <p className="text-muted-foreground text-sm">
        {total.toLocaleString()} products. Open one to see its alternates.
      </p>
      <ProductList results={results} />
      <div className="flex justify-between text-sm">
        {page > 1 ? <Link href={pageHref(sp, page - 1)}>← Previous</Link> : <span />}
        {page * PAGE_SIZE < total && <Link href={pageHref(sp, page + 1)}>Next →</Link>}
      </div>
    </>
  );
}

function ProductList({ results }: { results: ProductSearchResult[] }) {
  return (
    <ul className="divide-border/60 divide-y rounded-lg border">
      {results.map((p) => (
        <li key={p.id}>
          <Link href={`/products/${p.id}`} className="hover:bg-muted/40 flex flex-col gap-1 p-4 transition-colors">
            <span className="font-medium">{p.name}</span>
            <span className="text-muted-foreground text-sm">
              {[
                `${supplierRoleLabel(p.makerKind)} ${p.maker}`,
                p.category,
                p.documentDate?.slice(0, 4),
                p.sdsId ? "SDS on file" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function AiResults({ q, filters }: { q: string; filters: SearchFilters }) {
  const viewer = await getViewer();
  if (!can(viewer.plan, "aiSearch")) {
    return (
      <UpgradePrompt
        plan="pro"
        signedIn={Boolean(viewer.userId)}
        title="Natural-language search is a Pro feature"
        description='Ask questions like "chlorinated solvents not on Prop 65 with low aquatic toxicity".'
      />
    );
  }
  if (!q) return <p className="text-muted-foreground">Describe what you are looking for in plain language.</p>;
  const { aiSearch } = await import("@/lib/ai/search");
  const { interpretation, results } = await aiSearch(q, filters, viewer);
  return (
    <>
      <p className="text-muted-foreground text-sm">Interpreted as: {interpretation}</p>
      <ResultList results={results} />
    </>
  );
}

function ResultList({ results }: { results: SearchResult[] }) {
  if (results.length === 0) return <p className="text-muted-foreground">No chemicals matched.</p>;
  return (
    <ul className="divide-border/60 divide-y rounded-lg border">
      {results.map((r) => (
        <li key={r.id}>
          <Link href={`/chemicals/${r.casRn}`} className="hover:bg-muted/40 flex flex-col gap-2 p-4 transition-colors">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{r.preferredName}</span>
              <span className="text-muted-foreground font-mono text-sm">CAS {r.casRn}</span>
              {r.molecularFormula && <span className="text-muted-foreground text-sm">{r.molecularFormula}</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <HazardBadge score={r.hazardScore} />
              <TscaBadge status={r.tscaStatus} />
              <SaferChoiceBadge status={r.saferChoiceStatus} />
              {r.lists.map((code) => (
                <ListBadge key={code} code={code} />
              ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ModeTabs({ q, mode }: { q: string; mode: Mode }) {
  const tab = (value: Mode, label: string) => (
    <Link
      href={`/search?${new URLSearchParams({ q, ...(value === "standard" ? {} : { mode: value }) })}`}
      className={
        mode === value
          ? "bg-secondary text-foreground rounded-md px-3 py-1.5"
          : "text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5"
      }
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-1 text-sm">
      {tab("standard", "All")}
      {tab("products", "Products")}
      {tab("ai", "Natural language (Pro)")}
    </div>
  );
}

function FilterLinks({ q, sp }: { q: string; sp: Params }) {
  const current = first(sp.list);
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...(sp as Record<string, string>), ...patch, page: undefined, q })) {
      if (v) next.set(k, v);
    }
    return `/search?${next}`;
  };
  return (
    <>
      <div>
        <h3 className="mb-2 font-medium">Regulatory list</h3>
        <ul className="space-y-1">
          <li>
            <Link href={link({ list: undefined })} className={!current ? "text-foreground" : "text-muted-foreground"}>
              Any
            </Link>
          </li>
          {REGULATORY_LIST_CODES.map((code) => (
            <li key={code}>
              <Link href={link({ list: code })} className={current === code ? "text-foreground" : "text-muted-foreground"}>
                {REGULATORY_LISTS[code].label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-medium">Hazard</h3>
        <ul className="text-muted-foreground space-y-1">
          <li>
            <Link href={link({ maxHazard: undefined })}>Any</Link>
          </li>
          <li>
            <Link href={link({ maxHazard: "14" })}>Low only</Link>
          </li>
          <li>
            <Link href={link({ maxHazard: "39" })}>Low or moderate</Link>
          </li>
        </ul>
      </div>
      <div>
        <h3 className="mb-2 font-medium">TSCA</h3>
        <Link href={link({ active: first(sp.active) === "1" ? undefined : "1" })} className="text-muted-foreground">
          {first(sp.active) === "1" ? "✓ Active substances only" : "Active substances only"}
        </Link>
      </div>
    </>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <Skeleton className="h-64" />
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <ResultsSkeleton />
      </div>
    </div>
  );
}
