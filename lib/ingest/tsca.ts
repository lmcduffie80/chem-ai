import { invalidateTags } from "./invalidate";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { isValidCasChecksum, normalizeCas } from "@/lib/cas";
import type { IngestStats } from "@/db/schema";
import { type IssueInput, recordIssues } from "./runs";
import { bytesToCsvText, findColumn, loadSourceBytes, parseCsv, readPrivateBlob, stageText } from "./source";

export const TSCA_CHUNK_SIZE = 5000;
const UPSERT_BATCH = 1000;

/** Downloads the TSCA inventory (zip or CSV), stages the CSV in private Blob and returns its row count. */
export async function stageTscaInventory() {
  "use step";
  const source = await loadSourceBytes("tsca", process.env.TSCA_INVENTORY_URL);
  if (!source) {
    throw new Error("No TSCA inventory source configured. Set TSCA_INVENTORY_URL or upload a file in Admin > Ingestion.");
  }
  const text = bytesToCsvText(source.bytes, /tscainv/i);
  const total = parseCsv(text, /casrn|cas\s*rn|cas\s*number/i).length;
  const pathname = await stageText("tsca", text);
  return { pathname, total, chunkSize: TSCA_CHUNK_SIZE, origin: source.origin };
}

type TscaRow = {
  casRn: string;
  preferredName: string;
  tscaStatus: string | null;
  tscaFlags: string[];
  isUvcb: boolean;
};

export async function upsertTscaChunk(pathname: string, offset: number): Promise<IngestStats> {
  "use step";
  const text = bytesToCsvText(await readPrivateBlob(pathname));
  const records = parseCsv(text, /casrn|cas\s*rn|cas\s*number/i).slice(offset, offset + TSCA_CHUNK_SIZE);
  const first = records[0];
  const casCol = findColumn(first, ["CASRN", "CAS RN", "CAS Number", /cas/i]);
  const nameCol = findColumn(first, ["ChemName", "Chemical Name", "Name", /name/i]);
  const activityCol = findColumn(first, ["ACTIVITY", "Status", /activ/i]);
  const flagCol = findColumn(first, ["FLAG", "Flags", "Regulatory Flag"]);
  const uvcbCol = findColumn(first, ["UVCB"]);
  if (!casCol || !nameCol) throw new Error("TSCA file is missing CAS or name columns");

  const issues: IssueInput[] = [];
  const rows = new Map<string, TscaRow>();
  let skipped = 0;

  for (const record of records) {
    const cas = normalizeCas(record[casCol]);
    if (!cas) {
      skipped++;
      continue;
    }
    if (!isValidCasChecksum(cas)) {
      issues.push({
        entityType: "tsca_row",
        entityId: cas,
        issue: "invalid_cas_checksum",
        details: record[nameCol]?.slice(0, 500),
      });
    }
    const flags = (flagCol ? record[flagCol] : "")
      .split(/[,;\s]+/)
      .map((f) => f.trim())
      .filter(Boolean);
    rows.set(cas, {
      casRn: cas,
      preferredName: record[nameCol] || cas,
      tscaStatus: activityCol ? record[activityCol]?.toUpperCase() || null : null,
      tscaFlags: flags,
      isUvcb: uvcbCol ? /uvcb|true|y/i.test(record[uvcbCol] ?? "") : false,
    });
  }

  let inserted = 0;
  let updated = 0;
  const values = [...rows.values()];
  for (let i = 0; i < values.length; i += UPSERT_BATCH) {
    const result = await db
      .insert(schema.chemicals)
      .values(values.slice(i, i + UPSERT_BATCH))
      .onConflictDoUpdate({
        target: schema.chemicals.casRn,
        set: {
          preferredName: sql`case when ${schema.chemicals.enrichedAt} is null and ${schema.chemicals.pubchemCid} is null then excluded.preferred_name else ${schema.chemicals.preferredName} end`,
          tscaStatus: sql`excluded.tsca_status`,
          tscaFlags: sql`excluded.tsca_flags`,
          isUvcb: sql`excluded.is_uvcb`,
          updatedAt: new Date(),
        },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    for (const r of result) {
      if (r.inserted) inserted++;
      else updated++;
    }
  }

  await recordIssues(issues);
  invalidateTags(["chemicals", "search"]);
  return { processed: records.length, inserted, updated, skipped, issues: issues.length };
}
