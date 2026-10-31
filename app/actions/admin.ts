"use server";

import { put } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { db, schema } from "@/db";
import { getViewer } from "@/lib/auth";
import { isIngestJob, startIngestJob } from "@/lib/ingest/jobs";
import { REGULATORY_LIST_CODES } from "@/lib/reglists-meta";

const SOURCE_KEYS = ["tsca", "scil", "chemexpo", ...REGULATORY_LIST_CODES.map((c) => `reglist:${c}`)];
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;

async function adminId() {
  const viewer = await getViewer();
  if (!viewer.userId || !viewer.isPlatformAdmin) throw new Error("Forbidden");
  return viewer.userId;
}

export async function triggerIngest(job: string): Promise<{ runId?: string; error?: string }> {
  await adminId();
  if (!isIngestJob(job)) return { error: `Unknown job ${job}` };
  try {
    const runId = await startIngestJob(job, "admin");
    revalidatePath("/admin/ingestion");
    return { runId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export async function uploadSourceFile(
  _prev: { ok?: boolean; error?: string },
  formData: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const uploadedBy = await adminId();
  const key = String(formData.get("key") ?? "");
  const file = formData.get("file");
  if (!SOURCE_KEYS.includes(key)) return { error: "Choose a source." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_SOURCE_BYTES) return { error: "Files must be 100 MB or smaller." };

  const blob = await put(`sources/${key.replace(":", "-")}/${file.name}`, file, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type || "application/octet-stream",
  });
  await db
    .insert(schema.sourceFiles)
    .values({ key, blobPathname: blob.pathname, filename: file.name, uploadedBy })
    .onConflictDoUpdate({
      target: schema.sourceFiles.key,
      set: { blobPathname: blob.pathname, filename: file.name, uploadedBy, updatedAt: sql`now()` },
    });
  revalidatePath("/admin/ingestion");
  return { ok: true };
}

export async function removeSourceFile(key: string) {
  await adminId();
  await db.delete(schema.sourceFiles).where(eq(schema.sourceFiles.key, key));
  revalidatePath("/admin/ingestion");
}

export async function setIssueStatus(id: number, status: "open" | "resolved" | "ignored") {
  const userId = await adminId();
  await db
    .update(schema.dataQualityIssues)
    .set({ status, resolvedBy: status === "open" ? null : userId, resolvedAt: status === "open" ? null : new Date() })
    .where(eq(schema.dataQualityIssues.id, id));
  revalidatePath("/admin/quality");
}

export async function reviewAlternative(id: number, status: "approved" | "rejected" | "pending") {
  const userId = await adminId();
  const [row] = await db
    .update(schema.alternatives)
    .set({ status, reviewedBy: status === "pending" ? null : userId, reviewedAt: status === "pending" ? null : new Date() })
    .where(eq(schema.alternatives.id, id))
    .returning({ chemicalId: schema.alternatives.chemicalId });
  if (row) updateTag(`alternatives:${row.chemicalId}`);
  revalidatePath("/admin/alternatives");
}
