import { failRun, finishRun, startRun } from "@/lib/ingest/runs";
import { mergeStats } from "@/lib/ingest/stats";
import { stageTscaInventory, upsertTscaChunk } from "@/lib/ingest/tsca";
import type { IngestStats } from "@/db/schema";

// Runs the TSCA ingestion steps in-process (outside the workflow runtime) for first-time seeding.
async function main() {
  const runId = await startRun("tsca", "seed-script");
  let stats: IngestStats = {};
  try {
    const { pathname, total, chunkSize, origin } = await stageTscaInventory();
    console.log(`Staged ${total} rows from ${origin}`);
    for (let offset = 0; offset < total; offset += chunkSize) {
      stats = mergeStats(stats, await upsertTscaChunk(pathname, offset));
      console.log(`  ${Math.min(offset + chunkSize, total)}/${total}`, stats);
    }
    await finishRun(runId, stats);
  } catch (error) {
    await failRun(runId, String(error), stats);
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
