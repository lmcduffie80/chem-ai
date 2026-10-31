import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { getViewer } from "@/lib/auth";
import { getSdsDocument } from "@/lib/chemicals";
import { SDS_SECTION_TITLES } from "@/lib/ai/sds-parse";
import { consumeSdsView } from "@/lib/usage";

export async function generateMetadata({ params }: PageProps<"/sds/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sds = await getSdsDocument(id);
  return { title: sds ? `SDS: ${sds.productName ?? sds.title ?? "Safety data sheet"}` : "SDS not found" };
}

export default function SdsPage({ params }: PageProps<"/sds/[id]">) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SdsContent params={params} />
      </Suspense>
    </div>
  );
}

async function SdsContent({ params }: Pick<PageProps<"/sds/[id]">, "params">) {
  const { id } = await params;
  const sds = await getSdsDocument(id);
  if (!sds) notFound();

  const viewer = await getViewer();
  if (sds.orgId && sds.orgId !== viewer.orgId) notFound();
  const access = sds.orgId ? ({ allowed: true, remaining: null } as const) : await consumeSdsView(viewer, sds.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Safety Data Sheet</p>
        <h1 className="text-2xl font-semibold">{sds.productName ?? sds.title ?? "Uploaded SDS"}</h1>
        <p className="text-muted-foreground text-sm">
          {sds.supplierId ? (
            <Link href={`/suppliers/${sds.supplierId}`} className="hover:underline">
              {sds.supplierName}
            </Link>
          ) : null}
          {sds.revisionDate && ` · Revised ${sds.revisionDate}`} · {sds.language.toUpperCase()} · {sds.region}
        </p>
      </div>

      {!access.allowed ? (
        <UpgradePrompt
          plan="pro"
          signedIn={access.reason !== "signed_out"}
          title={access.reason === "signed_out" ? "Sign in to view SDS documents" : "Monthly SDS limit reached"}
          description={
            access.reason === "signed_out"
              ? `Free accounts include ${access.limit} SDS views per month.`
              : `You've used all ${access.limit} SDS views included in the Free plan this month. Pro includes unlimited SDS access.`
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {sds.blobPathname && (
              <Button asChild>
                <a href={`/api/sds/${sds.id}/pdf`}>
                  <Download /> Download original PDF
                </a>
              </Button>
            )}
            {access.remaining !== null && (
              <span className="text-muted-foreground text-sm">{access.remaining} free SDS views left this month</span>
            )}
          </div>
          {sds.summary && (
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
                <CardDescription>AI-generated from the SDS. Always defer to the original document.</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed">{sds.summary}</CardContent>
            </Card>
          )}
          {sds.sections?.length ? (
            <div className="space-y-2">
              {SDS_SECTION_TITLES.map((title, i) => {
                const section = sds.sections?.find((s) => s.number === i + 1);
                return (
                  <details key={title} className="border-border/60 group rounded-lg border" open={i < 2}>
                    <summary className="cursor-pointer px-4 py-3 font-medium">
                      {i + 1}. {section?.title || title}
                    </summary>
                    <div className="text-muted-foreground px-4 pb-4 text-sm whitespace-pre-wrap">
                      {section?.content || "Not provided in this SDS."}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {sds.parseError ? "This SDS could not be parsed automatically." : "Section extraction is pending."} Download
              the original PDF for full details.
            </p>
          )}
        </>
      )}
    </div>
  );
}
