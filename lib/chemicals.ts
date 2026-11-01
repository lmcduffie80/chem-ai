import { and, asc, desc, eq, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { db, schema } from "@/db";
import { normalizeCas } from "@/lib/cas";

export async function getChemicalByCas(casInput: string) {
  "use cache";
  cacheLife("days");
  const cas = normalizeCas(casInput);
  if (!cas) return null;
  cacheTag(`chemical:${cas}`, "chemicals");

  const [chemical] = await db.select().from(schema.chemicals).where(eq(schema.chemicals.casRn, cas));
  if (!chemical) return null;
  const { embedding: _embedding, searchVector: _searchVector, ...rest } = chemical;

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
  };
}

export type ChemicalDetail = NonNullable<Awaited<ReturnType<typeof getChemicalByCas>>>;

export async function getAlternatives(chemicalId: number) {
  "use cache";
  cacheLife("hours");
  cacheTag(`alternatives:${chemicalId}`);
  return db
    .select({
      id: schema.alternatives.id,
      score: schema.alternatives.score,
      hazardDelta: schema.alternatives.hazardDelta,
      rationale: schema.alternatives.rationale,
      functionClass: schema.alternatives.functionClass,
      method: schema.alternatives.method,
      status: schema.alternatives.status,
      casRn: schema.chemicals.casRn,
      preferredName: schema.chemicals.preferredName,
      hazardScore: schema.chemicals.hazardScore,
      saferChoiceStatus: schema.chemicals.saferChoiceStatus,
    })
    .from(schema.alternatives)
    .innerJoin(schema.chemicals, eq(schema.chemicals.id, schema.alternatives.altChemicalId))
    .where(and(eq(schema.alternatives.chemicalId, chemicalId), ne(schema.alternatives.status, "rejected")))
    .orderBy(desc(schema.alternatives.score))
    .limit(12);
}

export async function getSupplier(id: string) {
  "use cache";
  cacheLife("days");
  cacheTag(`supplier:${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [supplier] = await db.select().from(schema.suppliers).where(eq(schema.suppliers.id, id));
  if (!supplier) return null;
  const products = await db
    .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku, grade: schema.products.grade })
    .from(schema.products)
    .where(eq(schema.products.supplierId, id))
    .orderBy(asc(schema.products.name))
    .limit(500);
  return { ...supplier, products };
}

export async function getProduct(id: string) {
  "use cache";
  cacheLife("days");
  cacheTag(`product:${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ product: schema.products, supplier: schema.suppliers })
    .from(schema.products)
    .innerJoin(schema.suppliers, eq(schema.suppliers.id, schema.products.supplierId))
    .where(eq(schema.products.id, id));
  if (!row) return null;
  const [components, sdsDocuments] = await Promise.all([
    db
      .select({
        chemicalId: schema.productComponents.chemicalId,
        componentName: schema.productComponents.componentName,
        casRn: schema.productComponents.casRn,
        minPct: schema.productComponents.minPct,
        maxPct: schema.productComponents.maxPct,
        weight: schema.productComponents.weight,
        chemicalName: schema.chemicals.preferredName,
        hazardScore: schema.chemicals.hazardScore,
      })
      .from(schema.productComponents)
      .leftJoin(schema.chemicals, eq(schema.chemicals.id, schema.productComponents.chemicalId))
      .where(eq(schema.productComponents.productId, id)),
    db
      .select({
        id: schema.sdsDocuments.id,
        revisionDate: schema.sdsDocuments.revisionDate,
        language: schema.sdsDocuments.language,
        region: schema.sdsDocuments.region,
      })
      .from(schema.sdsDocuments)
      .where(eq(schema.sdsDocuments.productId, id))
      .orderBy(desc(schema.sdsDocuments.revisionDate)),
  ]);
  return { ...row.product, supplier: row.supplier, components, sdsDocuments };
}

/** SDS metadata is public; full sections are only rendered after quota checks. */
export async function getSdsDocument(id: string) {
  "use cache";
  cacheLife("hours");
  cacheTag(`sds:${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({
      sds: schema.sdsDocuments,
      productName: schema.products.name,
      supplierId: schema.suppliers.id,
      supplierName: schema.suppliers.name,
    })
    .from(schema.sdsDocuments)
    .leftJoin(schema.products, eq(schema.products.id, schema.sdsDocuments.productId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.products.supplierId))
    .where(eq(schema.sdsDocuments.id, id));
  if (!row) return null;
  return { ...row.sds, productName: row.productName, supplierId: row.supplierId, supplierName: row.supplierName };
}
