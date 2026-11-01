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
