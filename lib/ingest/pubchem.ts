import { chemicalTag, invalidateTags } from "./invalidate";
import { asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GhsClassification, IngestStats } from "@/db/schema";
import { hazardScoreFromStatements } from "@/lib/hazard";

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest";
// PubChem aggregates every ECHA C&L notification; ignore statements only a small minority of notifiers report.
const MIN_NOTIFIER_SHARE = 10;

export async function selectChemicalsForGhs(limit: number) {
  "use step";
  const rows = await db
    .select({ id: schema.chemicals.id })
    .from(schema.chemicals)
    .where(isNull(schema.chemicals.ghsCheckedAt))
    // Substances people actually look up (watched, in products, regulated, safer-alternative candidates, discrete) go first.
    .orderBy(
      sql`exists (select 1 from watchlists w where w.chemical_id = ${schema.chemicals.id}) desc`,
      sql`exists (select 1 from product_components pc where pc.chemical_id = ${schema.chemicals.id}) desc`,
      sql`exists (select 1 from regulatory_listings rl where rl.chemical_id = ${schema.chemicals.id}) desc`,
      sql`(${schema.chemicals.saferChoiceStatus} is not null) desc`,
      sql`${schema.chemicals.isUvcb} asc`,
      asc(schema.chemicals.id),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

async function pubchemJson<T>(url: string): Promise<T | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) return null;
    return (await res.json()) as T;
  }
  throw new Error(`PubChem throttled: ${url}`);
}

type PugViewNode = {
  Section?: PugViewNode[];
  Information?: {
    ReferenceNumber?: number;
    Name?: string;
    Value?: {
      StringWithMarkup?: { String?: string; Markup?: { Extra?: string; Type?: string }[] }[];
    };
  }[];
};

export type ParsedGhs = {
  signalWord: string | null;
  hStatements: string[];
  pStatements: string[];
  pictograms: string[];
  classifications: GhsClassification[];
};

type GhsGroup = {
  signal: string | null;
  h: Set<string>;
  p: Set<string>;
  pictos: Set<string>;
  classes: Map<string, GhsClassification>;
  hasNotifierShares: boolean;
};

/**
 * PubChem lists one GHS block per source (ECHA C&L aggregate, national lists, suppliers).
 * Prefer the ECHA aggregate (identified by notifier percentages); otherwise use the
 * source reporting the most hazard statements.
 */
export function parseGhsFromPugView(root: PugViewNode): ParsedGhs {
  const groups = new Map<number, GhsGroup>();
  const groupFor = (ref: number) => {
    let g = groups.get(ref);
    if (!g) {
      g = { signal: null, h: new Set(), p: new Set(), pictos: new Set(), classes: new Map(), hasNotifierShares: false };
      groups.set(ref, g);
    }
    return g;
  };

  const walk = (node: PugViewNode) => {
    for (const info of node.Information ?? []) {
      const name = info.Name ?? "";
      const g = groupFor(info.ReferenceNumber ?? 0);
      for (const swm of info.Value?.StringWithMarkup ?? []) {
        const str = swm.String ?? "";
        if (/pictogram/i.test(name)) {
          for (const m of swm.Markup ?? []) if (m.Extra) g.pictos.add(m.Extra);
        } else if (/signal/i.test(name)) {
          g.signal ??= str.trim() || null;
        } else if (/hazard statement/i.test(name)) {
          const code = /\b(H\d{3}[A-Za-z]*)\b/.exec(str)?.[1];
          const share = /\((?:[<>]\s*)?(\d+(?:\.\d+)?)%\)/.exec(str)?.[1];
          if (share !== undefined) g.hasNotifierShares = true;
          if (!code || (share !== undefined && Number(share) < MIN_NOTIFIER_SHARE)) continue;
          g.h.add(code);
          const cls = /\[(?:Danger|Warning)\s+([^\]]+)\]/.exec(str)?.[1];
          if (cls) {
            const [hazardClass, category] = cls.split(/\s*-\s*(?=Category|category)/);
            g.classes.set(cls, { hazardClass: hazardClass.trim(), category: category?.trim() });
          }
        } else if (/precautionary statement/i.test(name)) {
          for (const code of str.match(/P\d{3}(?:\+P\d{3})*/g) ?? []) g.p.add(code);
        }
      }
    }
    for (const child of node.Section ?? []) walk(child);
  };
  walk(root);

  const candidates = [...groups.values()].filter((g) => g.h.size > 0);
  const best =
    candidates.find((g) => g.hasNotifierShares) ?? candidates.sort((a, b) => b.h.size - a.h.size)[0];
  if (!best) return { signalWord: null, hStatements: [], pStatements: [], pictograms: [], classifications: [] };

  return {
    signalWord: best.signal,
    hStatements: [...best.h].sort(),
    pStatements: [...best.p].sort(),
    pictograms: [...best.pictos],
    classifications: [...best.classes.values()],
  };
}

type PubchemProperties = {
  Title?: string;
  MolecularFormula?: string;
  MolecularWeight?: string;
  SMILES?: string;
  InChIKey?: string;
};

/**
 * Fills identity gaps from PubChem (common-name title, formula, structure, synonyms).
 * CompTox data wins where present; the TSCA index name is kept as a synonym.
 */
async function applyPubchemIdentity(chem: { id: number; casRn: string }, cid: number) {
  const [props, syn] = await Promise.all([
    pubchemJson<{ PropertyTable?: { Properties?: PubchemProperties[] } }>(
      `${PUG}/pug/compound/cid/${cid}/property/Title,MolecularFormula,MolecularWeight,SMILES,InChIKey/JSON`,
    ),
    pubchemJson<{ InformationList?: { Information?: { Synonym?: string[] }[] } }>(
      `${PUG}/pug/compound/cid/${cid}/synonyms/JSON`,
    ),
  ]);
  const p = props?.PropertyTable?.Properties?.[0];
  const [current] = await db
    .select({ preferredName: schema.chemicals.preferredName, enrichedAt: schema.chemicals.enrichedAt })
    .from(schema.chemicals)
    .where(eq(schema.chemicals.id, chem.id));
  const keepCompTox = current?.enrichedAt !== null && current?.enrichedAt !== undefined;

  const names = (syn?.InformationList?.Information?.[0]?.Synonym ?? [])
    .filter((n) => n !== chem.casRn && n.length <= 200 && !/^\d+-\d{2}-\d$/.test(n))
    .slice(0, 25);
  if (current && p?.Title && !keepCompTox && p.Title !== current.preferredName) names.push(current.preferredName);
  if (names.length) {
    await db
      .insert(schema.synonyms)
      .values([...new Set(names)].map((name) => ({ chemicalId: chem.id, name, source: "pubchem" })))
      .onConflictDoNothing();
  }

  await db
    .update(schema.chemicals)
    .set({
      ...(p?.Title && !keepCompTox ? { preferredName: p.Title } : {}),
      molecularFormula: sql`coalesce(${schema.chemicals.molecularFormula}, ${p?.MolecularFormula ?? null})`,
      molWeight: sql`coalesce(${schema.chemicals.molWeight}, ${p?.MolecularWeight ? Number(p.MolecularWeight) : null})`,
      smiles: sql`coalesce(${schema.chemicals.smiles}, ${p?.SMILES ?? null})`,
      inchikey: sql`coalesce(${schema.chemicals.inchikey}, ${p?.InChIKey ?? null})`,
    })
    .where(eq(schema.chemicals.id, chem.id));
}

export async function fetchGhsBatch(chemicalIds: number[]): Promise<IngestStats> {
  "use step";
  const chems = await db
    .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
    .from(schema.chemicals)
    .where(inArray(schema.chemicals.id, chemicalIds));

  let withGhs = 0;
  const pause = () => new Promise((r) => setTimeout(r, 220));
  // PubChem allows ~5 requests/second; keep sequential with a small gap.
  for (const chem of chems) {
    const cids = await pubchemJson<{ IdentifierList?: { CID?: number[] } }>(
      // The name endpoint ranks the compound whose synonym is this CAS RN first; xref/RN does not.
      `${PUG}/pug/compound/name/${encodeURIComponent(chem.casRn)}/cids/JSON`,
    );
    const cid = cids?.IdentifierList?.CID?.[0] ?? null;
    let parsed: ParsedGhs | null = null;
    if (cid) {
      await pause();
      const view = await pubchemJson<{ Record?: PugViewNode }>(
        `${PUG}/pug_view/data/compound/${cid}/JSON?heading=GHS%20Classification`,
      );
      if (view?.Record) parsed = parseGhsFromPugView(view.Record);
      await pause();
      await applyPubchemIdentity(chem, cid);
    }

    const score = parsed && parsed.hStatements.length > 0 ? hazardScoreFromStatements(parsed.hStatements) : null;
    if (parsed && parsed.hStatements.length > 0) {
      withGhs++;
      await db
        .insert(schema.hazards)
        .values({ chemicalId: chem.id, source: "pubchem", ...parsed, score: score ?? 0 })
        .onConflictDoUpdate({
          target: [schema.hazards.chemicalId, schema.hazards.source],
          set: { ...parsed, score: score ?? 0, updatedAt: new Date() },
        });
    }
    await db
      .update(schema.chemicals)
      .set({ pubchemCid: cid, ghsCheckedAt: new Date(), ...(score !== null ? { hazardScore: score } : {}) })
      .where(eq(schema.chemicals.id, chem.id));
    await new Promise((r) => setTimeout(r, 220));
  }

  invalidateTags([...chems.map((c) => chemicalTag(c.casRn)), "search"]);
  return { processed: chems.length, updated: withGhs };
}
