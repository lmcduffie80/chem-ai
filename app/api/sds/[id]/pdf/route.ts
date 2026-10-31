import { get } from "@vercel/blob";
import { getViewer } from "@/lib/auth";
import { getSdsDocument } from "@/lib/chemicals";
import { consumeSdsView } from "@/lib/usage";

export async function GET(_request: Request, { params }: RouteContext<"/api/sds/[id]/pdf">) {
  const { id } = await params;
  const sds = await getSdsDocument(id);
  if (!sds?.blobPathname) return new Response("Not found", { status: 404 });

  const viewer = await getViewer();
  if (sds.orgId && sds.orgId !== viewer.orgId) return new Response("Not found", { status: 404 });

  const access = sds.orgId ? ({ allowed: true } as const) : await consumeSdsView(viewer, sds.id);
  if (!access.allowed) {
    return new Response(access.reason === "signed_out" ? "Sign in required" : "Monthly SDS limit reached", {
      status: access.reason === "signed_out" ? 401 : 402,
    });
  }

  const blob = await get(sds.blobPathname, { access: "private" });
  if (!blob || blob.statusCode !== 200) return new Response("Not found", { status: 404 });

  const filename = `${(sds.productName ?? "sds").replace(/[^\w.-]+/g, "_")}.pdf`;
  return new Response(blob.stream, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
