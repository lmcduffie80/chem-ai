import { isIngestJob, startIngestJob } from "@/lib/ingest/jobs";

export async function GET(request: Request, { params }: RouteContext<"/api/cron/[job]">) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { job } = await params;
  if (!isIngestJob(job)) return Response.json({ error: `Unknown job ${job}` }, { status: 404 });

  const runId = await startIngestJob(job, "cron");
  return Response.json({ job, runId });
}
