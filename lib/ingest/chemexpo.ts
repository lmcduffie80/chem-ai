import { invalidateTags } from "./invalidate";
import { get, put } from "@vercel/blob";
import { parse as parseStream } from "csv-parse";
import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
import { Unzip, UnzipInflate } from "fflate";
import { Readable } from "node:stream";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { normalizeCas } from "@/lib/cas";
import { CHEMEXPO_SOURCE, type SupplierKind } from "@/lib/product-sources";

export const CHEMEXPO_COMPOSITION_URL = "https://comptox.epa.gov/chemexpo/dl_co_chemicals/";
/** Most recent products kept per chemical. Full counts live in `chemical_product_categories`. */
const PRODUCTS_PER_CHEMICAL = 25;
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

/**
 * First pass: picks the most recent products for each known chemical and replaces the
 * per-category product counts. Returns the Blob path of the selected document IDs.
 */
export async function planChemExpoSample(pathname: string) {
  "use step";
  const idByCas = await chemicalIdsByCas();
  const docDate = new Map<number, number>();
  const seenPairs = new Set<number>();
  const counts = new Map<number, Map<string, number>>();
  const top = new Map<number, { doc: number; t: number }[]>();
  let rows = 0;

  for await (const { row, col } of compositionRows(pathname)) {
    rows++;
    const doc = Number(row[col.doc]);
    if (!Number.isFinite(doc)) continue;
    let t = docDate.get(doc);
    if (t === undefined) {
      const date = parseLooseDate(row[col.date]);
      t = date ? Date.parse(date) : 0;
      docDate.set(doc, t);
    }
    const cas = rowCas(row, col);
    const chemicalId = cas ? idByCas.get(cas) : undefined;
    if (!chemicalId) continue;
    const pair = chemicalId * 2 ** 22 + doc;
    if (seenPairs.has(pair)) continue;
    seenPairs.add(pair);

    const category = row[col.pucGeneral]?.trim() || "Uncategorized";
    const byCategory = counts.get(chemicalId) ?? new Map<string, number>();
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    counts.set(chemicalId, byCategory);

    const list = top.get(chemicalId) ?? [];
    if (list.length < PRODUCTS_PER_CHEMICAL) {
      list.push({ doc, t });
    } else {
      let minIndex = 0;
      for (let i = 1; i < list.length; i++) if (list[i].t < list[minIndex].t) minIndex = i;
      if (t > list[minIndex].t) list[minIndex] = { doc, t };
    }
    top.set(chemicalId, list);
  }

  const selected = new Set<number>();
  for (const list of top.values()) for (const { doc } of list) selected.add(doc);

  const categoryRows = [...counts.entries()].flatMap(([chemicalId, byCategory]) =>
    [...byCategory.entries()].map(([category, productCount]) => ({
      chemicalId,
      source: CHEMEXPO_SOURCE,
      category,
      productCount,
    })),
  );
  await db.delete(schema.chemicalProductCategories).where(eq(schema.chemicalProductCategories.source, CHEMEXPO_SOURCE));
  for (let i = 0; i < categoryRows.length; i += INSERT_BATCH) {
    await db.insert(schema.chemicalProductCategories).values(categoryRows.slice(i, i + INSERT_BATCH));
  }

  const blob = await put(`ingest/chemexpo/selected-${Date.now()}.json`, JSON.stringify([...selected]), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: true,
  });
  return {
    selectedPath: blob.pathname,
    stats: { rows, products: docDate.size, chemicals: counts.size, sampled: selected.size } satisfies IngestStats,
  };
}

type StagedProduct = {
  doc: number;
  source: string;
  name: string;
  category: string | null;
  date: string | null;
  components: { cas: string | null; name: string; min: number | null; max: number | null }[];
};

function percent(value: string | undefined) {
  if (!value?.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100 * 10000) / 10000 : null;
}

/** Second pass: gathers metadata and full compositions for the sampled products into Blob chunks. */
export async function extractChemExpoProducts(pathname: string, selectedPath: string) {
  "use step";
  const selectedBlob = await get(selectedPath, { access: "private", useCache: false });
  if (!selectedBlob || selectedBlob.statusCode !== 200) throw new Error(`Blob not found: ${selectedPath}`);
  const selected = new Set<number>(await new Response(selectedBlob.stream).json());

  const products = new Map<number, StagedProduct>();
  for await (const { row, col } of compositionRows(pathname)) {
    const doc = Number(row[col.doc]);
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
        name: (row[col.product] || row[col.title] || `ChemExpo document ${doc}`).trim().slice(0, 300),
        category: category || null,
        date: parseLooseDate(row[col.date]),
        components: [],
      };
      products.set(doc, product);
    }
    const lower = percent(row[col.lower]);
    const upper = percent(row[col.upper]);
    const central = percent(row[col.central]);
    const cas = rowCas(row, col);
    product.components.push({
      cas,
      name: (row[col.curatedName] || row[col.rawName] || cas || "Unnamed ingredient").trim().slice(0, 300),
      min: lower ?? central,
      max: upper ?? central,
    });
  }

  const all = [...products.values()];
  const chunkPaths: string[] = [];
  for (let i = 0; i < all.length; i += PRODUCTS_PER_CHUNK) {
    const blob = await put(
      `ingest/chemexpo/products-${Date.now()}-${i / PRODUCTS_PER_CHUNK}.json`,
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
  if (!blob || blob.statusCode !== 200) throw new Error(`Blob not found: ${chunkPath}`);
  const staged: StagedProduct[] = await new Response(blob.stream).json();
  const now = new Date();

  const sourceNames = [...new Set(staged.map((p) => p.source))];
  const suppliers = await db
    .insert(schema.suppliers)
    .values(sourceNames.map((name) => ({ source: CHEMEXPO_SOURCE, externalId: slug(name), name, kind: supplierKind(name) })))
    .onConflictDoUpdate({
      target: [schema.suppliers.source, schema.suppliers.externalId],
      set: { name: sql`excluded.name`, kind: sql`excluded.kind`, updatedAt: now },
    })
    .returning({ id: schema.suppliers.id, name: schema.suppliers.name });
  const supplierId = new Map(suppliers.map((s) => [s.name, s.id]));

  const productIdByDoc = new Map<string, string>();
  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < staged.length; i += INSERT_BATCH) {
    const rows = await db
      .insert(schema.products)
      .values(
        staged.slice(i, i + INSERT_BATCH).map((p) => ({
          supplierId: supplierId.get(p.source)!,
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
    for (const r of rows) {
      productIdByDoc.set(r.externalId, r.id);
      if (r.inserted) inserted++;
      else updated++;
    }
  }

  const productIds = [...productIdByDoc.values()];
  for (let i = 0; i < productIds.length; i += INSERT_BATCH) {
    await db
      .delete(schema.productComponents)
      .where(inArray(schema.productComponents.productId, productIds.slice(i, i + INSERT_BATCH)));
  }

  const casList = [...new Set(staged.flatMap((p) => p.components.map((c) => c.cas)).filter((c): c is string => !!c))];
  const idByCas = new Map<string, number>();
  for (let i = 0; i < casList.length; i += INSERT_BATCH) {
    const rows = await db
      .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
      .from(schema.chemicals)
      .where(inArray(schema.chemicals.casRn, casList.slice(i, i + INSERT_BATCH)));
    for (const r of rows) idByCas.set(r.casRn, r.id);
  }

  const components = staged.flatMap((p) =>
    p.components.map((c) => ({
      productId: productIdByDoc.get(String(p.doc))!,
      chemicalId: c.cas ? (idByCas.get(c.cas) ?? null) : null,
      casRn: c.cas,
      componentName: c.name,
      minPct: c.min,
      maxPct: c.max,
    })),
  );
  for (let i = 0; i < components.length; i += INSERT_BATCH) {
    await db.insert(schema.productComponents).values(components.slice(i, i + INSERT_BATCH));
  }

  return { processed: staged.length, inserted, updated, components: components.length };
}

/** Removes ChemExpo products that fell out of the sample in this run, plus empty ChemExpo suppliers. */
export async function pruneChemExpo(runId: string): Promise<IngestStats> {
  "use step";
  const [run] = await db
    .select({ startedAt: schema.ingestRuns.startedAt })
    .from(schema.ingestRuns)
    .where(eq(schema.ingestRuns.id, runId));
  if (!run) throw new Error(`Unknown ingest run ${runId}`);

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

  invalidateTags(["chemicals", "search"]);
  return { removed: removed.length };
}
