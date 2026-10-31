import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { textArray } from "@/db/sql";
import type { IngestStats } from "@/db/schema";
import { normalizeCas } from "@/lib/cas";
import { invalidateTags } from "./invalidate";
import { bytesToCsvText, findColumn, loadSourceBytes, parseCsv } from "./source";

// EPA publishes the live list as a JSON dataset embedded in this page; the .xls download lags behind it.
const DEFAULT_SCIL_URL = "https://www.epa.gov/saferchoice/safer-ingredients";

type ScilEntry = { classes: Set<string>; status: string | null };

/** "Green [Half Circle]" -> "Green half-circle" */
function normalizeScilCode(code: string | null | undefined) {
  if (!code) return null;
  const m = code.match(/^(\w+)\s*\[([^\]]+)\]/);
  if (!m) return code.trim() || null;
  return `${m[1]} ${m[2].toLowerCase().replace(/\s+/g, "-")}`;
}

/** Extracts the JSON array literal that starts at `start`, honouring brackets inside strings. */
function sliceJsonArray(text: string, start: number) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error("SCIL: unterminated dataset");
}

function fromHtml(html: string, byCas: Map<string, ScilEntry>) {
  const start = html.indexOf('[{"TName"');
  if (start < 0) throw new Error("SCIL: dataset not found in page");
  const rows = JSON.parse(sliceJsonArray(html, start)) as {
    CAS?: string | null;
    Code?: string | null;
    FuncClasses?: { FClass?: string }[];
  }[];
  for (const row of rows) {
    const cas = normalizeCas(row.CAS ?? "");
    if (!cas) continue;
    const entry = byCas.get(cas) ?? { classes: new Set<string>(), status: null };
    for (const f of row.FuncClasses ?? []) if (f.FClass?.trim()) entry.classes.add(f.FClass.trim());
    entry.status = normalizeScilCode(row.Code) ?? entry.status;
    byCas.set(cas, entry);
  }
}

function fromCsv(text: string, byCas: Map<string, ScilEntry>) {
  const records = parseCsv(text);
  const first = records[0];
  const casCol = findColumn(first, ["CAS Registry Number", "CAS Number", "CAS", "CASRN", /cas/i]);
  const classCol = findColumn(first, ["Functional Use", "Functional Use Class", "Functional Class", /function/i]);
  const statusCol = findColumn(first, ["Code", "Status", "Safer Choice Status", /status|code/i]);
  if (!casCol) throw new Error("SCIL: no CAS column found");
  for (const record of records) {
    const cas = normalizeCas(record[casCol]);
    if (!cas) continue;
    const entry = byCas.get(cas) ?? { classes: new Set<string>(), status: null };
    for (const c of (classCol ? record[classCol] : "").split(/[;,]/)) if (c.trim()) entry.classes.add(c.trim());
    entry.status = normalizeScilCode(statusCol ? record[statusCol] : null) ?? entry.status;
    byCas.set(cas, entry);
  }
}

/** Loads EPA's Safer Chemical Ingredients List: functional use classes and Safer Choice status per CAS. */
export async function ingestScil(): Promise<IngestStats> {
  "use step";
  const source = await loadSourceBytes("scil", process.env.SCIL_CSV_URL || DEFAULT_SCIL_URL);
  if (!source) return { skipped: 1 };

  const byCas = new Map<string, ScilEntry>();
  const head = new TextDecoder().decode(source.bytes.slice(0, 2048)).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    fromHtml(new TextDecoder().decode(source.bytes), byCas);
  } else {
    fromCsv(bytesToCsvText(source.bytes), byCas);
  }

  const casList = [...byCas.keys()];
  let updated = 0;
  for (let i = 0; i < casList.length; i += 1000) {
    const rows = await db
      .select({ id: schema.chemicals.id, casRn: schema.chemicals.casRn })
      .from(schema.chemicals)
      .where(inArray(schema.chemicals.casRn, casList.slice(i, i + 1000)));
    for (const row of rows) {
      const entry = byCas.get(row.casRn)!;
      await db
        .update(schema.chemicals)
        .set({
          functionClasses: sql`(select coalesce(array_agg(distinct c), '{}') from unnest(${schema.chemicals.functionClasses} || ${textArray([...entry.classes])}) as c)`,
          saferChoiceStatus: entry.status,
        })
        .where(eq(schema.chemicals.id, row.id));
      updated++;
    }
  }

  invalidateTags(["chemicals", "search"]);
  return { processed: casList.length, updated, skipped: casList.length - updated };
}
