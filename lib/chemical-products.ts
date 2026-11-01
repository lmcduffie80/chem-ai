import { type SQL, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { CHEMEXPO_SOURCE } from "@/lib/product-sources";

export const PRODUCTS_PAGE_SIZE = 50;

/** First segment of a "General › Family › Type" category, or "Uncategorized". */
export function generalCategory(column: SQL) {
  return sql`coalesce(nullif(split_part(coalesce(${column}, ''), ' › ', 1), ''), 'Uncategorized')`;
}

export function productTotal(categories: { category: string; productCount: number }[], category: string | null) {
  return category
    ? (categories.find((c) => c.category === category)?.productCount ?? 0)
    : categories.reduce((sum, c) => sum + c.productCount, 0);
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
};

/** Products listing a chemical: licensed-feed products first, then highest share, then newest. */
export async function getChemicalProducts(chemicalId: number, category: string | null, page: number) {
  "use cache";
  cacheLife("days");
  cacheTag(`chemical-products:${chemicalId}`, "chemicals");
  const filter = category ? sql`and ${generalCategory(sql`p.category`)} = ${category}` : sql``;
  const { rows } = await db.execute<ChemicalProduct>(sql`
    with page as (
      select pc.product_id, min(pc.min_pct) as min_pct, max(pc.max_pct) as max_pct, max(pc.weight) as weight
      from product_components pc
      join products p on p.id = pc.product_id
      where pc.chemical_id = ${chemicalId} ${filter}
      group by pc.product_id, p.source, p.document_date, p.name
      order by (p.source = ${CHEMEXPO_SOURCE}) asc, max(pc.weight) desc nulls last, p.document_date desc nulls last, p.name
      limit ${PRODUCTS_PAGE_SIZE} offset ${(page - 1) * PRODUCTS_PAGE_SIZE}
    )
    select p.id, p.name, p.category, p.document_date::text as "documentDate", p.source,
      s.id as "supplierId", s.name as "supplierName", s.kind as "supplierKind",
      pg.min_pct as "minPct", pg.max_pct as "maxPct", pg.weight,
      sds.id as "sdsId", sds.revision_date::text as "sdsRevisionDate"
    from page pg
    join products p on p.id = pg.product_id
    join suppliers s on s.id = p.supplier_id
    left join lateral (
      select d.id, d.revision_date from sds_documents d
      where d.product_id = p.id
      order by d.revision_date desc nulls last
      limit 1
    ) sds on true
    order by (p.source = ${CHEMEXPO_SOURCE}) asc, pg.weight desc nulls last, p.document_date desc nulls last, p.name
  `);
  return rows;
}
