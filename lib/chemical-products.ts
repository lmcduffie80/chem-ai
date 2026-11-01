import { type SQL, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { chemicalTag } from "@/lib/ingest/invalidate";
import { CHEMEXPO_SOURCE } from "@/lib/product-sources";

export const PRODUCTS_PAGE_SIZE = 50;

/** First segment of a "General › Family › Type" category, or "Uncategorized". */
export function generalCategory(column: SQL) {
  return sql`coalesce(nullif(split_part(coalesce(${column}, ''), ' › ', 1), ''), 'Uncategorized')`;
}

/** Keeps offsets well inside Postgres bigint range for hostile `page` values. */
export const MAX_PRODUCTS_PAGE = 10_000;

/** A 1-based page number from a query value; anything malformed or out of range becomes 1 or the cap. */
export function parseProductsPage(value: string | null | undefined) {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), MAX_PRODUCTS_PAGE);
}

/** The requested category if this chemical has products in it, else null (all categories). */
export function parseProductsCategory(value: string | null | undefined, categories: { category: string }[]) {
  return value && categories.some((c) => c.category === value) ? value : null;
}

export type ChemicalProduct = {
  id: string;
  name: string;
  category: string | null;
  documentDate: string | null;
  source: string;
  supplierId: string;
  supplierName: string;
  supplierKind: string;
  minPct: number | null;
  maxPct: number | null;
  weight: number | null;
  sdsId: string | null;
  sdsRevisionDate: string | null;
  sdsLanguage: string | null;
  sdsRegion: string | null;
};

/** Products listing a chemical: licensed-feed products first, then highest share, then newest. */
export async function getChemicalProducts(
  chemicalId: number,
  casRn: string,
  category: string | null,
  page: number,
): Promise<{ total: number; products: ChemicalProduct[] }> {
  "use cache";
  cacheLife("days");
  cacheTag(`chemical-products:${chemicalId}`, chemicalTag(casRn), "chemicals");
  const filter = category ? sql`and ${generalCategory(sql`p.category`)} = ${category}` : sql``;
  const count = db.execute<{ total: number }>(sql`
    select count(distinct pc.product_id)::int as total
    from product_components pc
    join products p on p.id = pc.product_id
    where pc.chemical_id = ${chemicalId} ${filter}
  `);
  const list = db.execute<ChemicalProduct>(sql`
    with page as (
      select pc.product_id, min(pc.min_pct) as min_pct, max(pc.max_pct) as max_pct, max(pc.weight) as weight
      from product_components pc
      join products p on p.id = pc.product_id
      where pc.chemical_id = ${chemicalId} ${filter}
      group by pc.product_id, p.source, p.document_date, p.name
      order by (p.source = ${CHEMEXPO_SOURCE}) asc, max(pc.weight) desc nulls last, p.document_date desc nulls last, p.name, pc.product_id
      limit ${PRODUCTS_PAGE_SIZE} offset ${(page - 1) * PRODUCTS_PAGE_SIZE}
    )
    select p.id, p.name, p.category, p.document_date::text as "documentDate", p.source,
      s.id as "supplierId", s.name as "supplierName", s.kind as "supplierKind",
      pg.min_pct as "minPct", pg.max_pct as "maxPct", pg.weight,
      sds.id as "sdsId", sds.revision_date::text as "sdsRevisionDate",
      sds.language as "sdsLanguage", sds.region as "sdsRegion"
    from page pg
    join products p on p.id = pg.product_id
    join suppliers s on s.id = p.supplier_id
    left join lateral (
      select d.id, d.revision_date, d.language, d.region from sds_documents d
      where d.product_id = p.id
      order by d.revision_date desc nulls last
      limit 1
    ) sds on true
    order by (p.source = ${CHEMEXPO_SOURCE}) asc, pg.weight desc nulls last, p.document_date desc nulls last, p.name, p.id
  `);
  const [{ rows: counts }, { rows: products }] = await Promise.all([count, list]);
  return { total: counts[0]?.total ?? 0, products };
}
