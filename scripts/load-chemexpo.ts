/**
 * Loads EPA ChemExpo product compositions outside Workflow.
 *   pnpm load:chemexpo                 # downloads the current bulk file from EPA
 *   pnpm load:chemexpo ./chemexpo.zip  # uses a file you already downloaded
 */
import { put } from "@vercel/blob";
import { readFile } from "node:fs/promises";
import {
  extractChemExpoProducts,
  planChemExpoSample,
  pruneChemExpo,
  stageChemExpo,
  upsertChemExpoChunk,
} from "../lib/ingest/chemexpo";
import { failRun, finishRun, startRun } from "../lib/ingest/runs";
import { errorMessage, mergeStats } from "../lib/ingest/stats";
import type { IngestStats } from "../db/schema";

async function stage(localFile: string | undefined) {
  if (!localFile) return (await stageChemExpo()).pathname;
  const blob = await put(`ingest/chemexpo/local-${Date.now()}.zip`, await readFile(localFile), {
    access: "private",
    addRandomSuffix: true,
    multipart: true,
  });
  return blob.pathname;
}

async function main() {
  const runId = await startRun("chemexpo", "script");
  let stats: IngestStats = {};
  try {
    const pathname = await stage(process.argv[2]);
    console.log("staged", pathname);
    const plan = await planChemExpoSample(pathname);
    stats = mergeStats(stats, plan.stats);
    console.log("plan", plan.stats);
    const chunks = await extractChemExpoProducts(pathname, plan.selectedPath);
    console.log("chunks", chunks.length);
    for (const [i, chunk] of chunks.entries()) {
      const result = await upsertChemExpoChunk(chunk);
      stats = mergeStats(stats, result);
      console.log(`chunk ${i + 1}/${chunks.length}`, result);
    }
    stats = mergeStats(stats, await pruneChemExpo(runId));
    await finishRun(runId, stats);
    console.log("done", stats);
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
