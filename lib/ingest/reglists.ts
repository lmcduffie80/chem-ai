import { invalidateTags } from "./invalidate";
import { parse as parseStream } from "csv-parse";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Readable } from "node:stream";
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

function collectCsvList(listCode: RegulatoryListCode, bytes: Uint8Array) {
  const records = parseCsv(bytesToCsvText(bytes));
  const casCol = findColumn(records[0], ["CAS", "CASRN", "CAS RN", "CAS Number", "CAS No.", /cas/i]);
  if (!casCol) throw new Error(`${listCode}: no CAS column found`);

  const byCas = new Map<string, Record<string, string>>();
  for (const record of records) {
    // Some lists put several CAS numbers in one cell, e.g. "71-43-2; 108-88-3".
    for (const token of (record[casCol] ?? "").split(/[;,/\s]+/)) {
      const cas = normalizeCas(token);
      if (cas) byCas.set(cas, detailsFor(record, casCol));
    }
  }
  return byCas;
}

/** EPA's pesticide inert ingredient lists, as compiled in ChemExpo's list-presence download. */
async function collectPesticideInerts(bytes: Uint8Array) {
  const titlesByCas = new Map<string, Set<string>>();
  const parser = Readable.from([Buffer.from(bytes)]).pipe(
    parseStream({ columns: true, bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }),
  );
  for await (const row of parser as AsyncIterable<CsvRecord>) {
    if (!/environmental protection agency/i.test(row["Data Source"] ?? "")) continue;
    if (!/inert_ingredient/i.test(row["Keyword Set"] ?? "")) continue;
    const cas = normalizeCas(row["Curated CAS"] || row["Raw CAS"]);
    if (!cas) continue;
    const titles = titlesByCas.get(cas) ?? new Set<string>();
    titles.add((row["Data Document Title"] ?? "").trim());
    titlesByCas.set(cas, titles);
  }
  if (titlesByCas.size === 0) throw new Error("PEST_INERT: no EPA inert ingredient rows found in the source file");

  const byCas = new Map<string, Record<string, string>>();
  for (const [cas, titles] of titlesByCas) {
    byCas.set(cas, { Lists: [...titles].filter(Boolean).sort().join("; ").slice(0, 500), Source: "U.S. EPA via EPA ChemExpo" });
  }
  return byCas;
}

export async function ingestRegulatoryList(listCode: RegulatoryListCode): Promise<IngestStats> {
  "use step";
  const config = REGULATORY_LISTS[listCode];
  const source = await loadSourceBytes(`reglist:${listCode}`, process.env[config.envVar] || config.defaultUrl);
  if (!source) return { skipped: 1 };

  const issues: IssueInput[] = [];
  const byCas =
    listCode === "PEST_INERT" ? await collectPesticideInerts(source.bytes) : collectCsvList(listCode, source.bytes);

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
