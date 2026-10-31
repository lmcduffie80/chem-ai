import { apiError, withApiKey } from "@/lib/api";
import { getSdsDocument } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/sds/[id]">>(async (_request, api, { params }) => {
  const { id } = await params;
  const sds = await getSdsDocument(id);
  if (!sds || (sds.orgId && sds.orgId !== api.orgId)) return apiError(404, "not_found", "SDS not found.");
  return Response.json({
    data: {
      id: sds.id,
      title: sds.productName ?? sds.title,
      supplier: sds.supplierId ? { id: sds.supplierId, name: sds.supplierName } : null,
      revisionDate: sds.revisionDate,
      language: sds.language,
      region: sds.region,
      summary: sds.summary,
      sections: sds.sections ?? [],
      parsedAt: sds.parsedAt,
    },
  });
});
