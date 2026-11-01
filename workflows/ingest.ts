import { sendRegulatoryAlerts } from "@/lib/alerts";
import {
  cleanupChemExpo,
  extractChemExpoProducts,
  planChemExpoProducts,
  pruneChemExpo,
  stageChemExpo,
  summarizeChemExpo,
  upsertChemExpoChunk,
} from "@/lib/ingest/chemexpo";
import { enrichFromCompTox, selectChemicalsToEnrich } from "@/lib/ingest/comptox";
import { embedChemicals, selectChemicalsToEmbed } from "@/lib/ingest/embeddings";
import { fetchGhsBatch, selectChemicalsForGhs } from "@/lib/ingest/pubchem";
import { ingestRegulatoryList } from "@/lib/ingest/reglists";
import { failRun, finishRun, startRun } from "@/lib/ingest/runs";
import { ingestScil } from "@/lib/ingest/scil";
import { fetchAndParseSds, listSdsUpdates, syncProducts } from "@/lib/ingest/sds-provider";
import { errorMessage, mergeStats } from "@/lib/ingest/stats";
import { stageTscaInventory, upsertTscaChunk } from "@/lib/ingest/tsca";
import { REGULATORY_LIST_CODES } from "@/lib/reglists-meta";
import type { IngestStats } from "@/db/schema";

export async function tscaWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("tsca", trigger);
  let stats: IngestStats = {};
  try {
    const { pathname, total, chunkSize } = await stageTscaInventory();
    for (let offset = 0; offset < total; offset += chunkSize) {
      stats = mergeStats(stats, await upsertTscaChunk(pathname, offset));
    }
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

/** Processes up to `maxBatches` batches of chemicals that need CompTox identity/property enrichment. */
export async function comptoxWorkflow(trigger: string, maxBatches = 50) {
  "use workflow";
  const runId = await startRun("comptox", trigger);
  let stats: IngestStats = {};
  try {
    for (let i = 0; i < maxBatches; i++) {
      const ids = await selectChemicalsToEnrich(100);
      if (ids.length === 0) break;
      stats = mergeStats(stats, await enrichFromCompTox(ids));
    }
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function ghsWorkflow(trigger: string, maxBatches = 50) {
  "use workflow";
  const runId = await startRun("pubchem_ghs", trigger);
  let stats: IngestStats = {};
  try {
    for (let i = 0; i < maxBatches; i++) {
      const ids = await selectChemicalsForGhs(50);
      if (ids.length === 0) break;
      stats = mergeStats(stats, await fetchGhsBatch(ids));
    }
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function regulatoryListsWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("reglists", trigger);
  const stats: IngestStats = {};
  try {
    for (const code of REGULATORY_LIST_CODES) {
      const listStats = await ingestRegulatoryList(code);
      for (const [k, v] of Object.entries(listStats)) stats[`${code}_${k}`] = v;
    }
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function scilWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("scil", trigger);
  try {
    const stats = await ingestScil();
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), {});
    throw error;
  }
}

export async function sdsFeedWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("sds_feed", trigger);
  let stats: IngestStats = {};
  try {
    let cursor: string | undefined;
    do {
      const page = await listSdsUpdates(cursor);
      for (let i = 0; i < page.productIds.length; i += 20) {
        const result = await syncProducts(page.productIds.slice(i, i + 20));
        stats = mergeStats(stats, result.stats);
        for (const sds of result.sdsToFetch) {
          stats = mergeStats(stats, await fetchAndParseSds(sds.id, sds.providerHash));
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function embeddingsWorkflow(trigger: string, maxBatches = 50) {
  "use workflow";
  const runId = await startRun("embeddings", trigger);
  let stats: IngestStats = {};
  try {
    for (let i = 0; i < maxBatches; i++) {
      const ids = await selectChemicalsToEmbed(100);
      if (ids.length === 0) break;
      stats = mergeStats(stats, await embedChemicals(ids));
    }
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function chemexpoWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("chemexpo", trigger);
  let stats: IngestStats = {};
  const temporaryPaths: string[] = [];
  try {
    const staged = await stageChemExpo();
    if (!staged.origin.startsWith("blob:")) temporaryPaths.push(staged.pathname);
    const plan = await planChemExpoProducts(staged.pathname);
    temporaryPaths.push(plan.selectedPath);
    stats = mergeStats(stats, plan.stats);
    for (let partition = 0; partition < plan.partitions; partition++) {
      const chunkPaths = await extractChemExpoProducts(staged.pathname, plan.selectedPath, partition, plan.partitions);
      for (const chunkPath of chunkPaths) {
        stats = mergeStats(stats, await upsertChemExpoChunk(chunkPath));
      }
    }
    stats = mergeStats(stats, await pruneChemExpo(runId));
    stats = mergeStats(stats, await summarizeChemExpo());
    await finishRun(runId, stats);
    await cleanupChemExpo(temporaryPaths);
    return stats;
  } catch (error) {
    await cleanupChemExpo(temporaryPaths);
    await failRun(runId, errorMessage(error), stats);
    throw error;
  }
}

export async function alertsWorkflow(trigger: string) {
  "use workflow";
  const runId = await startRun("alerts", trigger);
  try {
    const stats = await sendRegulatoryAlerts();
    await finishRun(runId, stats);
    return stats;
  } catch (error) {
    await failRun(runId, errorMessage(error), {});
    throw error;
  }
}
