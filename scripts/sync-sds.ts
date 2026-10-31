/**
 * Runs the SDS feed sync outside Workflow (useful locally with SDS_PROVIDER=fixture).
 *   SDS_PROVIDER=fixture pnpm sync:sds
 */
import { fetchAndParseSds, listSdsUpdates, syncProducts } from "../lib/ingest/sds-provider";

async function main() {
  let cursor: string | undefined;
  do {
    const page = await listSdsUpdates(cursor);
    const { stats, sdsToFetch } = await syncProducts(page.productIds);
    console.log("products", stats);
    for (const sds of sdsToFetch) {
      console.log("sds", sds.id, await fetchAndParseSds(sds.id, sds.providerHash));
    }
    cursor = page.nextCursor;
  } while (cursor);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
