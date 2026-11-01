import { get, put } from "@vercel/blob";
import { parse } from "csv-parse/sync";
import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { db, schema } from "@/db";

export type SourceBytes = { bytes: Uint8Array; origin: string };

/** Admin uploads (stored in Blob and tracked in `source_files`) take precedence over configured URLs. */
export async function loadSourceBytes(key: string, url: string | undefined): Promise<SourceBytes | null> {
  const [upload] = await db
    .select()
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.key, key))
    .limit(1);

  if (upload) {
    return { bytes: await readPrivateBlob(upload.blobPathname), origin: `blob:${upload.blobPathname}` };
  }
  if (!url) return null;

  const res = await fetch(url, { headers: { "user-agent": "Allochemix-Ingest/1.0" } });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), origin: url };
}

export async function readPrivateBlob(pathname: string): Promise<Uint8Array> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new Error(`Blob not found: ${pathname}`);
  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

export async function stageText(prefix: string, text: string): Promise<string> {
  const blob = await put(`ingest/${prefix}/${Date.now()}.csv`, text, {
    access: "private",
    contentType: "text/csv",
    addRandomSuffix: true,
  });
  return blob.pathname;
}

/**
 * Unzips when needed (choosing the CSV entry matching `preferEntry`, else the largest CSV)
 * and decodes UTF-8, falling back to Windows-1252.
 */
export function bytesToCsvText(bytes: Uint8Array, preferEntry?: RegExp): string {
  let data = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const entries = unzipSync(bytes);
    const csvNames = Object.keys(entries).filter((name) => name.toLowerCase().endsWith(".csv"));
    if (csvNames.length === 0) throw new Error("Zip archive does not contain a CSV file");
    const csvName =
      csvNames.find((name) => preferEntry?.test(name)) ??
      csvNames.sort((a, b) => entries[b].length - entries[a].length)[0];
    data = entries[csvName];
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(data);
  }
}

export type CsvRecord = Record<string, string>;

/**
 * Parses CSVs whose real header may be preceded by title rows (common in EPA and
 * OEHHA exports). The header is the first row containing a cell matching `headerHint`.
 */
export function parseCsv(text: string, headerHint: RegExp = /cas/i): CsvRecord[] {
  const rows = parse(text, {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as string[][];

  const headerIndex = rows.findIndex((row) => row.some((cell) => headerHint.test(cell)));
  if (headerIndex === -1) throw new Error(`Could not find a header row matching ${headerHint}`);
  const header = rows[headerIndex].map((h) => h.trim());

  return rows.slice(headerIndex + 1).map((row) => {
    const record: CsvRecord = {};
    header.forEach((h, i) => {
      if (h) record[h] = row[i] ?? "";
    });
    return record;
  });
}

/** Finds the first column whose name matches any candidate (case-insensitive, exact match first). */
export function findColumn(record: CsvRecord | undefined, candidates: (string | RegExp)[]): string | undefined {
  if (!record) return undefined;
  const keys = Object.keys(record);
  for (const candidate of candidates) {
    const hit = keys.find((k) =>
      typeof candidate === "string" ? k.toLowerCase() === candidate.toLowerCase() : candidate.test(k),
    );
    if (hit) return hit;
  }
  return undefined;
}
