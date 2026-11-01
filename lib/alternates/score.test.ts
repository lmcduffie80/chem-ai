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
