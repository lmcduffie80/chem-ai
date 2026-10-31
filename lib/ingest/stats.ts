import type { IngestStats } from "@/db/schema";

export function mergeStats(a: IngestStats, b: IngestStats): IngestStats {
  const out: IngestStats = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
