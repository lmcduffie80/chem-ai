/**
 * Loads one regulatory list outside Workflow, e.g. `pnpm load:reglist PEST_INERT`.
 */
import { ingestRegulatoryList } from "../lib/ingest/reglists";
import { REGULATORY_LIST_CODES, type RegulatoryListCode } from "../lib/reglists-meta";

async function main() {
  const code = process.argv[2] as RegulatoryListCode;
  if (!REGULATORY_LIST_CODES.includes(code)) throw new Error(`Pass one of: ${REGULATORY_LIST_CODES.join(", ")}`);
  console.log(code, await ingestRegulatoryList(code));
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
