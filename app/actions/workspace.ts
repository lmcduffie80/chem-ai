"use server";

import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { after } from "next/server";
import { db, schema } from "@/db";
import { ensureAccountRecords, getViewer } from "@/lib/auth";
import { looksLikeCas, normalizeCas } from "@/lib/cas";
import { can } from "@/lib/entitlements";
import { parseStoredSds } from "@/lib/ingest/sds-provider";

type ActionResult = { ok?: boolean; error?: string };

const MAX_SDS_BYTES = 20 * 1024 * 1024;

async function editableWorkspace() {
  const viewer = await getViewer();
  if (!viewer.userId) return { error: "Sign in first." } as const;
  if (!viewer.orgId || !can(viewer.orgPlan, "workspace")) return { error: "Workspaces require a Team plan." } as const;
  if (viewer.orgRole !== "admin" && viewer.orgRole !== "editor") return { error: "Viewers cannot edit the workspace." } as const;
  await ensureAccountRecords(viewer);
  return { viewer: { ...viewer, userId: viewer.userId, orgId: viewer.orgId } } as const;
}

function text(formData: FormData, key: string, max = 200) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

export async function addInventoryItem(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await editableWorkspace();
  if ("error" in ctx) return { error: ctx.error };

  const casInput = text(formData, "cas", 20);
  let chemicalId: number | null = null;
  let label = text(formData, "label");
  if (casInput) {
    const cas = looksLikeCas(casInput) ? normalizeCas(casInput) : null;
    if (!cas) return { error: `"${casInput}" is not a valid CAS number.` };
    const [chem] = await db
      .select({ id: schema.chemicals.id, name: schema.chemicals.preferredName })
      .from(schema.chemicals)
      .where(eq(schema.chemicals.casRn, cas));
    if (!chem) return { error: `${cas} is not on the TSCA inventory.` };
    chemicalId = chem.id;
    label ??= chem.name;
  }
  if (!label) return { error: "Enter a CAS number or a label." };

  const quantityRaw = text(formData, "quantity", 20);
  const quantity = quantityRaw ? Number(quantityRaw) : null;
  if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) return { error: "Quantity must be a positive number." };

  await db.insert(schema.workspaceInventory).values({
    orgId: ctx.viewer.orgId,
    chemicalId,
    label,
    location: text(formData, "location"),
    quantity,
    unit: text(formData, "unit", 20),
    notes: text(formData, "notes", 1000),
    createdBy: ctx.viewer.userId,
  });
  revalidatePath("/workspace/inventory");
  return { ok: true };
}

export async function removeInventoryItem(id: string): Promise<ActionResult> {
  const ctx = await editableWorkspace();
  if ("error" in ctx) return { error: ctx.error };
  await db
    .delete(schema.workspaceInventory)
    .where(and(eq(schema.workspaceInventory.id, id), eq(schema.workspaceInventory.orgId, ctx.viewer.orgId)));
  revalidatePath("/workspace/inventory");
  return { ok: true };
}

/** Stores the PDF privately, then extracts sections after the response is sent. */
export async function uploadSds(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const ctx = await editableWorkspace();
  if ("error" in ctx) return { error: ctx.error };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF to upload." };
  if (file.size > MAX_SDS_BYTES) return { error: "SDS PDFs must be 20 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { error: "That file is not a PDF." };

  const externalId = randomUUID();
  const blob = await put(`sds/org/${ctx.viewer.orgId}/${externalId}.pdf`, Buffer.from(bytes), {
    access: "private",
    contentType: "application/pdf",
  });
  const [doc] = await db
    .insert(schema.sdsDocuments)
    .values({
      orgId: ctx.viewer.orgId,
      source: `org:${ctx.viewer.orgId}`,
      externalId,
      title: text(formData, "title") ?? file.name.replace(/\.pdf$/i, ""),
      uploadedBy: ctx.viewer.userId,
      blobPathname: blob.pathname,
    })
    .returning({ id: schema.sdsDocuments.id });

  after(async () => {
    await parseStoredSds(doc.id, bytes);
    revalidateTag(`sds:${doc.id}`, "max");
  });
  revalidatePath("/workspace/sds");
  return { ok: true };
}

export async function deleteUploadedSds(id: string): Promise<ActionResult> {
  const ctx = await editableWorkspace();
  if ("error" in ctx) return { error: ctx.error };
  const [deleted] = await db
    .delete(schema.sdsDocuments)
    .where(and(eq(schema.sdsDocuments.id, id), eq(schema.sdsDocuments.orgId, ctx.viewer.orgId)))
    .returning({ blobPathname: schema.sdsDocuments.blobPathname });
  if (deleted?.blobPathname) await del(deleted.blobPathname);
  revalidateTag(`sds:${id}`, "max");
  revalidatePath("/workspace/sds");
  return { ok: true };
}
