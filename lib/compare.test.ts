import { describe, expect, it } from "vitest";
import { ingredientWeights, weightedJaccard } from "./alternates/score";
import { type CompareIngredient, compareProducts } from "./compare";

const WATER = 99;
const ctx = {
  docFreq: new Map([
    [1, 10],
    [2, 100],
    [3, 1000],
    [4, 50],
    [WATER, 5000],
  ]),
  totalProducts: 10_000,
  waterId: WATER,
};

function ing(chemicalId: number | null, extra: Partial<CompareIngredient> = {}): CompareIngredient {
  return {
    chemicalId,
    casRn: chemicalId === null ? null : `${chemicalId}-00-0`,
    name: chemicalId === null ? "Fragrance" : `Chem ${chemicalId}`,
    minPct: null,
    maxPct: null,
    weight: null,
    hazardScore: null,
    signalWord: null,
    lists: [],
    ...extra,
  };
}

describe("compareProducts", () => {
  it("groups ingredients into shared, only in A and only in B", () => {
    const { rows, summary } = compareProducts([ing(1), ing(2)], [ing(2), ing(3)], ctx);
    expect(rows.map((r) => [r.chemicalId, r.group])).toEqual([
      [2, "shared"],
      [1, "only_a"],
      [3, "only_b"],
    ]);
    expect(summary).toMatchObject({ shared: 1, onlyA: 1, onlyB: 1 });
  });

  it("keeps both products' shares on shared rows", () => {
    const { rows } = compareProducts(
      [ing(1, { minPct: 10, maxPct: 20, weight: 0.15 })],
      [ing(1, { minPct: 1, maxPct: 5, weight: 0.03 })],
      ctx,
    );
    expect(rows[0].a).toEqual({ minPct: 10, maxPct: 20, weight: 0.15 });
    expect(rows[0].b).toEqual({ minPct: 1, maxPct: 5, weight: 0.03 });
  });

  it("merges duplicate rows for one chemical within a product", () => {
    const { rows } = compareProducts(
      [ing(1, { minPct: 5, maxPct: 10, weight: 0.075 }), ing(1, { minPct: 1, maxPct: 30, weight: 0.155 })],
      [],
      ctx,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].a).toEqual({ minPct: 1, maxPct: 30, weight: 0.155 });
  });

  it("scores exactly like the alternates scorer", () => {
    const a = [ing(1, { weight: 0.5 }), ing(2, { weight: 0.3 }), ing(WATER, { weight: 0.2 })];
    const b = [ing(1, { weight: 0.2 }), ing(3), ing(4)];
    const toIngredients = (list: CompareIngredient[]) =>
      list.map((i) => ({ chemicalId: i.chemicalId!, weight: i.weight }));
    const expected = weightedJaccard(
      ingredientWeights(toIngredients(a), ctx.docFreq, ctx.totalProducts, WATER),
      ingredientWeights(toIngredients(b), ctx.docFreq, ctx.totalProducts, WATER),
    );
    expect(compareProducts(a, b, ctx).summary.score).toBeCloseTo(expected, 10);
  });

  it("shows water but leaves it out of counts", () => {
    const { rows, summary } = compareProducts([ing(WATER), ing(1)], [ing(WATER)], ctx);
    expect(rows.find((r) => r.chemicalId === WATER)).toMatchObject({ group: "shared", isWater: true });
    expect(summary).toMatchObject({ shared: 0, onlyA: 1, onlyB: 0 });
  });

  it("lists ingredients not on TSCA without counting or scoring them", () => {
    const { rows, summary } = compareProducts([ing(null), ing(1)], [ing(null), ing(1)], ctx);
    const fragrance = rows.find((r) => r.chemicalId === null);
    expect(fragrance).toMatchObject({ group: "shared", onTsca: false });
    expect(summary).toMatchObject({ shared: 1, onlyA: 0, onlyB: 0, score: 1 });
  });

  it("matches unmatched ingredients by CAS, then by name", () => {
    const { rows } = compareProducts(
      [ing(null, { casRn: "123-45-6", name: "X" }), ing(null, { casRn: null, name: "Parfum" })],
      [ing(null, { casRn: "123-45-6", name: "Y" }), ing(null, { casRn: null, name: "parfum" })],
      ctx,
    );
    expect(rows.map((r) => r.group)).toEqual(["shared", "shared"]);
  });

  it("counts hazardous ingredients B removes and adds", () => {
    const { summary } = compareProducts(
      [ing(1, { hazardScore: 45 }), ing(2, { hazardScore: 20 }), ing(4, { hazardScore: 5 })],
      [ing(4, { hazardScore: 5 }), ing(3, { hazardScore: 16 })],
      ctx,
    );
    expect(summary.hazardRemoved).toBe(2);
    expect(summary.hazardAdded).toBe(1);
  });

  it("counts listed ingredients and their lists, ignoring the pesticide inert list", () => {
    const { summary } = compareProducts(
      [ing(1, { lists: ["PROP65", "SARA313"] }), ing(2, { lists: ["PEST_INERT"] })],
      [ing(3, { lists: ["HAP"] })],
      ctx,
    );
    expect(summary.listedRemoved).toEqual({ count: 1, lists: ["PROP65", "SARA313"] });
    expect(summary.listedAdded).toEqual({ count: 1, lists: ["HAP"] });
  });

  it("counts matched ingredients with no hazard assessment", () => {
    const { summary } = compareProducts(
      [ing(1), ing(2, { hazardScore: 3 }), ing(WATER), ing(null)],
      [ing(1), ing(3)],
      ctx,
    );
    expect(summary.unassessed).toBe(2);
  });

  it("handles a product with no ingredients", () => {
    const { rows, summary } = compareProducts([], [ing(1)], ctx);
    expect(rows).toHaveLength(1);
    expect(summary.score).toBe(0);
  });
});
