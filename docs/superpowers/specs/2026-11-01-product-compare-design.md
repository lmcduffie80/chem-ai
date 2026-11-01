# Product comparison — design

## Goal

Let a purchaser compare a product with one alternate side by side: what ingredients they share, what each adds or removes, and whether the switch removes or adds hazardous or regulated ingredients.

## Decisions

- Two products per comparison: the current product (A) and one alternate (B).
- Public page at `/products/{id}/compare/{otherId}`, opened from a "Compare" link on each Alternates row. No API endpoint yet.
- Shows ingredient differences with reported shares, hazard band/score and GHS signal word, regulatory list badges, a summary strip, and SDS links and maker details for both products.

## Page

1. **Header:** two columns, one per product: maker (with role label), product name linked to its page, category, document date, and the newest SDS link or "Find SDS ↗".
2. **Summary strip:**
   - Match score (same IDF-weighted Jaccard as the Alternates card, computed by `lib/alternates/score.ts`).
   - Ingredient counts: shared, only in A, only in B.
   - Hazard change: hazardous ingredients (hazard band moderate or high, from `hazardBand`) that B removes (only in A) and adds (only in B).
   - Regulatory change: listed ingredients B removes and adds, with the list codes involved. `PEST_INERT` is shown as a badge but not counted, since it isn't a hazard list.
   - "N ingredients have no hazard assessment yet" when any matched ingredient has no hazard score; unknown is never treated as safe.
3. **Ingredient table**, grouped Shared → Only in A → Only in B. Columns: ingredient (linked to its chemical page), CAS, share in A, share in B, hazard (badge + signal word), lists (badges).
   - Water is listed in its group but muted, with a note that it's excluded from the score.
   - Ingredients not on the TSCA inventory (no chemical match) are listed in their group, labeled "Not on TSCA", and excluded from all counts and the score.
4. Disclaimer: "Based on formulations reported to EPA. Confirm against each manufacturer's current SDS."

## Data and code

- `lib/compare.ts` — pure, unit-tested:
  - `compareProducts(a, b, ctx)` takes each product's ingredients (`chemicalId | null`, `casRn`, `name`, `minPct`, `maxPct`, `weight`, `hazardScore`, `signalWord`, `lists`) and `ctx = { docFreq, totalProducts, waterId }`.
  - Duplicate rows for the same chemical in one product merge (min of `minPct`, max of `maxPct` and `weight`).
  - Matched ingredients are keyed by `chemicalId`; unmatched by CAS, else lowercased name.
  - Returns `{ rows, summary }`; `summary.score` equals `weightedJaccard(ingredientWeights(a), ingredientWeights(b))`.
- `lib/chemicals.ts` `getProduct` also selects `chemicalId` and `weight` for components.
- `lib/compare-query.ts` — `getProductComparison(aId, bId)`, `"use cache"`, `cacheLife("days")`, tags `product:{a}`, `product:{b}`, `alternates`. Loads both products via `getProduct`, then in parallel: signal words (strongest across sources: Danger > Warning), non-pesticide and pesticide list codes, `chemical_doc_freq` rows, the product count, and water's chemical ID. Returns `null` if either product is missing.
- `app/products/[id]/compare/[otherId]/page.tsx` — thin server component inside Suspense; `notFound()` if the comparison is null; `redirect` to `/products/{id}` when both IDs are equal. Metadata title "A vs B".
- `app/products/[id]/alternates-section.tsx` — add a "Compare" link to each row.

## Errors

- Missing or malformed product ID → 404.
- Same ID twice → redirect to the product page.
- A product with no ingredient rows → page renders; the table shows its ingredients as absent and the summary score is 0.

## Testing

- Vitest for `compareProducts`: grouping, duplicate merge, water and unmatched handling, hazard/list counts (including `PEST_INERT` exclusion and unknown hazards), score equality with `weightedJaccard`.
- `pnpm test && pnpm typecheck && pnpm lint && build`.
- Browser: Method body lotion daily zen vs Jouve Nourishing Night Cream (score shows 38%, matching the Alternates card); same-ID redirect; bad ID 404.
