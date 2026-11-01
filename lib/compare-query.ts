import { count, eq, inArray } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { WATER_CAS } from "@/lib/alternates/score";
import { getProduct } from "@/lib/chemicals";
import { type CompareIngredient, compareProducts } from "@/lib/compare";
import type { RegulatoryListCode } from "@/lib/reglists-meta";

type Product = NonNullable<Awaited<ReturnType<typeof getProduct>>>;

const SIGNAL_RANK: Record<string, number> = { danger: 2, warning: 1 };

export async function getProductComparison(aId: string, bId: string) {
  "use cache";
  cacheLife("days");
  cacheTag(`product:${aId}`, `product:${bId}`, "alternates");
  const [a, b] = await Promise.all([getProduct(aId), getProduct(bId)]);
  if (!a || !b) return null;

  const chemicalIds = [
    ...new Set([...a.components, ...b.components].map((c) => c.chemicalId).filter((id): id is number => id !== null)),
  ];
  const [hazards, listings, freq, [{ total }], [water]] = await Promise.all([
    chemicalIds.length
      ? db
          .select({ chemicalId: schema.hazards.chemicalId, signalWord: schema.hazards.signalWord })
          .from(schema.hazards)
          .where(inArray(schema.hazards.chemicalId, chemicalIds))
      : [],
    chemicalIds.length
      ? db
          .select({ chemicalId: schema.regulatoryListings.chemicalId, listCode: schema.regulatoryListings.listCode })
          .from(schema.regulatoryListings)
          .where(inArray(schema.regulatoryListings.chemicalId, chemicalIds))
      : [],
    chemicalIds.length
      ? db.select().from(schema.chemicalDocFreq).where(inArray(schema.chemicalDocFreq.chemicalId, chemicalIds))
      : [],
    db.select({ total: count() }).from(schema.products),
    db.select({ id: schema.chemicals.id }).from(schema.chemicals).where(eq(schema.chemicals.casRn, WATER_CAS)),
  ]);

  const signalWords = new Map<number, string>();
  for (const h of hazards) {
    const current = signalWords.get(h.chemicalId);
    const rank = (word: string | null | undefined) => SIGNAL_RANK[word?.toLowerCase() ?? ""] ?? 0;
    if (h.signalWord && rank(h.signalWord) > rank(current)) signalWords.set(h.chemicalId, h.signalWord);
  }
  const lists = new Map<number, RegulatoryListCode[]>();
  for (const l of listings) lists.set(l.chemicalId, [...(lists.get(l.chemicalId) ?? []), l.listCode]);

  const ingredients = (p: Product): CompareIngredient[] =>
    p.components.map((c) => ({
      chemicalId: c.chemicalId,
      casRn: c.casRn,
      name: c.chemicalName ?? c.componentName ?? c.casRn ?? "Unnamed ingredient",
      minPct: c.minPct,
      maxPct: c.maxPct,
      weight: c.weight,
      hazardScore: c.hazardScore,
      signalWord: c.chemicalId === null ? null : (signalWords.get(c.chemicalId) ?? null),
      lists: c.chemicalId === null ? [] : (lists.get(c.chemicalId) ?? []),
    }));

  const comparison = compareProducts(ingredients(a), ingredients(b), {
    docFreq: new Map(freq.map((f) => [f.chemicalId, f.productCount])),
    totalProducts: total,
    waterId: water?.id ?? null,
  });
  return { a, b, ...comparison };
}
