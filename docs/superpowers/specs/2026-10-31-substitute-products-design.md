# Substitute products for chemical purchasing

## Goal

Help buyers answer "what else can I buy instead of this?" from either starting point:

- **A raw material (CAS number):** every product that contains it, purest forms first.
- **A finished product:** other products that contain the same CAS numbers, closest formulation first.

Any product sharing a CAS number counts as an alternate, regardless of product type. Ranking is by composition closeness (best drop-in first). Every alternate shows its SDS status: a Chemspace copy, or a link to find the manufacturer's SDS.

Out of scope: price comparison (no pricing data), inventory-wide alternate flags, AI ranking.

## Data: load all EPA ChemExpo products

Today `lib/ingest/chemexpo.ts` keeps the 25 most recent products per chemical (66k products). This change loads all of them.

### Deduplication

ChemExpo holds about 407k documents, but the same product often appears in several documents: SDS revisions, and the same product reported by multiple sources. Without deduplication the alternates list would repeat a product many times.

- **Product identity:** the normalized maker plus the normalized product name, both lowercased with whitespace and punctuation collapsed.
- When several documents share an identity, keep the one with the newest document date (ties go to the highest document ID). Its document ID becomes `products.external_id`, and its components are the product's components.
- **Maker:** the supplier derived from the data source, as today. Retailer and database sources (Walmart, EWG, SIRI, …) stay as they are: the product name usually includes the brand, and we don't try to infer the real manufacturer.

Expected size after deduplication: roughly 250–350k products and 2.5–3M component rows, adding about 0.6 GB for roughly 0.8 GB total. This fits Neon's Free plan (1 GB per project) with little headroom. Check the database size after the first full load, and move to Neon Launch (usage-based, about $15/month) before real customer traffic or if the size passes 0.9 GB.

### Loader changes

- Replace the sampling pass (`planChemExpoSample`) with a deduplication pass that streams the CSV once, picks the winning document per product identity, and writes the selected document IDs to Blob. Memory stays bounded: each map entry is one identity key → (docId, date).
- `extractChemExpoProducts` runs once per partition (`doc % 4`), so a single pass never holds more than about a quarter of the products in memory. It resolves CAS numbers to chemical IDs while extracting and writes compact chunks of 3000 products. `upsertChemExpoChunk` keeps its shape.
- A new final step, `summarizeChemExpo`, rebuilds `chemical_product_categories` from the loaded (deduplicated) products in SQL, so the counts on the chemical page match the products we actually hold. It also rebuilds `chemical_doc_freq` and invalidates caches.
- Single-ingredient products with no reported percentage get `weight = 1`.
- Make `product_components.component_name` nullable and leave it null for components that resolved to a TSCA chemical (`chemical_id` set); pages display the chemical's preferred name instead. This saves about a quarter of the component table size. Unresolved components keep their raw name and CAS. Existing readers of `componentName` fall back to the joined chemical name.
- Prune works as today: anything not touched by this run is deleted.

### New column

- `product_components.weight` (real, nullable): the midpoint of the reported percentage range divided by 100, or null when no percentage is reported. Computed at load time so matching doesn't recompute it.

### New table: `chemical_doc_freq`

| column | type | meaning |
|---|---|---|
| `chemical_id` | integer PK → chemicals | |
| `product_count` | integer | number of products containing it |

Rebuilt at the end of each load (`INSERT … SELECT chemical_id, count(distinct product_id) … GROUP BY`). Used to down-weight ubiquitous ingredients.

### Indexes

- Existing `product_components (chemical_id)`; extend it to `(chemical_id, product_id)` so candidate lookups are index-only.
- Existing `product_components (product_id)`.

## Matching

### Weights

Each product is a set of TSCA chemicals (`chemical_id` not null). The weight of chemical *c* in product *p* is:

```
w(p, c) = share(p, c) × idf(c)
share(p, c) = weight(p, c) if reported, otherwise 1 / (number of ingredients in p)
idf(c)      = ln(N / product_count(c))      N = total products
```

Water (7732-18-5) is excluded. IDF weighting keeps common carriers (glycerin, sodium chloride) from dominating, without hard-coding a list.

### Score

Weighted Jaccard similarity:

```
score(a, b) = Σ_c min(w(a,c), w(b,c)) / Σ_c max(w(a,c), w(b,c))
```

The score runs from 0 to 1 and is shown as a percentage.

### Candidate generation (finished product)

Scoring every product that shares any ingredient is too much work for common ingredients. Instead:

1. Take the source product's ingredients, ordered by `idf` descending, and use the three rarest.
2. Candidates are products containing any of those three, capped at 2,000 (most recent first).
3. Score the candidates in SQL, return the top 50, and split them into:
   - **Close matches:** score ≥ 0.5
   - **Partial matches:** score < 0.5

One SQL query (CTEs), no application-side loops. If the source product has no resolved ingredients, return an empty result with the reason.

### Raw material (CAS)

Every product containing the CAS, ordered by:

1. `weight` descending (the purest forms first; single-ingredient products count as 1.0);
2. then document date descending.

The list is paginated (50 per page) and filterable by product category (the existing category badges become filters).

## UI

### Product page: new "Alternates" section

- Close matches and partial matches as two groups.
- Each row shows:
  - match % (hover text explains: "Shares N of M ingredients; weighted by reported amounts and how common each ingredient is");
  - product name and type;
  - maker, with role label;
  - shared ingredients as chips, plus "+K other" for ingredients the alternate adds that the original lacks;
  - SDS: a Chemspace copy, or "Find SDS ↗".
- Footer: "Based on formulations reported to EPA. Confirm against the manufacturer's current SDS before switching."
- Wrapped in Suspense with a skeleton; the query result is cached with `"use cache"`, `cacheTag("alternates:{productId}")` and `cacheLife("days")`. The weekly load invalidates the `alternates` tag.

### Chemical page: the products card becomes "Products containing this chemical"

- The category badges become filter links (`?category=`).
- Each row adds a "Share" column showing the reported percentage, ordered as in the raw-material section above.
- Pagination replaces the fixed 100-row limit.
- Each product name links to its product page, where its alternates appear.

## API

- `GET /api/v1/products/{id}/alternates` returns `{ product, close: Alternate[], partial: Alternate[] }`.
- `GET /api/v1/chemicals/{cas}/products?category=&page=` returns a paginated product list with share and SDS status.
- Both use the existing API-key auth, usage metering and plan entitlements, and are added to `openapi.json`.

`Alternate` = `{ id, name, category, maker: { id, name, kind }, score, sharedCas[], sharedCount, addedCount, sds: { id, url } | { searchUrl }, url }`.

## Error handling

- A product with no resolved ingredients gets the message "We can't match this product because none of its ingredients are on the TSCA inventory."
- If the full load fails partway, prune does not run (as today), so earlier data stays intact.
- If a query times out, the alternates section shows "Alternates are temporarily unavailable" and caches the result for minutes, not days.

## Testing

The project has no test runner yet; add Vitest (`pnpm test`) for the pure functions below. Keep scoring (`lib/alternates/score.ts`) and product identity normalization (`lib/ingest/product-identity.ts`) in dependency-free modules so they can be tested without a database. The SQL query implements the same formula, and one integration check compares the two on a real product.

- Unit tests for the scoring function: identical products score 1, disjoint products score 0, missing percentages fall back to equal shares, and water is ignored.
- Unit tests for deduplication: same name and maker with different dates keeps the newest; differing punctuation or case collapses.
- A local full load against the downloaded zip, recording product, component and database size.
- Browser check of a known product (e.g. a Method body lotion): alternates include other Method lotions as close matches.
- Query-time check: a product whose ingredients are all common (glycerin, xanthan gum) returns in under 500 ms warm and 2 s cold.
