import { invalidateTags } from "./invalidate";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { normalizeCas } from "@/lib/cas";
import { REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";
import { type IssueInput, recordIssues } from "./runs";
import { bytesToCsvText, type CsvRecord, findColumn, loadSourceBytes, parseCsv } from "./source";

function detailsFor(record: CsvRecord, casCol: string): Record<string, string> {
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === casCol || !v) continue;
    details[k] = v.slice(0, 500);
    if (Object.keys(details).length >= 10) break;
  }
  return details;
}

export async function ingestRegulatoryList(listCode: RegulatoryListCode): Promise<IngestStats> {
  "use step";
  const config = REGULATORY_LISTS[listCode];
  const source = await loadSourceBytes(`reglist:${listCode}`, process.env[config.envVar]);
  if (!source) return { skipped: 1 };

  const records = parseCsv(bytesToCsvText(source.bytes));
  const casCol = findColumn(records[0], ["CAS", "CASRN", "CAS RN", "CAS Number", "CAS No.", /cas/i]);
  if (!casCol) throw new Error(`${listCode}: no CAS column found`);

  const issues: IssueInput[] = [];
  const byCas = new Map<string, Record<string, string>>();
  for (const record of records) {
    // Some lists put several CAS numbers in one cell, e.g. "71-43-2; 108-88-3".
    for (const token of (record[casCol] ?? "").split(/[;,/\s]+/)) {
      const cas = normalizeCas(token);
      if (cas) byCas.set(cas, detailsFor(record, casCol));
    }
  }

  const casList = [...byCas.keys()];
  const idByCas = new Map<string, number>();
  for (let i = 0; i < casList.length; i += 1000) {
    const rows = await db
      .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
      .from(schema.chemicals)
      .where(inArray(schema.chemicals.casRn, casList.slice(i, i + 1000)));
    for (const r of rows) idByCas.set(r.casRn, r.id);
  }
  for (const cas of casList) {
    if (!idByCas.has(cas)) {
      issues.push({ entityType: "reglist", entityId: `${listCode}:${cas}`, issue: "unknown_cas", severity: "info" });
    }
  }

  const existing = await db
    .select({ chemicalId: schema.regulatoryListings.chemicalId })
    .from(schema.regulatoryListings)
    .where(eq(schema.regulatoryListings.listCode, listCode));
  const existingIds = new Set(existing.map((e) => e.chemicalId));
  const incomingIds = new Set(idByCas.values());
  const isFirstLoad = existingIds.size === 0;

  const added = [...incomingIds].filter((id) => !existingIds.has(id));
  const removed = [...existingIds].filter((id) => !incomingIds.has(id));

  const values = [...idByCas.entries()].map(([cas, chemicalId]) => ({
    chemicalId,
    listCode,
    details: byCas.get(cas) ?? {},
    sourceUrl: source.origin.startsWith("http") ? source.origin : null,
  }));
  for (let i = 0; i < values.length; i += 1000) {
    await db
      .insert(schema.regulatoryListings)
      .values(values.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [schema.regulatoryListings.chemicalId, schema.regulatoryListings.listCode],
        set: { details: sql`excluded.details`, sourceUrl: sql`excluded.source_url`, updatedAt: new Date() },
      });
  }
  for (let i = 0; i < removed.length; i += 1000) {
    await db
      .delete(schema.regulatoryListings)
      .where(
        and(
          eq(schema.regulatoryListings.listCode, listCode),
          inArray(schema.regulatoryListings.chemicalId, removed.slice(i, i + 1000)),
        ),
      );
  }

  // The initial load is a baseline, not a change, so it must not trigger alerts.
  if (!isFirstLoad) {
    const changes = [
      ...added.map((chemicalId) => ({ chemicalId, listCode, changeType: "added" as const })),
      ...removed.map((chemicalId) => ({ chemicalId, listCode, changeType: "removed" as const })),
    ];
    for (let i = 0; i < changes.length; i += 1000) {
      await db.insert(schema.regulatoryChanges).values(changes.slice(i, i + 1000));
    }
  }

  await recordIssues(issues);
  invalidateTags(["chemicals", "search"]);
  return {
    processed: casList.length,
    inserted: added.length,
    removed: removed.length,
    unknownCas: issues.length,
  };
}
