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
