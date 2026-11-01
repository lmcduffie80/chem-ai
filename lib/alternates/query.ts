import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { WATER_CAS } from "./score";

/** Candidates come from products sharing the source's rarest ingredients. */
const SEED_INGREDIENTS = 3;
const MAX_CANDIDATES = 2000;
const MAX_RESULTS = 50;
export const CLOSE_MATCH = 0.5;

export type Alternate = {
  id: string;
  name: string;
  category: string | null;
  documentDate: string | null;
  makerId: string;
  maker: string;
  makerKind: string;
  score: number;
  sharedCount: number;
  addedCount: number;
  shared: { casRn: string; name: string }[];
  sdsId: string | null;
};

export type AlternatesResult =
  | { status: "ok"; sourceCount: number; close: Alternate[]; partial: Alternate[] }
  | { status: "no_ingredients" }
  | { status: "unavailable" };

/**
 * Weighted Jaccard over IDF-weighted ingredient shares; mirrors `ingredientWeights` and
 * `weightedJaccard` in `./score.ts`.
 */
export async function queryProductAlternates(productId: string): Promise<AlternatesResult> {
  const { rows } = await db.execute<Alternate>(sql`
    with total as (
      select greatest(count(*), 1)::float8 as n from products
    ),
    water as (
      select id from chemicals where cas_rn = ${WATER_CAS}
    ),
    src_raw as (
      select pc.chemical_id, max(pc.weight) as weight
      from product_components pc
      where pc.product_id = ${productId}
        and pc.chemical_id is not null
        and pc.chemical_id is distinct from (select id from water)
      group by pc.chemical_id
    ),
    src as (
      select s.chemical_id, f.product_count,
        coalesce(s.weight, 1.0 / count(*) over ()) * ln((select n from total) / greatest(f.product_count, 1)) as w
      from src_raw s
      left join chemical_doc_freq f on f.chemical_id = s.chemical_id
    ),
    seeds as (
      select chemical_id from src order by product_count asc nulls first limit ${SEED_INGREDIENTS}
    ),
    candidates as (
      select pc.product_id
      from product_components pc
      join seeds on seeds.chemical_id = pc.chemical_id
      join products p on p.id = pc.product_id
      where pc.product_id <> ${productId}
      group by pc.product_id, p.document_date
      order by p.document_date desc nulls last
      limit ${MAX_CANDIDATES}
    ),
    cand_raw as (
      select pc.product_id, pc.chemical_id, max(pc.weight) as weight
      from product_components pc
      join candidates c on c.product_id = pc.product_id
      where pc.chemical_id is not null
        and pc.chemical_id is distinct from (select id from water)
      group by pc.product_id, pc.chemical_id
    ),
    cand as (
      select r.product_id, r.chemical_id,
        coalesce(r.weight, 1.0 / count(*) over (partition by r.product_id))
          * ln((select n from total) / greatest(f.product_count, 1)) as w
      from cand_raw r
      left join chemical_doc_freq f on f.chemical_id = r.chemical_id
    ),
    cand_totals as (
      select product_id, sum(w) as total_w, count(*) as ingredient_count from cand group by product_id
    ),
    shared as (
      select c.product_id,
        sum(least(s.w, c.w)) as min_sum,
        sum(greatest(s.w, c.w)) as max_sum,
        sum(s.w) as src_shared,
        sum(c.w) as cand_shared,
        count(*) as shared_count,
        json_agg(json_build_object('casRn', ch.cas_rn, 'name', ch.preferred_name) order by s.w desc) as shared
      from cand c
      join src s on s.chemical_id = c.chemical_id
      join chemicals ch on ch.id = c.chemical_id
      group by c.product_id
    ),
    scored as (
      select sh.*, t.ingredient_count,
        sh.min_sum / nullif(sh.max_sum + ((select sum(w) from src) - sh.src_shared) + (t.total_w - sh.cand_shared), 0) as score
      from shared sh
      join cand_totals t on t.product_id = sh.product_id
    )
    select p.id, p.name, p.category, p.document_date::text as "documentDate",
      s.id as "makerId", s.name as maker, s.kind as "makerKind",
      coalesce(sc.score, 0)::float8 as score,
      sc.shared_count::int as "sharedCount",
      (sc.ingredient_count - sc.shared_count)::int as "addedCount",
      sc.shared,
      (select d.id from sds_documents d where d.product_id = p.id order by d.revision_date desc nulls last limit 1) as "sdsId"
    from scored sc
    join products p on p.id = sc.product_id
    join suppliers s on s.id = p.supplier_id
    order by sc.score desc nulls last, p.document_date desc nulls last
    limit ${MAX_RESULTS}
  `);

  const { rows: counts } = await db.execute<{ n: number }>(sql`
    select count(distinct chemical_id)::int as n
    from product_components
    where product_id = ${productId}
      and chemical_id is not null
      and chemical_id is distinct from (select id from chemicals where cas_rn = ${WATER_CAS})
  `);
  const sourceCount = counts[0]?.n ?? 0;
  if (sourceCount === 0) return { status: "no_ingredients" };
  return {
    status: "ok",
    sourceCount,
    close: rows.filter((r) => r.score >= CLOSE_MATCH),
    partial: rows.filter((r) => r.score < CLOSE_MATCH),
  };
}

export async function getProductAlternates(productId: string): Promise<AlternatesResult> {
  "use cache";
  cacheTag(`alternates:${productId}`, "alternates");
  try {
    const result = await queryProductAlternates(productId);
    cacheLife("days");
    return result;
  } catch (error) {
    console.error("Alternates query failed", productId, error);
    cacheLife("minutes");
    return { status: "unavailable" };
  }
}
