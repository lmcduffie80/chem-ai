import { chemicalTag, invalidateTags } from "./invalidate";
import { asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { type IssueInput, recordIssues } from "./runs";

const CCTE_BASE_URL = process.env.EPA_CCTE_BASE_URL ?? "https://api-ccte.epa.gov";
const STALE_AFTER_DAYS = 90;

type CcteSearchHit = { dtxsid?: string; casrn?: string; preferredName?: string; rank?: number };
type CcteDetail = Record<string, unknown> & { dtxsid?: string };
type CcteSynonyms = { valid?: string[]; good?: string[]; other?: string[] };

async function ccte<T>(path: string, init?: RequestInit): Promise<T | null> {
  const apiKey = process.env.EPA_CCTE_API_KEY;
  if (!apiKey) throw new Error("EPA_CCTE_API_KEY is not set (request a free key from EPA CCTE).");
  const res = await fetch(`${CCTE_BASE_URL}${path}`, {
    ...init,
    headers: { "x-api-key": apiKey, accept: "application/json", "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) throw new Error(`CCTE ${path} failed with ${res.status}`);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k] as T;
  return undefined;
}

/** Returns the next batch of chemical ids that have never been enriched or are stale. */
export async function selectChemicalsToEnrich(limit: number) {
  "use step";
  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 3600 * 1000);
  const rows = await db
    .select({ id: schema.chemicals.id })
    .from(schema.chemicals)
    .where(or(isNull(schema.chemicals.enrichedAt), lt(schema.chemicals.enrichedAt, staleBefore)))
    .orderBy(sql`${schema.chemicals.enrichedAt} asc nulls first`, asc(schema.chemicals.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export async function enrichFromCompTox(chemicalIds: number[]): Promise<IngestStats> {
  "use step";
  const chems = await db
    .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
    .from(schema.chemicals)
    .where(inArray(schema.chemicals.id, chemicalIds));

  const issues: IssueInput[] = [];
  const matches = await mapLimit(chems, 5, async (chem) => {
    const hits = await ccte<CcteSearchHit[]>(`/chemical/search/equal/${encodeURIComponent(chem.casRn)}`);
    const hit = hits?.find((h) => h.casrn === chem.casRn) ?? hits?.[0];
    return { chem, dtxsid: hit?.dtxsid ?? null };
  });

  const dtxsids = matches.flatMap((m) => (m.dtxsid ? [m.dtxsid] : []));
  const details = new Map<string, CcteDetail>();
  for (let i = 0; i < dtxsids.length; i += 200) {
    const batch = await ccte<CcteDetail[]>(`/chemical/detail/search/by-dtxsid/`, {
      method: "POST",
      body: JSON.stringify(dtxsids.slice(i, i + 200)),
    });
    for (const d of batch ?? []) if (d.dtxsid) details.set(d.dtxsid, d);
  }

  let enriched = 0;
  let unmatched = 0;
  await mapLimit(matches, 5, async ({ chem, dtxsid }) => {
    const now = new Date();
    if (!dtxsid) {
      unmatched++;
      issues.push({ entityType: "chemical", entityId: chem.casRn, issue: "comptox_no_match", severity: "info" });
      await db.update(schema.chemicals).set({ enrichedAt: now }).where(eq(schema.chemicals.id, chem.id));
      return;
    }

    const detail = details.get(dtxsid) ?? {};
    const preferredName = pick<string>(detail, ["preferredName"]);
    const molWeight = pick<number>(detail, ["averageMass", "molWeight", "monoisotopicMass"]);
    await db
      .update(schema.chemicals)
      .set({
        dtxsid,
        ...(preferredName ? { preferredName } : {}),
        molecularFormula: pick<string>(detail, ["molFormula", "molecularFormula"]) ?? null,
        molWeight: molWeight !== undefined ? Number(molWeight) : null,
        smiles: pick<string>(detail, ["smiles", "qsarReadySmiles"]) ?? null,
        inchikey: pick<string>(detail, ["inchikey", "inchiKey"]) ?? null,
        enrichedAt: now,
      })
      .where(eq(schema.chemicals.id, chem.id));

    const synonyms = await ccte<CcteSynonyms>(`/chemical/synonym/search/by-dtxsid/${dtxsid}`);
    const names = [...new Set([...(synonyms?.valid ?? []), ...(synonyms?.good ?? [])])]
      .map((n) => n.trim())
      .filter((n) => n && n.length <= 300)
      .slice(0, 50);
    if (names.length > 0) {
      await db
        .insert(schema.synonyms)
        .values(names.map((name) => ({ chemicalId: chem.id, name, source: "comptox" })))
        .onConflictDoNothing();
    }
    enriched++;
  });

  await recordIssues(issues);
  invalidateTags([...chems.map((c) => chemicalTag(c.casRn)), "search"]);
  return { processed: chems.length, updated: enriched, skipped: unmatched };
}
