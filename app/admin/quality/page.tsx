import { and, count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { requirePlatformAdmin } from "@/lib/admin";
import { IssueActions } from "./issue-actions";

export const metadata = { title: "Data quality" };

const STATUSES = ["open", "resolved", "ignored"] as const;

export default function QualityPage({ searchParams }: PageProps<"/admin/quality">) {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Quality searchParams={searchParams} />
    </Suspense>
  );
}

function entityHref(type: string, id: string) {
  if (type === "chemical") return `/chemicals/${id}`;
  if (type === "product") return `/products/${id}`;
  if (type === "sds_document") return `/sds/${id}`;
  return null;
}

async function Quality({ searchParams }: Pick<PageProps<"/admin/quality">, "searchParams">) {
  await requirePlatformAdmin();
  const params = await searchParams;
  const status = STATUSES.find((s) => s === params.status) ?? "open";
  const issueType = typeof params.issue === "string" ? params.issue : null;

  const [summary, issues] = await Promise.all([
    db
      .select({ issue: schema.dataQualityIssues.issue, n: count() })
      .from(schema.dataQualityIssues)
      .where(eq(schema.dataQualityIssues.status, status))
      .groupBy(schema.dataQualityIssues.issue)
      .orderBy(desc(count())),
    db
      .select()
      .from(schema.dataQualityIssues)
      .where(
        and(
          eq(schema.dataQualityIssues.status, status),
          issueType ? eq(schema.dataQualityIssues.issue, issueType) : undefined,
        ),
      )
      .orderBy(desc(schema.dataQualityIssues.createdAt))
      .limit(200),
  ]);

  const link = (next: { status?: string; issue?: string | null }) => {
    const sp = new URLSearchParams();
    sp.set("status", next.status ?? status);
    const issue = next.issue === undefined ? issueType : next.issue;
    if (issue) sp.set("issue", issue);
    return `/admin/quality?${sp}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Data quality</h1>
      <div className="flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link key={s} href={link({ status: s, issue: null })}>
            <Badge variant={s === status ? "default" : "outline"}>{s}</Badge>
          </Link>
        ))}
        <span className="text-border">|</span>
        <Link href={link({ issue: null })}>
          <Badge variant={!issueType ? "secondary" : "outline"}>all issues</Badge>
        </Link>
        {summary.map((s) => (
          <Link key={s.issue} href={link({ issue: s.issue })}>
            <Badge variant={issueType === s.issue ? "secondary" : "outline"}>
              {s.issue} · {s.n}
            </Badge>
          </Link>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Issue</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Detected</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground py-6 text-center">
                Nothing here.
              </TableCell>
            </TableRow>
          )}
          {issues.map((i) => {
            const href = entityHref(i.entityType, i.entityId);
            return (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-xs">{i.issue}</TableCell>
                <TableCell className="text-xs">
                  {i.entityType}:{" "}
                  {href ? (
                    <Link href={href} className="underline underline-offset-4">
                      {i.entityId}
                    </Link>
                  ) : (
                    i.entityId
                  )}
                </TableCell>
                <TableCell className="max-w-sm min-w-64 text-xs break-words whitespace-normal">{i.details}</TableCell>
                <TableCell>
                  <Badge variant={i.severity === "error" ? "destructive" : "outline"}>{i.severity}</Badge>
                </TableCell>
                <TableCell className="text-xs">{i.createdAt.toLocaleDateString("en-US")}</TableCell>
                <TableCell className="text-right">
                  <IssueActions id={i.id} status={i.status} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
