import type { RegulatoryListCode } from "@/db/schema";
import { apiError, withApiKey } from "@/lib/api";
import { REGULATORY_LIST_CODES } from "@/lib/reglists-meta";
import { searchChemicals } from "@/lib/search";

function listParam(value: string | null) {
  if (!value) return undefined;
  const codes = value.split(",").map((s) => s.trim().toUpperCase());
  const invalid = codes.filter((c) => !REGULATORY_LIST_CODES.includes(c as RegulatoryListCode));
  if (invalid.length) throw new RangeError(`Unknown list code(s): ${invalid.join(", ")}`);
  return codes as RegulatoryListCode[];
}

export const GET = withApiKey(async (request) => {
  const query = new URL(request.url).searchParams;
  const q = query.get("q") ?? "";
  const limit = Math.min(Math.max(Number(query.get("limit") ?? 25) || 25, 1), 100);
  const offset = Math.max(Number(query.get("offset") ?? 0) || 0, 0);

  let lists, excludeLists;
  try {
    lists = listParam(query.get("lists"));
    excludeLists = listParam(query.get("excludeLists"));
  } catch (error) {
    return apiError(400, "invalid_parameter", (error as Error).message);
  }
  const maxHazard = query.get("maxHazardScore");
  const filters = {
    lists,
    excludeLists,
    maxHazardScore: maxHazard !== null && maxHazard !== "" ? Number(maxHazard) : undefined,
    functionClass: query.get("functionClass") ?? undefined,
    tscaActiveOnly: query.get("tscaActiveOnly") === "true",
  };
  if (!q && !filters.lists?.length && !filters.functionClass) {
    return apiError(400, "invalid_parameter", "Provide `q`, `lists` or `functionClass`.");
  }

  const results = await searchChemicals(q, filters, limit, offset);
  return Response.json({
    data: results.map((r) => ({
      casRn: r.casRn,
      name: r.preferredName,
      molecularFormula: r.molecularFormula,
      hazardScore: r.hazardScore,
      tscaStatus: r.tscaStatus,
      saferChoiceStatus: r.saferChoiceStatus,
      regulatoryLists: r.lists,
    })),
    pagination: { limit, offset, nextOffset: results.length === limit ? offset + limit : null },
  });
});
