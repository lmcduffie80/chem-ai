import { start } from "workflow/api";
import {
  alertsWorkflow,
  chemexpoWorkflow,
  comptoxWorkflow,
  embeddingsWorkflow,
  ghsWorkflow,
  regulatoryListsWorkflow,
  scilWorkflow,
  sdsFeedWorkflow,
  tscaWorkflow,
} from "@/workflows/ingest";

export const INGEST_JOBS = {
  tsca: { label: "EPA TSCA Inventory", workflow: tscaWorkflow },
  comptox: { label: "EPA CompTox enrichment", workflow: comptoxWorkflow },
  ghs: { label: "PubChem GHS hazards", workflow: ghsWorkflow },
  reglists: { label: "Regulatory lists", workflow: regulatoryListsWorkflow },
  scil: { label: "Safer Chemical Ingredients List", workflow: scilWorkflow },
  sds: { label: "Licensed SDS & supplier feed", workflow: sdsFeedWorkflow },
  chemexpo: { label: "EPA ChemExpo products", workflow: chemexpoWorkflow },
  embeddings: { label: "Chemical embeddings", workflow: embeddingsWorkflow },
  alerts: { label: "Regulatory change alerts", workflow: alertsWorkflow },
} as const;

export type IngestJob = keyof typeof INGEST_JOBS;

export function isIngestJob(value: string): value is IngestJob {
  return value in INGEST_JOBS;
}

export async function startIngestJob(job: IngestJob, trigger: string) {
  const { workflow } = INGEST_JOBS[job];
  const run = await start(workflow as (trigger: string) => Promise<unknown>, [trigger]);
  return run.runId;
}
