import { ingredientWeights, weightedJaccard } from "@/lib/alternates/score";
import { hazardBand } from "@/lib/hazard";
import { REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";

export type CompareIngredient = {
  chemicalId: number | null;
  casRn: string | null;
  name: string;
  minPct: number | null;
  maxPct: number | null;
  weight: number | null;
  hazardScore: number | null;
  signalWord: string | null;
  lists: RegulatoryListCode[];
};

export type Share = { minPct: number | null; maxPct: number | null; weight: number | null };

export type CompareRow = {
  key: string;
  group: "shared" | "only_a" | "only_b";
  chemicalId: number | null;
  casRn: string | null;
  name: string;
  a: Share | null;
  b: Share | null;
  hazardScore: number | null;
  signalWord: string | null;
  lists: RegulatoryListCode[];
  isWater: boolean;
  onTsca: boolean;
};

export type ListChange = { count: number; lists: RegulatoryListCode[] };

export type CompareSummary = {
  score: number;
  shared: number;
  onlyA: number;
  onlyB: number;
  hazardRemoved: number;
  hazardAdded: number;
  listedRemoved: ListChange;
  listedAdded: ListChange;
  unassessed: number;
};

export type CompareContext = { docFreq: Map<number, number>; totalProducts: number; waterId: number | null };

const GROUP_ORDER = { shared: 0, only_a: 1, only_b: 2 } as const;

function keyOf(i: CompareIngredient) {
  if (i.chemicalId !== null) return `chem:${i.chemicalId}`;
  return i.casRn ? `cas:${i.casRn}` : `name:${i.name.trim().toLowerCase()}`;
}

function mergeShare(prev: Share | null, next: Share): Share {
  if (!prev) return next;
  const min = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.min(x, y));
  const max = (x: number | null, y: number | null) => (x === null ? y : y === null ? x : Math.max(x, y));
  return { minPct: min(prev.minPct, next.minPct), maxPct: max(prev.maxPct, next.maxPct), weight: max(prev.weight, next.weight) };
}

/** Lines up two products' ingredients and summarizes what switching from A to B changes. */
export function compareProducts(a: CompareIngredient[], b: CompareIngredient[], ctx: CompareContext) {
  const byKey = new Map<string, Omit<CompareRow, "group">>();
  const add = (side: "a" | "b", i: CompareIngredient) => {
    const key = keyOf(i);
    const share = { minPct: i.minPct, maxPct: i.maxPct, weight: i.weight };
    const row = byKey.get(key) ?? {
      key,
      chemicalId: i.chemicalId,
      casRn: i.casRn,
      name: i.name,
      a: null,
      b: null,
      hazardScore: i.hazardScore,
      signalWord: i.signalWord,
      lists: i.lists,
      isWater: i.chemicalId !== null && i.chemicalId === ctx.waterId,
      onTsca: i.chemicalId !== null,
    };
    row[side] = mergeShare(row[side], share);
    byKey.set(key, row);
  };
  for (const i of a) add("a", i);
  for (const i of b) add("b", i);

  const rows: CompareRow[] = [...byKey.values()]
    .map((r) => ({ ...r, group: r.a && r.b ? "shared" : r.a ? "only_a" : "only_b" }) as CompareRow)
    .map((r, index) => ({ r, index }))
    .sort((x, y) => {
      const group = GROUP_ORDER[x.r.group] - GROUP_ORDER[y.r.group];
      if (group !== 0) return group;
      const wx = Math.max(x.r.a?.weight ?? -1, x.r.b?.weight ?? -1);
      const wy = Math.max(y.r.a?.weight ?? -1, y.r.b?.weight ?? -1);
      return wy - wx || x.index - y.index;
    })
    .map(({ r }) => r);

  const counted = rows.filter((r) => r.onTsca && !r.isWater);
  const hazardous = (r: CompareRow) => ["moderate", "high"].includes(hazardBand(r.hazardScore));
  const listChange = (group: CompareRow["group"]): ListChange => {
    const listed = counted
      .filter((r) => r.group === group)
      .map((r) => r.lists.filter((l) => REGULATORY_LISTS[l].kind === "hazard"))
      .filter((lists) => lists.length > 0);
    return { count: listed.length, lists: [...new Set(listed.flat())].sort() };
  };

  const toIngredients = (list: CompareIngredient[]) =>
    list.filter((i) => i.chemicalId !== null).map((i) => ({ chemicalId: i.chemicalId!, weight: i.weight }));
  const weigh = (list: CompareIngredient[]) =>
    ingredientWeights(toIngredients(list), ctx.docFreq, ctx.totalProducts, ctx.waterId);

  const summary: CompareSummary = {
    score: weightedJaccard(weigh(a), weigh(b)),
    shared: counted.filter((r) => r.group === "shared").length,
    onlyA: counted.filter((r) => r.group === "only_a").length,
    onlyB: counted.filter((r) => r.group === "only_b").length,
    hazardRemoved: counted.filter((r) => r.group === "only_a" && hazardous(r)).length,
    hazardAdded: counted.filter((r) => r.group === "only_b" && hazardous(r)).length,
    listedRemoved: listChange("only_a"),
    listedAdded: listChange("only_b"),
    unassessed: counted.filter((r) => r.hazardScore === null).length,
  };
  return { rows, summary };
}
