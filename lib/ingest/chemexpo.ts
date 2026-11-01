import { invalidateTags } from "./invalidate";
import { isNewerDocument, productKey } from "./product-identity";
import { del, get, put } from "@vercel/blob";
import { parse as parseStream } from "csv-parse";
import { and, eq, exists, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { Unzip, UnzipInflate } from "fflate";
import { Readable } from "node:stream";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { midpointWeight } from "@/lib/alternates/score";
import { normalizeCas } from "@/lib/cas";
import { generalCategory } from "@/lib/chemical-products";
import { CHEMEXPO_SOURCE, type SupplierKind } from "@/lib/product-sources";

export const CHEMEXPO_COMPOSITION_URL = "https://comptox.epa.gov/chemexpo/dl_co_chemicals/";
/** Extraction runs once per partition (`doc % EXTRACT_PARTITIONS`) to bound memory. */
const EXTRACT_PARTITIONS = 4;
/** A complete EPA file has ~300k distinct products; far fewer means a truncated or wrong download. */
const MIN_EXPECTED_PRODUCTS = 100_000;
/** Prune refuses to remove more than this share of the ChemExpo catalog in one run. */
const MAX_PRUNE_SHARE = 0.3;
const PRODUCTS_PER_CHUNK = 3000;
const INSERT_BATCH = 1000;

const DATABASE_SOURCES = new Set([
  "SIRI",
  "Environmental Working Group (EWG)",
  "CPCPdb",
  "Greenbook",
  "Health Product Declaration Collaborative",
  "Declare/Living Future",
]);
const RETAILER_SOURCES = new Set(["Home Depot", "Dollar General", "Walmart", "Target", "Lowe's", "Staples"]);

function supplierKind(name: string): SupplierKind {
  if (DATABASE_SOURCES.has(name)) return "database";
  if (RETAILER_SOURCES.has(name)) return "retailer";
  return "manufacturer";
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** ChemExpo dates appear as "12/16/2016", "July 2004", "2008-06-23" or "2019". */
export function parseLooseDate(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const iso = (y: number, m: number, d: number) =>
    y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
      ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
      : null;
  let m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return iso(+m[3], +m[1], +m[2]);
  m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = value.match(/^([A-Za-z]+)\.?\s+(?:\d{1,2},\s*)?(\d{4})$/);
  if (m) {
    const month = MONTHS.findIndex((name) => name.startsWith(m![1].toLowerCase().slice(0, 3)));
    return month >= 0 ? iso(+m[2], month + 1, 1) : null;
  }
  m = value.match(/^(\d{4})$/);
  if (m) return iso(+m[1], 1, 1);
  return null;
}

/** Yields the bytes of the first CSV inside a zip stream, or passes a plain CSV stream through. */
async function* csvBytes(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  const first = await reader.read();
  if (first.done) return;
  const isZip = first.value[0] === 0x50 && first.value[1] === 0x4b;
  if (!isZip) {
    yield first.value;
    for (let r = await reader.read(); !r.done; r = await reader.read()) yield r.value;
    return;
  }

  const queue: Uint8Array[] = [];
  let failure: Error | null = null;
  let picked = false;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (picked || !file.name.toLowerCase().endsWith(".csv")) return;
    picked = true;
    file.ondata = (err, data) => {
      if (err) failure = err;
      else if (data.length) queue.push(data);
    };
    file.start();
  };

  let chunk: Uint8Array | undefined = first.value;
  while (chunk) {
    unzip.push(chunk);
    if (failure) throw failure;
    while (queue.length) yield queue.shift()!;
    const r = await reader.read();
    chunk = r.done ? undefined : r.value;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
  while (queue.length) yield queue.shift()!;
  if (!picked) throw new Error("ChemExpo archive does not contain a CSV file");
}

type Columns = Record<
  | "source"
  | "doc"
  | "title"
  | "date"
  | "product"
  | "pucGeneral"
  | "pucFamily"
  | "pucType"
  | "rawName"
  | "rawCas"
  | "curatedName"
  | "curatedCas"
  | "lower"
  | "upper"
  | "central",
  number
>;

const HEADERS: Record<keyof Columns, string> = {
  source: "Data Source",
  doc: "Data Document ID",
  title: "Data Document Title",
  date: "Document Date",
  product: "Product Name",
  pucGeneral: "PUC General Category",
  pucFamily: "PUC Product Family",
  pucType: "PUC Product Type",
  rawName: "Raw Chemical Name",
  rawCas: "Raw CAS",
  curatedName: "Curated Chemical Name",
  curatedCas: "Curated CAS",
  lower: "Lower Weight Fraction",
  upper: "Upper Weight Fraction",
  central: "Central Weight Fraction",
};

/** Streams composition rows from a staged ChemExpo download as positional arrays plus a column map. */
async function* compositionRows(pathname: string): AsyncGenerator<{ row: string[]; col: Columns }> {
  const blob = await get(pathname, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) throw new Error(`Blob not found: ${pathname}`);
  const parser = Readable.from(csvBytes(blob.stream)).pipe(
    parseStream({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }),
  );
  let col: Columns | null = null;
  for await (const row of parser as AsyncIterable<string[]>) {
    if (!col) {
      const index = new Map(row.map((h, i) => [h.trim(), i]));
      const entries = Object.entries(HEADERS).map(([key, header]) => {
        const i = index.get(header);
        if (i === undefined) throw new Error(`ChemExpo file is missing the "${header}" column`);
        return [key, i] as const;
      });
      col = Object.fromEntries(entries) as Columns;
      continue;
    }
    yield { row, col };
  }
}

function rowCas(row: string[], col: Columns) {
  return normalizeCas(row[col.curatedCas] || row[col.rawCas]);
}

function productName(row: string[], col: Columns, doc: number) {
  return (row[col.product] || row[col.title] || `ChemExpo document ${doc}`).trim().slice(0, 300);
}

async function chemicalIdsByCas() {
  const rows = await db.select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn }).from(schema.chemicals);
  return new Map(rows.map((r) => [r.casRn, r.id]));
}

/** Downloads the ChemExpo bulk composition archive (or uses an admin upload) into private Blob. */
export async function stageChemExpo() {
  "use step";
  const [upload] = await db
    .select({ pathname: schema.sourceFiles.blobPathname })
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.key, "chemexpo"))
    .limit(1);
  if (upload) return { pathname: upload.pathname, origin: `blob:${upload.pathname}` };

  const url = process.env.CHEMEXPO_COMPOSITION_URL || CHEMEXPO_COMPOSITION_URL;
  const res = await fetch(url, { headers: { "user-agent": "Chemspace-Ingest/1.0" } });
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  const blob = await put(`ingest/chemexpo/${Date.now()}.zip`, res.body, {
    access: "private",
    contentType: "application/zip",
    addRandomSuffix: true,
    multipart: true,
  });
  return { pathname: blob.pathname, origin: url };
}

/** First pass: keeps the newest document for each distinct product (maker + normalized name). */
export async function planChemExpoProducts(pathname: string) {
  "use step";
  const seenDocs = new Set<number>();
  const winners = new Map<string, { doc: number; t: number }>();
  let rows = 0;

  for await (const { row, col } of compositionRows(pathname)) {
    rows++;
    const rawDoc = row[col.doc]?.trim();
    if (!rawDoc) continue;
    const doc = Number(rawDoc);
    if (!Number.isFinite(doc) || seenDocs.has(doc)) continue;
    seenDocs.add(doc);
    const date = parseLooseDate(row[col.date]);
    const candidate = { doc, t: date ? Date.parse(date) : 0 };
    const key = productKey(row[col.source]?.trim() || "Unknown source", productName(row, col, doc), doc);
    const current = winners.get(key);
    if (!current || isNewerDocument(candidate, current)) winners.set(key, candidate);
  }

  const selected = [...winners.values()].map((w) => w.doc);
  if (selected.length < MIN_EXPECTED_PRODUCTS) {
    throw new Error(`ChemExpo file yielded only ${selected.length} products; refusing to replace the catalog`);
  }
  const blob = await put(`ingest/chemexpo/selected-${Date.now()}.json`, JSON.stringify(selected), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: true,
  });
  return {
    selectedPath: blob.pathname,
    partitions: EXTRACT_PARTITIONS,
    stats: { rows, documents: seenDocs.size, products: selected.length } satisfies IngestStats,
  };
}

/** [CAS, chemical ID, raw name (only when unresolved), min %, max %, weight fraction] */
type StagedComponent = [string | null, number | null, string | null, number | null, number | null, number | null];

type StagedProduct = {
  doc: number;
  source: string;
  name: string;
  category: string | null;
  date: string | null;
  components: StagedComponent[];
};

function percent(value: string | undefined) {
  if (!value?.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100 * 10000) / 10000 : null;
}

/** Second pass for one partition: gathers metadata and compositions of selected products into Blob chunks. */
export async function extractChemExpoProducts(pathname: string, selectedPath: string, partition: number, partitions: number) {
  "use step";
  const selectedBlob = await get(selectedPath, { access: "private", useCache: false });
  if (!selectedBlob || selectedBlob.statusCode !== 200) throw new Error(`Blob not found: ${selectedPath}`);
  const docs: number[] = await new Response(selectedBlob.stream).json();
  const selected = new Set(docs.filter((doc) => doc % partitions === partition));
  const idByCas = await chemicalIdsByCas();

  const products = new Map<number, StagedProduct>();
  for await (const { row, col } of compositionRows(pathname)) {
    const rawDoc = row[col.doc]?.trim();
    if (!rawDoc) continue;
    const doc = Number(rawDoc);
    if (!selected.has(doc)) continue;
    let product = products.get(doc);
    if (!product) {
      const category = [row[col.pucGeneral], row[col.pucFamily], row[col.pucType]]
        .map((s) => s?.trim())
        .filter(Boolean)
        .join(" › ");
      product = {
        doc,
        source: row[col.source]?.trim() || "Unknown source",
        name: productName(row, col, doc),
        category: category || null,
        date: parseLooseDate(row[col.date]),
        components: [],
      };
      products.set(doc, product);
    }
    const central = percent(row[col.central]);
    const min = percent(row[col.lower]) ?? central;
    const max = percent(row[col.upper]) ?? central;
    const cas = rowCas(row, col);
    const chemicalId = cas ? (idByCas.get(cas) ?? null) : null;
    const name = chemicalId
      ? null
      : (row[col.curatedName]?.trim() || row[col.rawName]?.trim() || cas || "Unnamed ingredient").slice(0, 300);
    product.components.push([cas, chemicalId, name, min, max, midpointWeight(min, max)]);
  }

  for (const product of products.values()) {
    const only = product.components.length === 1 ? product.components[0] : null;
    if (only && only[5] === null) only[5] = 1;
  }

  const all = [...products.values()];
  const chunkPaths: string[] = [];
  for (let i = 0; i < all.length; i += PRODUCTS_PER_CHUNK) {
    const blob = await put(
      `ingest/chemexpo/products-${Date.now()}-p${partition}-${i / PRODUCTS_PER_CHUNK}.json`,
      JSON.stringify(all.slice(i, i + PRODUCTS_PER_CHUNK)),
      { access: "private", contentType: "application/json", addRandomSuffix: true },
    );
    chunkPaths.push(blob.pathname);
  }
  return chunkPaths;
}

export async function upsertChemExpoChunk(chunkPath: string): Promise<IngestStats> {
  "use step";
  const blob = await get(chunkPath, { access: "private", useCache: false });
  if (!blob || blob.statusCode !== 200) {
    console.warn(`ChemExpo chunk ${chunkPath} not found; assuming it was already written`);
    return { processed: 0 };
  }
  const staged: StagedProduct[] = await new Response(blob.stream).json();
  const now = new Date();

  const sourceBySlug = new Map(staged.map((p) => [slug(p.source), p.source]));
  const suppliers = await db
    .insert(schema.suppliers)
    .values(
      [...sourceBySlug].map(([externalId, name]) => ({ source: CHEMEXPO_SOURCE, externalId, name, kind: supplierKind(name) })),
    )
    .onConflictDoUpdate({
      target: [schema.suppliers.source, schema.suppliers.externalId],
      set: { name: sql`excluded.name`, kind: sql`excluded.kind`, updatedAt: now },
    })
    .returning({ id: schema.suppliers.id, externalId: schema.suppliers.externalId });
  const supplierIdBySlug = new Map(suppliers.map((s) => [s.externalId, s.id]));

  const stagedByProductId = new Map<string, StagedProduct>();
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < staged.length; i += INSERT_BATCH) {
    const rows = await db
      .insert(schema.products)
      .values(
        staged.slice(i, i + INSERT_BATCH).map((p) => ({
          supplierId: supplierIdBySlug.get(slug(p.source))!,
          source: CHEMEXPO_SOURCE,
          externalId: String(p.doc),
          name: p.name,
          category: p.category,
          documentDate: p.date,
          sourceUrl: `https://comptox.epa.gov/chemexpo/datadocument/${p.doc}/`,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.products.source, schema.products.externalId],
        set: {
          supplierId: sql`excluded.supplier_id`,
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          documentDate: sql`excluded.document_date`,
          sourceUrl: sql`excluded.source_url`,
          updatedAt: now,
        },
      })
      .returning({ id: schema.products.id, externalId: schema.products.externalId, inserted: sql<boolean>`(xmax = 0)` });
    const byDoc = new Map(staged.slice(i, i + INSERT_BATCH).map((p) => [String(p.doc), p]));
    for (const r of rows) {
      stagedByProductId.set(r.id, byDoc.get(r.externalId)!);
      if (r.inserted) inserted++;
      else updated++;
    }
  }

  // Same external ID ⇒ same EPA document ⇒ same composition, so only products with missing or outdated components are rewritten.
  const pc = schema.productComponents;
  const productIds = [...stagedByProductId.keys()];
  const needsComponents: string[] = [];
  for (let i = 0; i < productIds.length; i += INSERT_BATCH) {
    const rows = await db
      .select({ id: schema.products.id })
      .from(schema.products)
      .where(
        and(
          inArray(schema.products.id, productIds.slice(i, i + INSERT_BATCH)),
          or(
            notExists(db.select({ id: pc.id }).from(pc).where(eq(pc.productId, schema.products.id))),
            exists(
              db
                .select({ id: pc.id })
                .from(pc)
                .where(
                  and(
                    eq(pc.productId, schema.products.id),
                    or(
                      and(isNull(pc.weight), or(isNotNull(pc.minPct), isNotNull(pc.maxPct))),
                      and(isNotNull(pc.chemicalId), isNotNull(pc.componentName)),
                    ),
                  ),
                ),
            ),
          ),
        ),
      );
    needsComponents.push(...rows.map((r) => r.id));
  }

  let components = 0;
  for (let i = 0; i < needsComponents.length; i += INSERT_BATCH) {
    const ids = needsComponents.slice(i, i + INSERT_BATCH);
    const values = ids.flatMap((productId) =>
      stagedByProductId.get(productId)!.components.map(([casRn, chemicalId, componentName, minPct, maxPct, weight]) => ({
        productId,
        chemicalId,
        casRn,
        componentName,
        minPct,
        maxPct,
        weight,
      })),
    );
    const inserts = [];
    for (let j = 0; j < values.length; j += INSERT_BATCH) {
      inserts.push(db.insert(pc).values(values.slice(j, j + INSERT_BATCH)));
    }
    await db.batch([db.delete(pc).where(inArray(pc.productId, ids)), ...inserts]);
    components += values.length;
  }
  await del(chunkPath);

  return { processed: staged.length, inserted, updated, components };
}

/** Removes ChemExpo products not refreshed by this run, plus empty ChemExpo suppliers. */
export async function pruneChemExpo(runId: string): Promise<IngestStats> {
  "use step";
  const [run] = await db
    .select({ startedAt: schema.ingestRuns.startedAt })
    .from(schema.ingestRuns)
    .where(eq(schema.ingestRuns.id, runId));
  if (!run) throw new Error(`Unknown ingest run ${runId}`);

  const [{ total, stale }] = await db
    .select({
      total: sql<number>`count(*)::int`,
      stale: sql<number>`(count(*) filter (where ${lt(schema.products.updatedAt, run.startedAt)}))::int`,
    })
    .from(schema.products)
    .where(eq(schema.products.source, CHEMEXPO_SOURCE));
  if (total > 0 && stale / total > MAX_PRUNE_SHARE) {
    throw new Error(
      `ChemExpo prune would remove ${stale} of ${total} products (more than ${MAX_PRUNE_SHARE * 100}% of the catalog); the source file may be incomplete`,
    );
  }

  const removed = await db
    .delete(schema.products)
    .where(and(eq(schema.products.source, CHEMEXPO_SOURCE), lt(schema.products.updatedAt, run.startedAt)))
    .returning({ id: schema.products.id });
  await db
    .delete(schema.suppliers)
    .where(
      and(
        eq(schema.suppliers.source, CHEMEXPO_SOURCE),
        notExists(db.select({ id: schema.products.id }).from(schema.products).where(eq(schema.products.supplierId, schema.suppliers.id))),
      ),
    );

  return { removed: removed.length };
}

/** Rebuilds per-category product counts and ingredient frequencies from the loaded products. */
export async function summarizeChemExpo(): Promise<IngestStats> {
  "use step";
  const relinked = await db.execute(sql`
    update product_components pc set chemical_id = c.id, component_name = null
    from chemicals c
    where pc.chemical_id is null and pc.cas_rn is not null and c.cas_rn = pc.cas_rn
  `);

  const [, categories] = await db.batch([
    db.delete(schema.chemicalProductCategories).where(eq(schema.chemicalProductCategories.source, CHEMEXPO_SOURCE)),
    db.execute(sql`
      insert into chemical_product_categories (chemical_id, source, category, product_count)
      select pc.chemical_id, ${CHEMEXPO_SOURCE}, ${generalCategory(sql`p.category`)}, count(distinct p.id)::int
      from product_components pc
      join products p on p.id = pc.product_id
      where p.source = ${CHEMEXPO_SOURCE} and pc.chemical_id is not null
      group by pc.chemical_id, 3
    `),
  ]);

  const [, frequencies] = await db.batch([
    db.delete(schema.chemicalDocFreq),
    db.execute(sql`
      insert into chemical_doc_freq (chemical_id, product_count)
      select chemical_id, count(distinct product_id)::int
      from product_components
      where chemical_id is not null
      group by chemical_id
    `),
  ]);

  invalidateTags(["chemicals", "search", "alternates"]);
  return {
    relinkedComponents: relinked.rowCount ?? 0,
    categoryRows: categories.rowCount ?? 0,
    ingredientFrequencies: frequencies.rowCount ?? 0,
  };
}

/** Deletes per-run intermediates; admin-uploaded source files are kept. */
export async function cleanupChemExpo(paths: string[]) {
  "use step";
  if (!paths.length) return;
  try {
    await del(paths);
  } catch (error) {
    console.warn("ChemExpo cleanup failed", paths, error);
  }
}
