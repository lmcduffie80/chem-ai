# Substitute Products Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load every EPA ChemExpo product (deduplicated) and show buyers alternate products. On a product page, these are products sharing its CAS numbers, ranked by composition closeness. On a chemical page, these are all products containing a CAS number, purest first. Both are also available through the API.

**Architecture:** The ChemExpo loader switches from a 25-per-chemical sample to a deduplicated full load. Extraction is partitioned to bound memory, and a final SQL step rebuilds category counts and ingredient frequencies. Alternates are computed at request time by one SQL query: weighted Jaccard similarity with IDF-weighted ingredient shares, using the product's three rarest ingredients for candidates. Results are cached with `"use cache"`. A dependency-free TypeScript scorer mirrors the SQL for unit tests and an integration check.

**Tech Stack:** Next.js 16.4 (Cache Components), Drizzle ORM on Neon (neon-http), Workflow SDK steps, Vercel Blob, csv-parse, fflate, Vitest (new).

**Spec:** `docs/superpowers/specs/2026-10-31-substitute-products-design.md`

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `vitest.config.ts` | create | Test runner config with `@/` alias |
| `lib/alternates/score.ts` | create | Pure scoring: midpoint weight, ingredient weights, weighted Jaccard |
| `lib/alternates/score.test.ts` | create | Unit tests for scoring |
| `lib/ingest/product-identity.ts` | create | Pure product identity key and newest-document rule |
| `lib/ingest/product-identity.test.ts` | create | Unit tests for identity |
| `db/schema.ts` | modify | `weight` column, nullable `component_name`, `(chemical_id, product_id)` index, `chemical_doc_freq` table |
| `db/migrations/0004_substitute_products.sql` | generate | Migration |
| `lib/ingest/chemexpo.ts` | modify | Dedup plan pass, partitioned extract, compact chunks, summarize step |
| `workflows/ingest.ts` | modify | New chemexpo workflow sequence |
| `scripts/load-chemexpo.ts` | modify | New script sequence |
| `scripts/db-size.ts` | create | Prints database and table sizes |
| `lib/alternates/query.ts` | create | SQL alternates query plus cached wrapper |
| `scripts/check-alternates.ts` | create | Compares SQL scores with the TS scorer |
| `app/products/[id]/alternates-section.tsx` | create | Alternates UI |
| `app/products/[id]/page.tsx` | modify | Mount alternates; nullable component name |
| `lib/chemical-products.ts` | create | Paginated products-containing-chemical query, category helpers |
| `app/chemicals/[cas]/products-section.tsx` | create | Filterable, paginated product list UI |
| `app/chemicals/[cas]/page.tsx` | modify | Replace inline `Products` with `ProductsSection` |
| `lib/chemicals.ts` | modify | Drop product rows from `getChemicalByCas` |
| `lib/api-serializers.ts` | modify | Product and alternate serializers |
| `app/api/v1/chemicals/[cas]/route.ts` | modify | Pass page-1 products to serializer |
| `app/api/v1/chemicals/[cas]/products/route.ts` | create | Products API |
| `app/api/v1/products/[id]/alternates/route.ts` | create | Alternates API |
| `lib/openapi.ts` | modify | Document both endpoints |
| `package.json` | modify | `test`, `check:alternates`, `db:size` scripts; vitest dev dependency |
| `README.md`, `app/data-sources/page.tsx` | modify | Describe the full load |

---

### Task 1: Add Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install**

Run: `pnpm add -D vitest`
Expected: `vitest` appears under `devDependencies`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts"] },
});
```

- [ ] **Step 3: Add scripts to `package.json` `scripts`**

```json
"test": "vitest run",
"check:alternates": "tsx --env-file=.env.local scripts/check-alternates.ts",
"db:size": "tsx --env-file=.env.local scripts/db-size.ts"
```

- [ ] **Step 4: Verify the runner starts**

Run: `pnpm test`
Expected: exits with "No test files found" (code 1). That's fine until Task 2.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "Add Vitest"
```

---

### Task 2: Scoring module

**Files:**
- Create: `lib/alternates/score.ts`
- Test: `lib/alternates/score.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { ingredientWeights, midpointWeight, weightedJaccard } from "./score";

const WATER = 99;

describe("midpointWeight", () => {
  it("uses the midpoint of a range as a fraction", () => {
    expect(midpointWeight(10, 30)).toBeCloseTo(0.2);
  });
  it("uses whichever bound is reported", () => {
    expect(midpointWeight(null, 5)).toBeCloseTo(0.05);
    expect(midpointWeight(40, null)).toBeCloseTo(0.4);
  });
  it("returns null with no percentages", () => {
    expect(midpointWeight(null, null)).toBeNull();
  });
});

describe("ingredientWeights", () => {
  const freq = new Map([
    [1, 10],
    [2, 100],
  ]);

  it("falls back to equal shares when percentages are missing", () => {
    const w = ingredientWeights(
      [
        { chemicalId: 1, weight: null },
        { chemicalId: 2, weight: null },
      ],
      freq,
      1000,
      WATER,
    );
    expect(w.get(1)).toBeCloseTo(0.5 * Math.log(1000 / 10));
    expect(w.get(2)).toBeCloseTo(0.5 * Math.log(1000 / 100));
  });

  it("ignores water", () => {
    const w = ingredientWeights(
      [
        { chemicalId: WATER, weight: 0.9 },
        { chemicalId: 1, weight: null },
      ],
      freq,
      1000,
      WATER,
    );
    expect([...w.keys()]).toEqual([1]);
    expect(w.get(1)).toBeCloseTo(Math.log(100));
  });

  it("keeps the larger weight when an ingredient is listed twice", () => {
    const w = ingredientWeights(
      [
        { chemicalId: 1, weight: 0.1 },
        { chemicalId: 1, weight: 0.3 },
      ],
      freq,
      1000,
      WATER,
    );
    expect(w.get(1)).toBeCloseTo(0.3 * Math.log(100));
  });

  it("treats unknown frequencies as 1", () => {
    const w = ingredientWeights([{ chemicalId: 7, weight: 1 }], freq, 1000, WATER);
    expect(w.get(7)).toBeCloseTo(Math.log(1000));
  });
});

describe("weightedJaccard", () => {
  it("scores identical products 1", () => {
    const a = new Map([
      [1, 0.4],
      [2, 0.6],
    ]);
    expect(weightedJaccard(a, new Map(a))).toBe(1);
  });
  it("scores disjoint products 0", () => {
    expect(weightedJaccard(new Map([[1, 1]]), new Map([[2, 1]]))).toBe(0);
  });
  it("scores partial overlap", () => {
    const a = new Map([
      [1, 0.5],
      [2, 0.5],
    ]);
    const b = new Map([
      [1, 0.5],
      [3, 0.5],
    ]);
    expect(weightedJaccard(a, b)).toBeCloseTo(1 / 3);
  });
  it("returns 0 when both are empty", () => {
    expect(weightedJaccard(new Map(), new Map())).toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test`
Expected: FAIL, "Failed to resolve import ./score".

- [ ] **Step 3: Implement `lib/alternates/score.ts`**

```ts
export const WATER_CAS = "7732-18-5";

export type Ingredient = { chemicalId: number; weight: number | null };

/** Reported percentage range → weight fraction (0–1), or null when nothing is reported. */
export function midpointWeight(minPct: number | null, maxPct: number | null): number | null {
  if (minPct === null && maxPct === null) return null;
  const mid = minPct !== null && maxPct !== null ? (minPct + maxPct) / 2 : (minPct ?? maxPct)!;
  return mid / 100;
}

/**
 * w(c) = share × ln(N / productCount(c)). Share is the reported weight, or an equal split when
 * missing. Must stay in step with the SQL in `lib/alternates/query.ts`.
 */
export function ingredientWeights(
  ingredients: Ingredient[],
  docFreq: Map<number, number>,
  totalProducts: number,
  waterId: number | null,
): Map<number, number> {
  const merged = new Map<number, number | null>();
  for (const { chemicalId, weight } of ingredients) {
    if (chemicalId === waterId) continue;
    const prev = merged.get(chemicalId);
    merged.set(chemicalId, prev == null ? weight : weight == null ? prev : Math.max(prev, weight));
  }
  const share = 1 / merged.size;
  const total = Math.max(totalProducts, 1);
  const result = new Map<number, number>();
  for (const [chemicalId, weight] of merged) {
    const idf = Math.log(total / Math.max(docFreq.get(chemicalId) ?? 1, 1));
    result.set(chemicalId, (weight ?? share) * idf);
  }
  return result;
}

export function weightedJaccard(a: Map<number, number>, b: Map<number, number>): number {
  let shared = 0;
  let union = 0;
  for (const [id, wa] of a) {
    const wb = b.get(id) ?? 0;
    shared += Math.min(wa, wb);
    union += Math.max(wa, wb);
  }
  for (const [id, wb] of b) if (!a.has(id)) union += wb;
  return union === 0 ? 0 : shared / union;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/alternates
git commit -m "Add alternates scoring functions"
```

---

### Task 3: Product identity module

**Files:**
- Create: `lib/ingest/product-identity.ts`
- Test: `lib/ingest/product-identity.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { isNewerDocument, productKey } from "./product-identity";

describe("productKey", () => {
  it("collapses case, punctuation and whitespace", () => {
    expect(productKey("Method", "Method Body Lotion — Daily Zen", 1)).toBe(
      productKey("method", "method body lotion daily  zen", 2),
    );
  });
  it("strips accents", () => {
    expect(productKey("L'Oréal", "Crème", 1)).toBe(productKey("L'Oreal", "Creme", 2));
  });
  it("keeps different makers apart", () => {
    expect(productKey("Walmart", "Bleach", 1)).not.toBe(productKey("Target", "Bleach", 2));
  });
  it("never merges products whose names normalize to nothing", () => {
    expect(productKey("Walmart", "—", 1)).not.toBe(productKey("Walmart", "—", 2));
  });
});

describe("isNewerDocument", () => {
  it("prefers the later date", () => {
    expect(isNewerDocument({ doc: 1, t: 200 }, { doc: 2, t: 100 })).toBe(true);
    expect(isNewerDocument({ doc: 2, t: 100 }, { doc: 1, t: 200 })).toBe(false);
  });
  it("breaks date ties with the higher document id", () => {
    expect(isNewerDocument({ doc: 5, t: 100 }, { doc: 4, t: 100 })).toBe(true);
    expect(isNewerDocument({ doc: 4, t: 100 }, { doc: 5, t: 100 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm test`
Expected: FAIL, "Failed to resolve import ./product-identity".

- [ ] **Step 3: Implement `lib/ingest/product-identity.ts`**

```ts
export type DocumentStamp = { doc: number; t: number };

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Revisions and re-filings of the same product share a key; unnamed products never merge. */
export function productKey(maker: string, productName: string, doc: number) {
  const name = normalize(productName);
  return name ? `${normalize(maker)}|${name}` : `doc:${doc}`;
}

export function isNewerDocument(candidate: DocumentStamp, current: DocumentStamp) {
  return candidate.t > current.t || (candidate.t === current.t && candidate.doc > current.doc);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add lib/ingest/product-identity.ts lib/ingest/product-identity.test.ts
git commit -m "Add product identity helpers for ChemExpo deduplication"
```

---

### Task 4: Schema and migration

**Files:**
- Modify: `db/schema.ts` (the `productComponents` and `chemicalProductCategories` definitions)
- Generate: `db/migrations/0004_substitute_products.sql`

- [ ] **Step 1: Edit `productComponents` in `db/schema.ts`**

Replace the `productComponents` table with:

```ts
export const productComponents = pgTable(
  "product_components",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    chemicalId: integer("chemical_id").references(() => chemicals.id, { onDelete: "set null" }),
    casRn: text("cas_rn"),
    /** Raw ingredient name; null when `chemicalId` resolves, so pages use the chemical's preferred name. */
    componentName: text("component_name"),
    minPct: real("min_pct"),
    maxPct: real("max_pct"),
    /** Midpoint of the reported range as a fraction (0–1); 1 for single-ingredient products. */
    weight: real("weight"),
  },
  (t) => [
    index("product_components_product_idx").on(t.productId),
    index("product_components_chemical_idx").on(t.chemicalId, t.productId),
  ],
);
```

- [ ] **Step 2: Update the `chemicalProductCategories` comment and add `chemicalDocFreq` after it**

```ts
/** Product counts per general use category, rebuilt from loaded products after each ChemExpo load. */
export const chemicalProductCategories = pgTable(
```

```ts
/** Number of products containing each chemical; down-weights ubiquitous ingredients when matching alternates. */
export const chemicalDocFreq = pgTable("chemical_doc_freq", {
  chemicalId: integer("chemical_id")
    .primaryKey()
    .references(() => chemicals.id, { onDelete: "cascade" }),
  productCount: integer("product_count").notNull(),
});
```

- [ ] **Step 3: Generate and apply the migration**

Run: `pnpm db:generate --name substitute_products && pnpm db:migrate`
Expected: `db/migrations/0004_substitute_products.sql` contains:
- `ALTER TABLE "product_components" ALTER COLUMN "component_name" DROP NOT NULL`;
- `ADD COLUMN "weight" real`;
- `CREATE TABLE "chemical_doc_freq"`;
- a drop and re-create of `product_components_chemical_idx` on `("chemical_id","product_id")`.

The migrate step then prints success.

- [ ] **Step 4: Fix the one reader that assumes a non-null name**

In `app/products/[id]/page.tsx`, change the component cell:

```tsx
<TableCell>{c.chemicalName ?? c.componentName ?? c.casRn ?? "Unnamed ingredient"}</TableCell>
```

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add db/schema.ts db/migrations app/products/[id]/page.tsx
git commit -m "Add component weights and ingredient frequency table"
```

---

### Task 5: Full deduplicated ChemExpo loader

**Files:**
- Modify: `lib/ingest/chemexpo.ts`
- Create: `lib/chemical-products.ts` (only the `generalCategory` helper in this task; Task 9 adds the rest)
- Modify: `workflows/ingest.ts` (`chemexpoWorkflow`)
- Modify: `scripts/load-chemexpo.ts`

- [ ] **Step 1: Create `lib/chemical-products.ts` with the shared category expression**

```ts
import { type SQL, sql } from "drizzle-orm";

/** First segment of a "General › Family › Type" category, or "Uncategorized". */
export function generalCategory(column: SQL) {
  return sql`coalesce(nullif(split_part(coalesce(${column}, ''), ' › ', 1), ''), 'Uncategorized')`;
}
```

- [ ] **Step 2: Update constants and imports at the top of `lib/ingest/chemexpo.ts`**

Replace the import block and constants (lines 1–16) with:

```ts
import { invalidateTags } from "./invalidate";
import { isNewerDocument, productKey } from "./product-identity";
import { get, put } from "@vercel/blob";
import { parse as parseStream } from "csv-parse";
import { and, eq, inArray, lt, notExists, sql } from "drizzle-orm";
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
const PRODUCTS_PER_CHUNK = 3000;
const INSERT_BATCH = 1000;
```

- [ ] **Step 3: Add a `productName` helper after `rowCas`**

```ts
function productName(row: string[], col: Columns, doc: number) {
  return (row[col.product] || row[col.title] || `ChemExpo document ${doc}`).trim().slice(0, 300);
}
```

- [ ] **Step 4: Replace `planChemExpoSample` with `planChemExpoProducts`**

Delete the whole `planChemExpoSample` function (with its doc comment) and add:

```ts
/** First pass: keeps the newest document for each distinct product (maker + normalized name). */
export async function planChemExpoProducts(pathname: string) {
  "use step";
  const seenDocs = new Set<number>();
  const winners = new Map<string, { doc: number; t: number }>();
  let rows = 0;

  for await (const { row, col } of compositionRows(pathname)) {
    rows++;
    const doc = Number(row[col.doc]);
    if (!Number.isFinite(doc) || seenDocs.has(doc)) continue;
    seenDocs.add(doc);
    const date = parseLooseDate(row[col.date]);
    const candidate = { doc, t: date ? Date.parse(date) : 0 };
    const key = productKey(row[col.source]?.trim() || "Unknown source", productName(row, col, doc), doc);
    const current = winners.get(key);
    if (!current || isNewerDocument(candidate, current)) winners.set(key, candidate);
  }

  const selected = [...winners.values()].map((w) => w.doc);
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
```

- [ ] **Step 5: Replace `StagedProduct` and `extractChemExpoProducts`**

Delete the existing `StagedProduct` type and `extractChemExpoProducts`, keep `percent`, and add:

```ts
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
      : (row[col.curatedName] || row[col.rawName] || cas || "Unnamed ingredient").trim().slice(0, 300);
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
```

- [ ] **Step 6: Simplify component insertion in `upsertChemExpoChunk`**

In `upsertChemExpoChunk`, delete everything from `const casList = ...` through the `idByCas` loop. Replace the `components` construction with:

```ts
  const components = staged.flatMap((p) =>
    p.components.map(([casRn, chemicalId, componentName, minPct, maxPct, weight]) => ({
      productId: productIdByDoc.get(String(p.doc))!,
      chemicalId,
      casRn,
      componentName,
      minPct,
      maxPct,
      weight,
    })),
  );
```

- [ ] **Step 7: Move cache invalidation out of `pruneChemExpo` and add `summarizeChemExpo`**

In `pruneChemExpo`, delete the line `invalidateTags(["chemicals", "search"]);` and update its doc comment to "Removes ChemExpo products not refreshed by this run, plus empty ChemExpo suppliers." Then append:

```ts
/** Rebuilds per-category product counts and ingredient frequencies from the loaded products. */
export async function summarizeChemExpo(): Promise<IngestStats> {
  "use step";
  await db.delete(schema.chemicalProductCategories).where(eq(schema.chemicalProductCategories.source, CHEMEXPO_SOURCE));
  const categories = await db.execute(sql`
    insert into chemical_product_categories (chemical_id, source, category, product_count)
    select pc.chemical_id, ${CHEMEXPO_SOURCE}, ${generalCategory(sql`p.category`)}, count(distinct p.id)::int
    from product_components pc
    join products p on p.id = pc.product_id
    where p.source = ${CHEMEXPO_SOURCE} and pc.chemical_id is not null
    group by pc.chemical_id, 3
  `);

  await db.delete(schema.chemicalDocFreq);
  const frequencies = await db.execute(sql`
    insert into chemical_doc_freq (chemical_id, product_count)
    select chemical_id, count(distinct product_id)::int
    from product_components
    where chemical_id is not null
    group by chemical_id
  `);

  invalidateTags(["chemicals", "search", "alternates"]);
  return { categoryRows: categories.rowCount ?? 0, ingredientFrequencies: frequencies.rowCount ?? 0 };
}
```

- [ ] **Step 8: Update `chemexpoWorkflow` in `workflows/ingest.ts`**

Change the import to bring in `planChemExpoProducts` and `summarizeChemExpo` instead of `planChemExpoSample`, then replace the `try` body:

```ts
  try {
    const { pathname } = await stageChemExpo();
    const plan = await planChemExpoProducts(pathname);
    stats = mergeStats(stats, plan.stats);
    for (let partition = 0; partition < plan.partitions; partition++) {
      const chunkPaths = await extractChemExpoProducts(pathname, plan.selectedPath, partition, plan.partitions);
      for (const chunkPath of chunkPaths) {
        stats = mergeStats(stats, await upsertChemExpoChunk(chunkPath));
      }
    }
    stats = mergeStats(stats, await pruneChemExpo(runId));
    stats = mergeStats(stats, await summarizeChemExpo());
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
```

- [ ] **Step 9: Update `scripts/load-chemexpo.ts`**

Replace the import list from `../lib/ingest/chemexpo` with `extractChemExpoProducts, planChemExpoProducts, pruneChemExpo, stageChemExpo, summarizeChemExpo, upsertChemExpoChunk`. Then replace the body of `try` in `main`:

```ts
    const pathname = await stage(process.argv[2]);
    console.log("staged", pathname);
    const plan = await planChemExpoProducts(pathname);
    stats = mergeStats(stats, plan.stats);
    console.log("plan", plan.stats);
    for (let partition = 0; partition < plan.partitions; partition++) {
      const chunks = await extractChemExpoProducts(pathname, plan.selectedPath, partition, plan.partitions);
      console.log(`partition ${partition + 1}/${plan.partitions}: ${chunks.length} chunks`);
      for (const [i, chunk] of chunks.entries()) {
        const result = await upsertChemExpoChunk(chunk);
        stats = mergeStats(stats, result);
        console.log(`  chunk ${i + 1}/${chunks.length}`, result);
      }
    }
    stats = mergeStats(stats, await pruneChemExpo(runId));
    stats = mergeStats(stats, await summarizeChemExpo());
    await finishRun(runId, stats);
    console.log("done", stats);
```

- [ ] **Step 10: Typecheck, lint, test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: no errors. The workflow compile line still reports 9 workflows.

- [ ] **Step 11: Commit**

```bash
git add lib/ingest/chemexpo.ts lib/chemical-products.ts workflows/ingest.ts scripts/load-chemexpo.ts
git commit -m "Load all ChemExpo products with deduplication"
```

---

### Task 6: Run the full load and check size

**Files:**
- Create: `scripts/db-size.ts`

- [ ] **Step 1: Create `scripts/db-size.ts`**

```ts
/** Prints database and largest-table sizes.  pnpm db:size */
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  const { rows } = await db.execute(sql`
    select 'database' as name, pg_size_pretty(pg_database_size(current_database())) as size
    union all
    select relname, pg_size_pretty(pg_total_relation_size(relid))
    from (select relid, relname from pg_catalog.pg_statio_user_tables
          order by pg_total_relation_size(relid) desc limit 6) t
  `);
  console.table(rows);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
```

- [ ] **Step 2: Record the size before loading**

Run: `pnpm db:size`
Expected: database about 209 MB.

- [ ] **Step 3: Run the load from the local download**

Run (do not pipe through another command; piping buffers the output): `pnpm -s load:chemexpo .scratch/chemexpo_co.zip`

Expected:
- `plan { rows: 3574049, documents: 406783, products: <250k–350k> }`;
- four partitions of chunks;
- `done` with `removed` greater than 0 (sampled products superseded by newer documents) and `categoryRows`/`ingredientFrequencies` greater than 0.

This takes roughly 15–30 minutes. If `.scratch/chemexpo_co.zip` is missing, download it first from `https://comptox.epa.gov/chemexpo/dl_co_chemicals/` (about 63 MB, slow server).

- [ ] **Step 4: Check the size**

Run: `pnpm db:size`
Expected: database under 0.9 GB. If it's over, stop and report: the spec says to move to Neon Launch before continuing.

- [ ] **Step 5: Commit**

```bash
git add scripts/db-size.ts
git commit -m "Add database size script"
```

---

### Task 7: Alternates query

**Files:**
- Create: `lib/alternates/query.ts`
- Create: `scripts/check-alternates.ts`

- [ ] **Step 1: Create `lib/alternates/query.ts`**

```ts
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
```

- [ ] **Step 2: Create `scripts/check-alternates.ts`**

```ts
/**
 * Compares SQL alternate scores with the TypeScript reference scorer for one product.
 *   pnpm check:alternates <productId>
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { queryProductAlternates } from "../lib/alternates/query";
import { type Ingredient, ingredientWeights, WATER_CAS, weightedJaccard } from "../lib/alternates/score";

async function ingredientsByProduct(productIds: string[]) {
  const rows = await db
    .select({
      productId: schema.productComponents.productId,
      chemicalId: schema.productComponents.chemicalId,
      weight: schema.productComponents.weight,
    })
    .from(schema.productComponents)
    .where(and(inArray(schema.productComponents.productId, productIds), isNotNull(schema.productComponents.chemicalId)));
  const map = new Map<string, Ingredient[]>();
  for (const r of rows) {
    const list = map.get(r.productId) ?? [];
    list.push({ chemicalId: r.chemicalId!, weight: r.weight });
    map.set(r.productId, list);
  }
  return map;
}

async function main() {
  const productId = process.argv[2];
  if (!productId) throw new Error("Usage: pnpm check:alternates <productId>");
  const result = await queryProductAlternates(productId);
  if (result.status !== "ok") {
    console.log(result.status);
    return;
  }
  const top = [...result.close, ...result.partial].slice(0, 10);
  const byProduct = await ingredientsByProduct([productId, ...top.map((a) => a.id)]);
  const chemicalIds = [...new Set([...byProduct.values()].flat().map((i) => i.chemicalId))];
  const freq = await db
    .select()
    .from(schema.chemicalDocFreq)
    .where(inArray(schema.chemicalDocFreq.chemicalId, chemicalIds));
  const docFreq = new Map(freq.map((f) => [f.chemicalId, f.productCount]));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.products);
  const [water] = await db
    .select({ id: schema.chemicals.id })
    .from(schema.chemicals)
    .where(eq(schema.chemicals.casRn, WATER_CAS));
  const weigh = (id: string) => ingredientWeights(byProduct.get(id) ?? [], docFreq, total, water?.id ?? null);

  const source = weigh(productId);
  let worst = 0;
  for (const a of top) {
    const expected = weightedJaccard(source, weigh(a.id));
    worst = Math.max(worst, Math.abs(expected - a.score));
    console.log(a.score.toFixed(4), expected.toFixed(4), a.name);
  }
  console.log(worst < 1e-4 ? "OK" : `MISMATCH (max difference ${worst})`);
  if (worst >= 1e-4) process.exitCode = 1;
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
```

- [ ] **Step 3: Pick a test product and run the check**

Find a Method lotion's product ID. Open `http://localhost:3000/chemicals/11138-66-2` and click "method body lotion daily zen"; the ID is in the URL.

Run: `pnpm check:alternates <that id>`
Expected: ten lines where both columns match, then `OK`. The top lines are other Method lotions.

- [ ] **Step 4: Check timing on a product made only of common ingredients**

Run: `time pnpm check:alternates <same id>` twice.
Expected: the query part stays under 2 s (total script time includes tsx startup of about 1 s). If it's slower, report it before continuing; don't change the formula.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add lib/alternates/query.ts scripts/check-alternates.ts
git commit -m "Add alternates query with consistency check"
```

---

### Task 8: Alternates section on the product page

**Files:**
- Create: `app/products/[id]/alternates-section.tsx`
- Modify: `app/products/[id]/page.tsx`

- [ ] **Step 1: Create `app/products/[id]/alternates-section.tsx`**

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Alternate, getProductAlternates } from "@/lib/alternates/query";
import { manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";

const SHARED_CHIPS = 6;

export async function AlternatesSection({ productId }: { productId: string }) {
  const result = await getProductAlternates(productId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alternates</CardTitle>
        <CardDescription>Other products containing the same ingredients, closest formulation first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {result.status === "unavailable" ? (
          <p className="text-muted-foreground text-sm">Alternates are temporarily unavailable. Try again in a few minutes.</p>
        ) : result.status === "no_ingredients" ? (
          <p className="text-muted-foreground text-sm">
            We can&apos;t match this product because none of its ingredients are on the TSCA inventory.
          </p>
        ) : result.close.length + result.partial.length === 0 ? (
          <p className="text-muted-foreground text-sm">No other products in the catalog share this product&apos;s ingredients.</p>
        ) : (
          <>
            <AlternatesTable title="Close matches" rows={result.close} sourceCount={result.sourceCount} />
            <AlternatesTable title="Partial matches" rows={result.partial} sourceCount={result.sourceCount} />
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Based on formulations reported to EPA. Confirm against the manufacturer&apos;s current SDS before switching.
        </p>
      </CardContent>
    </Card>
  );
}

function AlternatesTable({ title, rows, sourceCount }: { title: string; rows: Alternate[]; sourceCount: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} ({rows.length})
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Match</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Maker / source</TableHead>
            <TableHead>Shared ingredients</TableHead>
            <TableHead>SDS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell
                className="font-medium tabular-nums"
                title={`Shares ${a.sharedCount} of ${sourceCount} ingredients; weighted by reported amounts and how common each ingredient is`}
              >
                {Math.round(a.score * 100)}%
              </TableCell>
              <TableCell className="max-w-xs min-w-48 whitespace-normal">
                <Link href={`/products/${a.id}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {[a.category, a.documentDate?.slice(0, 4)].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="text-muted-foreground text-xs">{supplierRoleLabel(a.makerKind)} </span>
                <Link href={`/suppliers/${a.makerId}`} className="hover:underline">
                  {a.maker}
                </Link>
              </TableCell>
              <TableCell className="max-w-sm min-w-48 whitespace-normal">
                <div className="flex flex-wrap items-center gap-1">
                  {a.shared.slice(0, SHARED_CHIPS).map((s) => (
                    <Badge key={s.casRn} variant="secondary" className="font-normal">
                      {s.name}
                    </Badge>
                  ))}
                  {a.shared.length > SHARED_CHIPS && (
                    <span className="text-muted-foreground text-xs">+{a.shared.length - SHARED_CHIPS} shared</span>
                  )}
                  {a.addedCount > 0 && <span className="text-muted-foreground text-xs">+{a.addedCount} other</span>}
                </div>
              </TableCell>
              <TableCell>
                {a.sdsId ? (
                  <Link href={`/sds/${a.sdsId}`} className="text-sm hover:underline">
                    SDS
                  </Link>
                ) : (
                  <a
                    href={manufacturerSdsSearchUrl(a.name, a.maker, a.makerKind)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm whitespace-nowrap underline-offset-4 hover:underline"
                  >
                    Find SDS ↗
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `app/products/[id]/page.tsx`**

Add the import `import { AlternatesSection } from "./alternates-section";`. Between the Composition card and the Safety data sheets card, insert:

```tsx
      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <AlternatesSection productId={product.id} />
      </Suspense>
```

- [ ] **Step 3: Verify in the browser**

With `pnpm dev` running, open the Method lotion product page from Task 7.
Expected: an "Alternates" card with "Close matches" containing other Method lotions, match percentages, ingredient chips and "Find SDS ↗" links. Hovering a percentage shows the explanation.

- [ ] **Step 4: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add app/products/[id]
git commit -m "Show alternate products on product pages"
```

---

### Task 9: Products-containing-chemical list

**Files:**
- Modify: `lib/chemical-products.ts`
- Create: `app/chemicals/[cas]/products-section.tsx`
- Modify: `app/chemicals/[cas]/page.tsx`
- Modify: `lib/chemicals.ts` (`getChemicalByCas`)
- Modify: `lib/api-serializers.ts`, `app/api/v1/chemicals/[cas]/route.ts`

- [ ] **Step 1: Replace `lib/chemical-products.ts` with the full module**

```ts
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
```

- [ ] **Step 2: Create `app/chemicals/[cas]/products-section.tsx`**

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getChemicalProducts, PRODUCTS_PAGE_SIZE, productTotal } from "@/lib/chemical-products";
import type { ChemicalDetail } from "@/lib/chemicals";
import { formatPctRange, manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";

type Props = {
  chemicalId: number;
  casRn: string;
  categories: ChemicalDetail["productCategories"];
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function ProductsSection({ chemicalId, casRn, categories, searchParams }: Props) {
  const params = await searchParams;
  const category = typeof params.category === "string" && params.category ? params.category : null;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const products = await getChemicalProducts(chemicalId, category, page);
  const total = Math.max(productTotal(categories, category), (page - 1) * PRODUCTS_PAGE_SIZE + products.length);
  const pages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  const href = (next: { category?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const c = next.category === undefined ? category : next.category;
    if (c) q.set("category", c);
    if ((next.page ?? 1) > 1) q.set("page", String(next.page));
    const query = q.toString();
    return `/chemicals/${casRn}${query ? `?${query}` : ""}#products`;
  };

  return (
    <Card id="products">
      <CardHeader>
        <CardTitle>Products containing this chemical</CardTitle>
        <CardDescription>
          {total === 0
            ? "No products in the Chemspace catalog list this ingredient yet."
            : `${total.toLocaleString()} products${category ? ` in ${category}` : ""}, highest share first. Open a product to see its alternates.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Link href={href({ category: null })}>
              <Badge variant={category ? "outline" : "default"} className="font-normal">
                All
              </Badge>
            </Link>
            {categories.map((c) => (
              <Link key={`${c.source}:${c.category}`} href={href({ category: c.category })}>
                <Badge variant={category === c.category ? "default" : "secondary"} className="font-normal">
                  {c.category} · {c.productCount.toLocaleString()}
                </Badge>
              </Link>
            ))}
          </div>
        )}
        {products.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {total === 0
              ? "Product listings come from EPA ChemExpo and supplier SDS feeds. See “Where to buy” for suppliers selling this chemical, or upload your own SDS in a Team workspace."
              : "No products on this page."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Maker / source</TableHead>
                <TableHead>Share</TableHead>
                <TableHead>SDS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-xs min-w-48 whitespace-normal">
                    <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {[p.category, p.documentDate?.slice(0, 4)].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="text-muted-foreground text-xs">{supplierRoleLabel(p.supplierKind)} </span>
                    <Link href={`/suppliers/${p.supplierId}`} className="hover:underline">
                      {p.supplierName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.minPct === null && p.maxPct === null && p.weight === 1 ? "100%" : formatPctRange(p.minPct, p.maxPct)}
                  </TableCell>
                  <TableCell>
                    {p.sdsId ? (
                      <Link href={`/sds/${p.sdsId}`} className="text-sm hover:underline">
                        {p.sdsRevisionDate ?? "View"}
                      </Link>
                    ) : (
                      <a
                        href={manufacturerSdsSearchUrl(p.name, p.supplierName, p.supplierKind)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm whitespace-nowrap underline-offset-4 hover:underline"
                      >
                        Find SDS ↗
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="hover:underline">← Previous</Link> : <span />}
            <span className="text-muted-foreground">
              Page {page.toLocaleString()} of {pages.toLocaleString()}
            </span>
            {page < pages ? <Link href={href({ page: page + 1 })} className="hover:underline">Next →</Link> : <span />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Remove product rows from `getChemicalByCas` in `lib/chemicals.ts`**

Change the imports to `import { and, asc, desc, eq, ne } from "drizzle-orm";` and delete the `CHEMEXPO_SOURCE` import. In `getChemicalByCas`, replace the `Promise.all` and everything after it with:

```ts
  const [synonyms, hazards, listings, productCategories] = await Promise.all([
    db
      .select({ name: schema.synonyms.name, source: schema.synonyms.source })
      .from(schema.synonyms)
      .where(eq(schema.synonyms.chemicalId, chemical.id))
      .orderBy(asc(schema.synonyms.id))
      .limit(40),
    db.select().from(schema.hazards).where(eq(schema.hazards.chemicalId, chemical.id)),
    db
      .select()
      .from(schema.regulatoryListings)
      .where(eq(schema.regulatoryListings.chemicalId, chemical.id))
      .orderBy(asc(schema.regulatoryListings.listCode)),
    db
      .select({
        source: schema.chemicalProductCategories.source,
        category: schema.chemicalProductCategories.category,
        productCount: schema.chemicalProductCategories.productCount,
      })
      .from(schema.chemicalProductCategories)
      .where(eq(schema.chemicalProductCategories.chemicalId, chemical.id))
      .orderBy(desc(schema.chemicalProductCategories.productCount)),
  ]);

  return {
    ...rest,
    synonyms: synonyms.filter((s) => s.name.toLowerCase() !== chemical.preferredName.toLowerCase()),
    hazards,
    listings,
    productCategories,
    totalProductCount: productCategories.reduce((sum, c) => sum + c.productCount, 0),
  };
}
```

- [ ] **Step 4: Use `ProductsSection` in `app/chemicals/[cas]/page.tsx`**

1. Delete the whole `Products` function.
2. Delete the imports that become unused: `Link`, the `Table*` import, and the `@/lib/product-sources` import.
3. Add `import { ProductsSection } from "./products-section";`.
4. Thread `searchParams` through:

```tsx
export default function ChemicalPage({ params, searchParams }: PageProps<"/chemicals/[cas]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Suspense fallback={<ChemicalSkeleton />}>
        <ChemicalContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ChemicalContent({ params, searchParams }: Pick<PageProps<"/chemicals/[cas]">, "params" | "searchParams">) {
```

5. Replace `<Products chem={chem} />` with:

```tsx
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <ProductsSection
              chemicalId={chem.id}
              casRn={chem.casRn}
              categories={chem.productCategories}
              searchParams={searchParams}
            />
          </Suspense>
```

- [ ] **Step 5: Update the chemical serializer and route**

In `lib/api-serializers.ts`, add `import type { ChemicalProduct } from "@/lib/chemical-products";`, change the signature to `serializeChemical(c: ChemicalDetail, products: ChemicalProduct[])`, and replace the `products` and `sdsDocuments` fields:

```ts
    totalProducts: c.totalProductCount,
    products: products.map(serializeChemicalProduct),
    sdsDocuments: products
      .filter((p) => p.sdsId)
      .map((p) => ({ id: p.sdsId, productId: p.id, revisionDate: p.sdsRevisionDate })),
```

Add below `serializeChemical`:

```ts
export function serializeChemicalProduct(p: ChemicalProduct) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    supplier: { id: p.supplierId, name: p.supplierName, kind: p.supplierKind },
    minPct: p.minPct,
    maxPct: p.maxPct,
    share: p.weight,
    sdsId: p.sdsId,
    url: `${APP_URL}/products/${p.id}`,
  };
}
```

In `app/api/v1/chemicals/[cas]/route.ts`:

```ts
import { apiError, withApiKey } from "@/lib/api";
import { serializeChemical } from "@/lib/api-serializers";
import { getChemicalProducts } from "@/lib/chemical-products";
import { getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/chemicals/[cas]">>(async (_request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  const products = await getChemicalProducts(chemical.id, null, 1);
  return Response.json({ data: serializeChemical(chemical, products) });
});
```

Run `rg -n "serializeChemical\(" app lib` and update any other caller the same way.

- [ ] **Step 6: Verify in the browser**

Open `http://localhost:3000/chemicals/11138-66-2`.
Expected:
- "Products containing this chemical" shows a total across all EPA products.
- Clicking "Food and drug" filters the list, and the URL gains `?category=Food%20and%20drug#products`.
- "Next →" moves to page 2.

Open `http://localhost:3000/chemicals/67-64-1` (acetone).
Expected: single-ingredient acetone products show "100%" at the top.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add lib/chemical-products.ts lib/chemicals.ts lib/api-serializers.ts app/chemicals app/api/v1/chemicals/[cas]/route.ts
git commit -m "Paginated, filterable product list on chemical pages"
```

---

### Task 10: API endpoints

**Files:**
- Create: `app/api/v1/chemicals/[cas]/products/route.ts`
- Create: `app/api/v1/products/[id]/alternates/route.ts`
- Modify: `lib/api-serializers.ts`, `lib/openapi.ts`

- [ ] **Step 1: Add `serializeAlternate` to `lib/api-serializers.ts`**

```ts
import type { Alternate } from "@/lib/alternates/query";
import { manufacturerSdsSearchUrl } from "@/lib/product-sources";
```

```ts
export function serializeAlternate(a: Alternate) {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    maker: { id: a.makerId, name: a.maker, kind: a.makerKind },
    score: Math.round(a.score * 1000) / 1000,
    sharedCas: a.shared.map((s) => s.casRn),
    sharedCount: a.sharedCount,
    addedCount: a.addedCount,
    sds: a.sdsId
      ? { id: a.sdsId, url: `${APP_URL}/sds/${a.sdsId}` }
      : { searchUrl: manufacturerSdsSearchUrl(a.name, a.maker, a.makerKind) },
    url: `${APP_URL}/products/${a.id}`,
  };
}
```

- [ ] **Step 2: Create `app/api/v1/chemicals/[cas]/products/route.ts`**

```ts
import { apiError, withApiKey } from "@/lib/api";
import { serializeChemicalProduct } from "@/lib/api-serializers";
import { getChemicalProducts, PRODUCTS_PAGE_SIZE, productTotal } from "@/lib/chemical-products";
import { getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/chemicals/[cas]/products">>(async (request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  const query = new URL(request.url).searchParams;
  const category = query.get("category") || null;
  const page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  const products = await getChemicalProducts(chemical.id, category, page);
  return Response.json({
    data: {
      casRn: chemical.casRn,
      category,
      page,
      pageSize: PRODUCTS_PAGE_SIZE,
      total: productTotal(chemical.productCategories, category),
      products: products.map(serializeChemicalProduct),
    },
  });
});
```

- [ ] **Step 3: Create `app/api/v1/products/[id]/alternates/route.ts`**

```ts
import { apiError, withApiKey } from "@/lib/api";
import { getProductAlternates } from "@/lib/alternates/query";
import { serializeAlternate } from "@/lib/api-serializers";
import { getProduct } from "@/lib/chemicals";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://chemspace.app";

export const GET = withApiKey<RouteContext<"/api/v1/products/[id]/alternates">>(async (_request, _api, { params }) => {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return apiError(404, "not_found", `No product with id ${id}.`);
  const result = await getProductAlternates(product.id);
  if (result.status === "unavailable") {
    return apiError(503, "unavailable", "Alternates are temporarily unavailable; retry shortly.");
  }
  const ok = result.status === "ok";
  return Response.json({
    data: {
      product: { id: product.id, name: product.name, maker: product.supplier.name, url: `${APP_URL}/products/${product.id}` },
      reason: ok ? null : "no_tsca_ingredients",
      close: ok ? result.close.map(serializeAlternate) : [],
      partial: ok ? result.partial.map(serializeAlternate) : [],
    },
  });
});
```

- [ ] **Step 4: Document both endpoints in `lib/openapi.ts`**

Inside `paths`, after `"/alternatives/{cas}"`, add:

```ts
      "/chemicals/{cas}/products": {
        get: {
          summary: "Products containing a chemical",
          description:
            "Every catalog product that lists this CAS number: highest reported share first (single-ingredient products count as 100%), then newest. 50 per page.",
          parameters: [
            casParam,
            { name: "category", in: "query", required: false, schema: { type: "string" }, description: 'General product category, e.g. "Personal care"' },
            { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1, default: 1 } },
          ],
          responses: { "200": { description: "Products" }, ...errors },
        },
      },
      "/products/{id}/alternates": {
        get: {
          summary: "Alternate products",
          description:
            "Other products sharing this product's ingredient CAS numbers, ranked by weighted composition similarity (0–1). Close matches score 0.5 or more. `reason` is `no_tsca_ingredients` when nothing can be matched.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Alternates" }, ...errors },
        },
      },
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors; `next typegen` generates `RouteContext` for both new routes.

Run: `curl -s http://localhost:3000/api/v1/products/<method lotion id>/alternates | head -c 300`
Expected: a 401 JSON error ("Provide an API key…"), confirming the route is wired behind API-key auth. With a workspace API key (`-H "Authorization: Bearer cs_..."`), the response holds `close` and `partial` arrays.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1 lib/api-serializers.ts lib/openapi.ts
git commit -m "Add product alternates and chemical products API endpoints"
```

---

### Task 11: Docs and final verification

**Files:**
- Modify: `README.md`, `app/data-sources/page.tsx`

- [ ] **Step 1: Update the README products bullet**

Replace the "Products (EPA ChemExpo/CPDat)" bullet with:

```markdown
- **Products (EPA ChemExpo/CPDat):** downloads EPA's public composition file weekly (about 1 GB unzipped, 400k documents). Repeat filings of the same product (same maker and name) are merged into the newest one, leaving roughly 300k products with full ingredient lists. These power the product lists on chemical pages and the alternates on product pages. EPA's server is slow; for the first load, download the zip yourself and run `pnpm load:chemexpo path/to/file.zip`, then `pnpm db:size` to check database size. The pesticide inert list (`PEST_INERT`) comes from ChemExpo's list-presence file; load it with `pnpm load:reglist PEST_INERT`.
```

Under the scripts or setup section, add one line: `pnpm test` runs unit tests; `pnpm check:alternates <productId>` checks the alternates SQL against the reference scorer.

- [ ] **Step 2: Update the ChemExpo entry on the data-sources page**

In `app/data-sources/page.tsx`, change the ChemExpo `use` text to:

```ts
    use: "Consumer and commercial product formulations: product names, manufacturers, product categories and reported ingredient weight fractions, plus EPA pesticide inert-ingredient lists. Chemspace keeps every product, merging repeat filings into the newest, and uses the compositions to suggest alternate products.",
```

- [ ] **Step 3: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && NEXT_DIST_DIR=.next-build pnpm build`
Expected: all pass.

In the browser, confirm three pages:
1. `/chemicals/11138-66-2`: category filter and pagination work.
2. The Method lotion product page: close matches appear.
3. A product with no TSCA-resolved ingredients (any row whose composition shows only "Proprietary"): the alternates card shows the "can't match" message.

- [ ] **Step 4: Commit**

```bash
git add README.md app/data-sources/page.tsx
git commit -m "Document full ChemExpo load and alternates"
```
