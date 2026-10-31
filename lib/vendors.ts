import { cacheLife, cacheTag } from "next/cache";

const PUG = "https://pubchem.ncbi.nlm.nih.gov/rest";
const MAX_SUBSTANCES = 200;
const REFERENCE_DATABASES =
  /^(KEGG|ChEBI|ChEMBL|SureChEMBL|DrugBank|Wikidata|Wikipedia|HMDB|Human Metabolome|NORMAN|MassBank|NIST|Nikkaji|ECHA|CAS Common Chemistry|BindingDB|ZINC|IUPHAR|Comparative Toxicogenomics|DTP\/NCI|EPA|FDA|MeSH|Thomson|IBM|Google Patents|NextMove|SpringerNature|Japan Chemical Substance)/i;

export type Vendor = { name: string; url: string | null; listings: number };
export type VendorResult = { vendors: Vendor[]; pubchemUrl: string };

type CategoriesResponse = {
  SourceCategories?: {
    Categories?: { Category?: string; Sources?: { SourceName?: string; SourceRecordURL?: string }[] }[];
  };
};

type SubstanceResponse = {
  PC_Substances?: {
    source?: { db?: { name?: string } };
    xref?: { dburl?: string; sburl?: string }[];
    synonyms?: string[];
  }[];
};

async function pubchem<T>(path: string): Promise<T | null> {
  const res = await fetch(`${PUG}${path}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`PubChem ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

function addListing(map: Map<string, Vendor>, name: string, url: string | null) {
  const key = name.toLowerCase();
  const existing = map.get(key);
  if (existing) {
    existing.listings++;
    existing.url ??= url;
  } else {
    map.set(key, { name, url, listings: 1 });
  }
}

function hostName(url: string | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Vendor catalog listings PubChem holds for a discrete compound. */
async function compoundVendors(cid: number) {
  const data = await pubchem<CategoriesResponse>(`/pug_view/categories/compound/${cid}/JSON`);
  const map = new Map<string, Vendor>();
  const category = data?.SourceCategories?.Categories?.find((c) => c.Category === "Chemical Vendors");
  for (const source of category?.Sources ?? []) {
    if (source.SourceName) addListing(map, source.SourceName, source.SourceRecordURL ?? null);
  }
  return map;
}

/**
 * Polymers and mixtures (e.g. xanthan gum) have no PubChem compound, only substances deposited
 * under the CAS number. Some depositors attach the wrong CAS, so a deposit is kept only when one
 * of its names matches ours, or when it carries no conflicting chemical name at all.
 */
async function substanceVendors(cas: string, knownNames: string[]) {
  const data = await pubchem<SubstanceResponse>(`/pug/substance/name/${encodeURIComponent(cas)}/JSON`);
  const known = knownNames.map((n) => n.toLowerCase());
  const map = new Map<string, Vendor>();
  for (const substance of (data?.PC_Substances ?? []).slice(0, MAX_SUBSTANCES)) {
    const xref = substance.xref ?? [];
    const productUrl = xref.find((x) => x.sburl)?.sburl ?? null;
    const siteUrl = xref.find((x) => x.dburl)?.dburl;
    const rawName = substance.source?.db?.name ?? "";
    const name = /^\d+$/.test(rawName) ? hostName(siteUrl) : rawName;
    // Only commercial depositors: they publish a catalog URL or are named by their storefront.
    if (!name || (!productUrl && !/^\d+$/.test(rawName))) continue;
    if (/\.gov$|nih\.gov|pubchem/i.test(hostName(productUrl ?? siteUrl) ?? "")) continue;
    if (REFERENCE_DATABASES.test(name)) continue;

    const names = (substance.synonyms ?? []).filter((s) => s !== cas);
    const matches = names.some((s) => known.some((k) => s.toLowerCase().includes(k)));
    const conflicts = names.some((s) => (s.match(/[a-z]/gi)?.length ?? 0) >= 6);
    if (!matches && conflicts) continue;

    addListing(map, name, productUrl ?? siteUrl ?? null);
  }
  return map;
}

/** Suppliers listing this chemical in PubChem, cached for a week. Returns null when PubChem is unavailable. */
export async function getVendors(input: {
  casRn: string;
  pubchemCid: number | null;
  names: string[];
}): Promise<VendorResult | null> {
  "use cache";
  cacheTag(`vendors:${input.casRn}`);
  try {
    let cid = input.pubchemCid;
    if (!cid) {
      const ids = await pubchem<{ IdentifierList?: { CID?: number[] } }>(
        `/pug/compound/name/${encodeURIComponent(input.casRn)}/cids/JSON`,
      );
      cid = ids?.IdentifierList?.CID?.[0] ?? null;
    }
    const map = cid ? await compoundVendors(cid) : await substanceVendors(input.casRn, input.names);
    cacheLife("weeks");
    return {
      vendors: [...map.values()].sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name)),
      pubchemUrl: cid
        ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}#section=Chemical-Vendors`
        : `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(input.casRn)}&tab=substance`,
    };
  } catch {
    cacheLife("minutes");
    return null;
  }
}
