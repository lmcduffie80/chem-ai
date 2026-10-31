import { eq, sql } from "drizzle-orm";
import { getWorkflowMetadata } from "workflow";
import { db, schema } from "@/db";
import type { IngestSource, IngestStats } from "@/db/schema";

export async function startRun(source: IngestSource, trigger: string) {
  "use step";
  let workflowRunId: string | null = null;
  try {
    workflowRunId = getWorkflowMetadata().workflowRunId;
  } catch {
    // Called directly from a CLI script, outside a workflow run.
  }
  const [run] = await db
    .insert(schema.ingestRuns)
    .values({ source, trigger, workflowRunId })
    .returning({ id: schema.ingestRuns.id });
  return run.id;
}

export async function finishRun(runId: string, stats: IngestStats) {
  "use step";
  await db
    .update(schema.ingestRuns)
    .set({ status: "succeeded", stats, finishedAt: new Date() })
    .where(eq(schema.ingestRuns.id, runId));
}

export async function failRun(runId: string, error: string, stats: IngestStats) {
  "use step";
  await db
    .update(schema.ingestRuns)
    .set({ status: "failed", error: error.slice(0, 4000), stats, finishedAt: new Date() })
    .where(eq(schema.ingestRuns.id, runId));
}

export type IssueInput = {
  entityType: string;
  entityId: string;
  issue: string;
  details?: string;
  severity?: "info" | "warning" | "error";
};

/** Re-opens previously resolved issues if they recur. */
export async function recordIssues(issues: IssueInput[]) {
  if (issues.length === 0) return;
  for (let i = 0; i < issues.length; i += 500) {
    await db
      .insert(schema.dataQualityIssues)
      .values(issues.slice(i, i + 500).map((issue) => ({ severity: "warning", ...issue })))
      .onConflictDoUpdate({
        target: [
          schema.dataQualityIssues.entityType,
          schema.dataQualityIssues.entityId,
          schema.dataQualityIssues.issue,
        ],
        set: {
          details: sql`excluded.details`,
          status: sql`case when ${schema.dataQualityIssues.status} = 'ignored' then 'ignored'::issue_status else 'open'::issue_status end`,
        },
      });
  }
}

export async function lastSuccessfulRun(source: IngestSource) {
  const [run] = await db
    .select({ startedAt: schema.ingestRuns.startedAt })
    .from(schema.ingestRuns)
    .where(sql`${schema.ingestRuns.source} = ${source} and ${schema.ingestRuns.status} = 'succeeded'`)
    .orderBy(sql`${schema.ingestRuns.startedAt} desc`)
    .limit(1);
  return run?.startedAt ?? null;
}
