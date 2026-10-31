import { type SQL, sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { vectorLiteral } from "@/db/sql";
import { normalizeCas } from "@/lib/cas";
import type { RegulatoryListCode } from "@/lib/reglists-meta";

export type SearchFilters = {
  lists?: RegulatoryListCode[];
  excludeLists?: RegulatoryListCode[];
  maxHazardScore?: number;
  functionClass?: string;
  tscaActiveOnly?: boolean;
};

export type SearchResult = {
  id: number;
  casRn: string;
  preferredName: string;
  molecularFormula: string | null;
  hazardScore: number | null;
  tscaStatus: string | null;
  saferChoiceStatus: string | null;
  lists: RegulatoryListCode[];
  score: number;
};

type Row = {
  id: number;
  cas_rn: string;
  preferred_name: string;
  molecular_formula: string | null;
  hazard_score: number | null;
  tsca_status: string | null;
  safer_choice_status: string | null;
  lists: RegulatoryListCode[] | null;
  score: number;
};

function filterSql(filters: SearchFilters): SQL {
  const parts: SQL[] = [sql`true`];
  for (const code of filters.lists ?? []) {
    parts.push(sql`exists (select 1 from regulatory_listings rl where rl.chemical_id = c.id and rl.list_code = ${code})`);
  }
  for (const code of filters.excludeLists ?? []) {
    parts.push(sql`not exists (select 1 from regulatory_listings rl where rl.chemical_id = c.id and rl.list_code = ${code})`);
  }
  if (filters.maxHazardScore !== undefined) parts.push(sql`coalesce(c.hazard_score, 0) <= ${filters.maxHazardScore}`);
  if (filters.functionClass) parts.push(sql`${filters.functionClass} = any(c.function_classes)`);
  if (filters.tscaActiveOnly) parts.push(sql`c.tsca_status = 'ACTIVE'`);
  return sql.join(parts, sql` and `);
}

function toResult(r: Row): SearchResult {
  return {
    id: r.id,
    casRn: r.cas_rn,
    preferredName: r.preferred_name,
    molecularFormula: r.molecular_formula,
    hazardScore: r.hazard_score,
    tscaStatus: r.tsca_status,
    saferChoiceStatus: r.safer_choice_status,
    lists: r.lists ?? [],
    score: Number(r.score),
  };
}

const RESULT_COLUMNS = sql`c.id, c.cas_rn, c.preferred_name, c.molecular_formula, c.hazard_score, c.tsca_status,
  c.safer_choice_status,
  (select array_agg(rl.list_code order by rl.list_code) from regulatory_listings rl where rl.chemical_id = c.id) as lists`;

/** Exact CAS, full-text, name prefix and trigram (names + synonyms) matches, merged and ranked. */
export async function searchChemicals(query: string, filters: SearchFilters = {}, limit = 25, offset = 0) {
  "use cache";
  cacheLife("hours");
  cacheTag("search");

  const q = query.trim();
  if (!q && !filters.lists?.length && !filters.functionClass) return [];
  const cas = normalizeCas(q);

  const escaped = q.replace(/[%_\\]/g, "\\$&");
  // Exact CAS > exact name/synonym > name prefix (shorter first) > trigram similarity > full-text hit.
  const candidates = q
    ? sql`
      select id, 100.0 as score from chemicals where cas_rn = ${cas ?? q}
      union all
      select id, 50.0 from chemicals where preferred_name ilike ${escaped}
      union all
      select chemical_id, 45.0 from synonyms where name ilike ${escaped}
      union all
      select id, 10 + 5.0 / (1 + length(preferred_name) / 10.0) from chemicals where preferred_name ilike ${escaped + "%"}
      union all
      select chemical_id, 8 + 5.0 / (1 + length(name) / 10.0) from synonyms where name ilike ${escaped + "%"}
      union all
      select id, similarity(preferred_name, ${q}) * 5 from chemicals where preferred_name % ${q}
      union all
      select chemical_id, similarity(name, ${q}) * 4.5 from synonyms where name % ${q}
      union all
      select id, 1 + ts_rank(search_vector, websearch_to_tsquery('english', ${q}), 1) from chemicals
        where search_vector @@ websearch_to_tsquery('english', ${q})`
    : sql`select id, 0.0 as score from chemicals`;

  const { rows } = await db.execute<Row>(sql`
    with cand as (${candidates}),
    ranked as (select id, max(score) as score from cand group by id)
    select ${RESULT_COLUMNS}, ranked.score
    from ranked join chemicals c on c.id = ranked.id
    where ${filterSql(filters)}
    order by ranked.score desc, c.preferred_name asc
    limit ${limit} offset ${offset}
  `);
  return rows.map(toResult);
}

/** Nearest neighbours by embedding; used for natural-language search and alternatives. */
export async function semanticSearch(embedding: number[], filters: SearchFilters = {}, limit = 25, excludeId?: number) {
  const { rows } = await db.execute<Row>(sql`
    select ${RESULT_COLUMNS}, 1 - (c.embedding <=> ${vectorLiteral(embedding)}) as score
    from chemicals c
    where c.embedding is not null and ${filterSql(filters)} ${excludeId ? sql`and c.id <> ${excludeId}` : sql``}
    order by c.embedding <=> ${vectorLiteral(embedding)}
    limit ${limit}
  `);
  return rows.map(toResult);
}
