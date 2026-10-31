import { apiError, withApiKey } from "@/lib/api";
import { serializeChemical } from "@/lib/api-serializers";
import { getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/chemicals/[cas]">>(async (_request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  return Response.json({ data: serializeChemical(chemical) });
});
