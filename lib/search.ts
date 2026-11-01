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
  /** Chemicals used in agriculture / pesticide products, or listed as EPA pesticide inerts. */
  agChem?: boolean;
};

/** ChemExpo categories that count as agricultural chemistry. */
const AG_PRODUCT_CATEGORY = sql`(
  p.category ~* ${"^(Agriculture|Pesticides)\\b"}
  or p.category ~* ${"\\b(herbicide|fungicide|insecticide|fertilizer|rodenticide)\\b"}
  or p.category ilike ${"% › pesticide%"}
)`;

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
  lists: RegulatoryListCode[] | string | null;
  score: number;
};

export function asLists(value: unknown): RegulatoryListCode[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is RegulatoryListCode => typeof v === "string");
  if (typeof value === "string") {
    const inner = value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1) : value;
    return inner ? (inner.split(",").filter(Boolean) as RegulatoryListCode[]) : [];
  }
  if (typeof value === "object") {
    return Object.values(value).filter((v): v is RegulatoryListCode => typeof v === "string");
  }
  return [];
}

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
  if (filters.agChem) {
    parts.push(sql`(
      exists (
        select 1 from product_components pc
        join products p on p.id = pc.product_id
        where pc.chemical_id = c.id and ${AG_PRODUCT_CATEGORY}
      )
      or exists (
        select 1 from regulatory_listings rl
        where rl.chemical_id = c.id and rl.list_code = 'PEST_INERT'
      )
    )`);
  }
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
    lists: asLists(r.lists),
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
  if (!q && !filters.lists?.length && !filters.functionClass && !filters.agChem) return [];
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

export type ProductSearchResult = {
  id: string;
  name: string;
  category: string | null;
  documentDate: string | null;
  makerId: string;
  maker: string;
  makerKind: string;
  sdsId: string | null;
};

/** Long queries are trimmed so the per-word conditions stay bounded. */
const MAX_PRODUCT_QUERY_WORDS = 6;

/**
 * Products by name or maker: exact name > name prefix > every word in name or maker >
 * fuzzy word match on name > fuzzy maker match. CAS-number queries return nothing.
 */
export async function searchProducts(
  query: string,
  limit = 25,
  offset = 0,
  filters: Pick<SearchFilters, "agChem"> = {},
): Promise<{ total: number; results: ProductSearchResult[] }> {
  "use cache";
  cacheLife("hours");
  cacheTag("search");

  const q = query.trim().slice(0, 200);
  const agOnly = Boolean(filters.agChem);
  if ((!q && !agOnly) || normalizeCas(q)) return { total: 0, results: [] };
  const escape = (s: string) => s.replace(/[%_\\]/g, "\\$&");
  const words = q ? q.split(/\s+/).slice(0, MAX_PRODUCT_QUERY_WORDS) : [];
  const allWords =
    words.length > 0
      ? sql.join(
          words.map((w) => sql`(p.name ilike ${`%${escape(w)}%`} or s.name ilike ${`%${escape(w)}%`})`),
          sql` and `,
        )
      : sql`true`;
  const agFilter = agOnly ? sql`and ${AG_PRODUCT_CATEGORY}` : sql``;

  const { rows } = await db.execute<ProductSearchResult & { total: number }>(sql`
    with cand as (
      ${
        q
          ? sql`
      select p.id, 100.0 as score from products p where p.name ilike ${escape(q)} ${agFilter}
      union all
      select p.id, 50 + 5.0 / (1 + length(p.name) / 10.0) from products p where p.name ilike ${`${escape(q)}%`} ${agFilter}
      union all
      select p.id, 20 + 5 * word_similarity(${q}, p.name)
      from products p join suppliers s on s.id = p.supplier_id
      where ${allWords} ${agFilter}
      union all
      select p.id, 10 * word_similarity(${q}, p.name) from products p where ${q} <% p.name ${agFilter}
      union all
      select p.id, 8 * similarity(s.name, ${q})
      from products p join suppliers s on s.id = p.supplier_id
      where s.name % ${q} ${agFilter}
          `
          : sql`
      select p.id, 1.0 as score from products p where ${AG_PRODUCT_CATEGORY}
          `
      }
    ),
    ranked as (select id, max(score) as score from cand group by id)
    select p.id, p.name, p.category, p.document_date::text as "documentDate",
      s.id as "makerId", s.name as maker, s.kind as "makerKind",
      (select d.id from sds_documents d where d.product_id = p.id order by d.revision_date desc nulls last limit 1) as "sdsId",
      count(*) over ()::int as total
    from ranked r
    join products p on p.id = r.id
    join suppliers s on s.id = p.supplier_id
    order by r.score desc, p.document_date desc nulls last, p.id
    limit ${limit} offset ${offset}
  `);
  return { total: rows[0]?.total ?? 0, results: rows.map(({ total: _total, ...r }) => r) };
}
