import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { parseSdsPdf } from "@/lib/ai/sds-parse";
import { isValidCasChecksum, normalizeCas } from "@/lib/cas";
import { getSdsProvider } from "@/lib/sds";
import type { ProviderProduct } from "@/lib/sds/provider";
import { chemicalTag, invalidateTags } from "./invalidate";
import { type IssueInput, lastSuccessfulRun, recordIssues } from "./runs";

const SDS_MAX_AGE_YEARS = 5;

export async function listSdsUpdates(cursor: string | undefined) {
  "use step";
  const provider = getSdsProvider();
  if (!provider) return { productIds: [] };
  const since = await lastSuccessfulRun("sds_feed");
  return provider.listUpdates(since, cursor);
}

async function upsertProduct(source: string, p: ProviderProduct, issues: IssueInput[]) {
  const [supplier] = await db
    .insert(schema.suppliers)
    .values({
      source,
      externalId: p.supplier.externalId,
      name: p.supplier.name,
      country: p.supplier.country,
      website: p.supplier.website,
      contacts: p.supplier.contacts ?? [],
      certifications: p.supplier.certifications ?? [],
    })
    .onConflictDoUpdate({
      target: [schema.suppliers.source, schema.suppliers.externalId],
      set: {
        name: sql`excluded.name`,
        country: sql`excluded.country`,
        website: sql`excluded.website`,
        contacts: sql`excluded.contacts`,
        certifications: sql`excluded.certifications`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.suppliers.id });

  const [product] = await db
    .insert(schema.products)
    .values({
      supplierId: supplier.id,
      source,
      externalId: p.externalId,
      name: p.name,
      sku: p.sku,
      grade: p.grade,
      purity: p.purity,
      description: p.description,
    })
    .onConflictDoUpdate({
      target: [schema.products.source, schema.products.externalId],
      set: {
        supplierId: supplier.id,
        name: sql`excluded.name`,
        sku: sql`excluded.sku`,
        grade: sql`excluded.grade`,
        purity: sql`excluded.purity`,
        description: sql`excluded.description`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.products.id });

  const components = p.components.map((c) => ({ ...c, cas: normalizeCas(c.casRn) }));
  const casList = components.flatMap((c) => (c.cas ? [c.cas] : []));
  const known = casList.length
    ? await db
        .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
        .from(schema.chemicals)
        .where(inArray(schema.chemicals.casRn, casList))
    : [];
  const idByCas = new Map(known.map((k) => [k.casRn, k.id]));

  await db.delete(schema.productComponents).where(eq(schema.productComponents.productId, product.id));
  if (components.length) {
    await db.insert(schema.productComponents).values(
      components.map((c) => ({
        productId: product.id,
        chemicalId: c.cas ? (idByCas.get(c.cas) ?? null) : null,
        casRn: c.cas,
        componentName: c.name,
        minPct: c.minPct,
        maxPct: c.maxPct,
      })),
    );
  }
  for (const c of components) {
    if (c.casRn && (!c.cas || !isValidCasChecksum(c.cas))) {
      issues.push({ entityType: "product", entityId: product.id, issue: "invalid_component_cas", details: c.casRn });
    } else if (c.cas && !idByCas.has(c.cas)) {
      issues.push({
        entityType: "product",
        entityId: product.id,
        issue: "component_not_in_inventory",
        details: c.cas,
        severity: "info",
      });
    }
  }

  return product.id;
}

/** Upserts suppliers, products, components and SDS metadata. Returns SDS ids whose PDF must be (re)fetched. */
export async function syncProducts(
  productExternalIds: string[],
): Promise<{ stats: IngestStats; sdsToFetch: { id: string; providerHash: string | null }[] }> {
  "use step";
  const provider = getSdsProvider();
  if (!provider) return { stats: { skipped: productExternalIds.length }, sdsToFetch: [] };
  const issues: IssueInput[] = [];
  const sdsToFetch: { id: string; providerHash: string | null }[] = [];
  const touchedCas: string[] = [];
  let synced = 0;
  let missing = 0;

  for (const externalId of productExternalIds) {
    const p = await provider.fetchProduct(externalId);
    if (!p) {
      missing++;
      continue;
    }
    const productId = await upsertProduct(provider.id, p, issues);
    for (const c of p.components) {
      const cas = normalizeCas(c.casRn);
      if (cas) touchedCas.push(cas);
    }

    for (const doc of p.sdsDocuments) {
      const [existing] = await db
        .select({ contentHash: schema.sdsDocuments.contentHash, blobPathname: schema.sdsDocuments.blobPathname })
        .from(schema.sdsDocuments)
        .where(sql`${schema.sdsDocuments.source} = ${provider.id} and ${schema.sdsDocuments.externalId} = ${doc.externalId}`);

      const [row] = await db
        .insert(schema.sdsDocuments)
        .values({
          productId,
          source: provider.id,
          externalId: doc.externalId,
          revisionDate: doc.revisionDate,
          language: doc.language ?? "en",
          region: doc.region ?? "US",
        })
        .onConflictDoUpdate({
          target: [schema.sdsDocuments.source, schema.sdsDocuments.externalId],
          set: {
            productId,
            revisionDate: sql`excluded.revision_date`,
            language: sql`excluded.language`,
            region: sql`excluded.region`,
            updatedAt: new Date(),
          },
        })
        .returning({ id: schema.sdsDocuments.id });

      const changed = !existing || !existing.blobPathname || (doc.contentHash && doc.contentHash !== existing.contentHash);
      if (changed) sdsToFetch.push({ id: row.id, providerHash: doc.contentHash ?? null });

      if (doc.revisionDate) {
        const ageYears = (Date.now() - new Date(doc.revisionDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (ageYears > SDS_MAX_AGE_YEARS) {
          issues.push({
            entityType: "sds_document",
            entityId: row.id,
            issue: "sds_outdated",
            details: `Revision ${doc.revisionDate} is older than ${SDS_MAX_AGE_YEARS} years`,
          });
        }
      }
    }
    synced++;
  }

  await recordIssues(issues);
  invalidateTags(touchedCas.map(chemicalTag));
  return { stats: { processed: productExternalIds.length, updated: synced, skipped: missing }, sdsToFetch };
}

/** Downloads the PDF into private Blob storage and extracts the 16 SDS sections with AI. */
/** `providerHash` is stored when present so change detection compares like with like on the next sync. */
export async function fetchAndParseSds(sdsDocumentId: string, providerHash: string | null = null): Promise<IngestStats> {
  "use step";
  const provider = getSdsProvider();
  if (!provider) return { skipped: 1 };
  const [doc] = await db.select().from(schema.sdsDocuments).where(eq(schema.sdsDocuments.id, sdsDocumentId));
  if (!doc) return { skipped: 1 };

  const pdf = await provider.fetchSdsPdf(doc.externalId);
  if (!pdf) {
    await recordIssues([{ entityType: "sds_document", entityId: doc.id, issue: "sds_pdf_missing" }]);
    return { skipped: 1 };
  }

  const contentHash = providerHash ?? createHash("sha256").update(pdf).digest("hex");
  const blob = await put(`sds/${doc.source}/${doc.externalId}.pdf`, Buffer.from(pdf), {
    access: "private",
    contentType: "application/pdf",
    allowOverwrite: true,
  });

  await db
    .update(schema.sdsDocuments)
    .set({ blobPathname: blob.pathname, contentHash })
    .where(eq(schema.sdsDocuments.id, doc.id));

  const stats = await parseStoredSds(doc.id, pdf);
  invalidateTags([`sds:${doc.id}`]);
  return stats;
}

export async function parseStoredSds(sdsDocumentId: string, pdf: Uint8Array): Promise<IngestStats> {
  try {
    const parsed = await parseSdsPdf(pdf);
    const [current] = await db
      .select({ revisionDate: schema.sdsDocuments.revisionDate })
      .from(schema.sdsDocuments)
      .where(eq(schema.sdsDocuments.id, sdsDocumentId));
    const revisionDate = /^\d{4}-\d{2}-\d{2}$/.test(parsed.revisionDate ?? "") ? parsed.revisionDate : null;
    await db
      .update(schema.sdsDocuments)
      .set({
        sections: parsed.sections,
        summary: parsed.summary,
        revisionDate: current?.revisionDate ?? revisionDate,
        parsedAt: new Date(),
        parseError: null,
      })
      .where(eq(schema.sdsDocuments.id, sdsDocumentId));
    return { updated: 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.sdsDocuments)
      .set({ parseError: message.slice(0, 2000) })
      .where(eq(schema.sdsDocuments.id, sdsDocumentId));
    await recordIssues([
      { entityType: "sds_document", entityId: sdsDocumentId, issue: "sds_parse_failed", details: message.slice(0, 500) },
    ]);
    return { failed: 1 };
  }
}
