import "server-only";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { type Viewer, getViewer, ownerFilter } from "@/lib/auth";
import { can } from "@/lib/entitlements";

export type WorkspaceAccess = Viewer & { userId: string; workspaceEnabled: boolean; canEdit: boolean };

/** Every workspace page needs a signed-in user; org features additionally need a Team+ organization. */
export async function requireWorkspaceViewer(path: string): Promise<WorkspaceAccess> {
  const viewer = await getViewer();
  if (!viewer.userId) redirect(`/sign-in?redirect_url=${encodeURIComponent(path)}`);
  const workspaceEnabled = Boolean(viewer.orgId) && can(viewer.orgPlan, "workspace");
  return {
    ...viewer,
    userId: viewer.userId,
    workspaceEnabled,
    canEdit: viewer.orgRole === "admin" || viewer.orgRole === "editor",
  };
}

export async function getInventory(orgId: string) {
  return db
    .select({
      item: schema.workspaceInventory,
      casRn: schema.chemicals.casRn,
      chemicalName: schema.chemicals.preferredName,
      hazardScore: schema.chemicals.hazardScore,
      productName: schema.products.name,
      sdsTitle: sql<string | null>`coalesce(${schema.sdsDocuments.title}, ${schema.products.name})`,
      listCodes: sql<string[]>`coalesce((select array_agg(rl.list_code::text order by rl.list_code) from regulatory_listings rl where rl.chemical_id = ${schema.workspaceInventory.chemicalId}), '{}')`,
    })
    .from(schema.workspaceInventory)
    .leftJoin(schema.chemicals, eq(schema.chemicals.id, schema.workspaceInventory.chemicalId))
    .leftJoin(schema.products, eq(schema.products.id, schema.workspaceInventory.productId))
    .leftJoin(schema.sdsDocuments, eq(schema.sdsDocuments.id, schema.workspaceInventory.sdsDocumentId))
    .where(eq(schema.workspaceInventory.orgId, orgId))
    .orderBy(schema.workspaceInventory.label);
}

/** The org's own uploads plus licensed SDS for products in its inventory. */
export async function getSdsLibrary(orgId: string) {
  const inventoryProducts = db
    .select({ id: schema.workspaceInventory.productId })
    .from(schema.workspaceInventory)
    .where(and(eq(schema.workspaceInventory.orgId, orgId), isNotNull(schema.workspaceInventory.productId)));

  return db
    .select({
      id: schema.sdsDocuments.id,
      title: sql<string>`coalesce(${schema.sdsDocuments.title}, ${schema.products.name}, 'Untitled SDS')`,
      supplierName: schema.suppliers.name,
      revisionDate: schema.sdsDocuments.revisionDate,
      language: schema.sdsDocuments.language,
      orgId: schema.sdsDocuments.orgId,
      parsedAt: schema.sdsDocuments.parsedAt,
      parseError: schema.sdsDocuments.parseError,
      createdAt: schema.sdsDocuments.createdAt,
    })
    .from(schema.sdsDocuments)
    .leftJoin(schema.products, eq(schema.products.id, schema.sdsDocuments.productId))
    .leftJoin(schema.suppliers, eq(schema.suppliers.id, schema.products.supplierId))
    .where(or(eq(schema.sdsDocuments.orgId, orgId), inArray(schema.sdsDocuments.productId, inventoryProducts)))
    .orderBy(desc(schema.sdsDocuments.createdAt));
}

export async function getWatchlist(viewer: Viewer) {
  if (!viewer.userId) return [];
  return db
    .select({
      id: schema.watchlists.id,
      ownerType: schema.watchlists.ownerType,
      chemicalId: schema.chemicals.id,
      casRn: schema.chemicals.casRn,
      name: schema.chemicals.preferredName,
      hazardScore: schema.chemicals.hazardScore,
      createdAt: schema.watchlists.createdAt,
      listCodes: sql<string[]>`coalesce((select array_agg(rl.list_code::text order by rl.list_code) from regulatory_listings rl where rl.chemical_id = ${schema.chemicals.id}), '{}')`,
    })
    .from(schema.watchlists)
    .innerJoin(schema.chemicals, eq(schema.chemicals.id, schema.watchlists.chemicalId))
    .where(ownerFilter(viewer))
    .orderBy(schema.chemicals.preferredName);
}

/** Regulatory list changes affecting anything the viewer (or their org) watches or stocks. */
export async function getRelevantChanges(viewer: Viewer, limit = 50) {
  if (!viewer.userId) return [];
  const watched = db.select({ id: schema.watchlists.chemicalId }).from(schema.watchlists).where(ownerFilter(viewer));
  const stocked = viewer.orgId
    ? db
        .select({ id: sql<number>`${schema.workspaceInventory.chemicalId}` })
        .from(schema.workspaceInventory)
        .where(and(eq(schema.workspaceInventory.orgId, viewer.orgId), isNotNull(schema.workspaceInventory.chemicalId)))
    : null;

  return db
    .select({
      id: schema.regulatoryChanges.id,
      listCode: schema.regulatoryChanges.listCode,
      changeType: schema.regulatoryChanges.changeType,
      detectedAt: schema.regulatoryChanges.detectedAt,
      casRn: schema.chemicals.casRn,
      name: schema.chemicals.preferredName,
    })
    .from(schema.regulatoryChanges)
    .innerJoin(schema.chemicals, eq(schema.chemicals.id, schema.regulatoryChanges.chemicalId))
    .where(
      stocked
        ? or(inArray(schema.regulatoryChanges.chemicalId, watched), inArray(schema.regulatoryChanges.chemicalId, stocked))
        : inArray(schema.regulatoryChanges.chemicalId, watched),
    )
    .orderBy(desc(schema.regulatoryChanges.detectedAt))
    .limit(limit);
}
