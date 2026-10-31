import { apiError, withApiKey } from "@/lib/api";
import { getAlternatives, getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/alternatives/[cas]">>(async (_request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  const alternatives = await getAlternatives(chemical.id);
  return Response.json({
    data: {
      casRn: chemical.casRn,
      name: chemical.preferredName,
      hazardScore: chemical.hazardScore,
      alternatives: alternatives.map((a) => ({
        casRn: a.casRn,
        name: a.preferredName,
        score: a.score,
        hazardScore: a.hazardScore,
        hazardDelta: a.hazardDelta,
        functionClass: a.functionClass,
        saferChoiceStatus: a.saferChoiceStatus,
        rationale: a.rationale,
        method: a.method,
        reviewStatus: a.status,
      })),
    },
  });
});
