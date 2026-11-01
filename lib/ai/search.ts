import { embed, generateText, Output } from "ai";
import { z } from "zod";
import { billingOwner, type Viewer } from "@/lib/auth";
import { normalizeCas } from "@/lib/cas";
import { REGULATORY_LIST_CODES, REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";
import { type SearchFilters, type SearchResult, searchChemicals, semanticSearch } from "@/lib/search";
import { recordUsage } from "@/lib/usage";
import { EMBEDDING_MODEL, SEARCH_MODEL } from "./models";

const listEnum = z.enum(REGULATORY_LIST_CODES as [string, ...string[]]);

const querySchema = z.object({
  interpretation: z.string().describe("One sentence restating what the user is looking for"),
  keywords: z.string().describe("Chemical name(s) or class keywords for text search; empty if none"),
  casNumbers: z.array(z.string()).describe("Any CAS numbers mentioned"),
  includeLists: z.array(listEnum).describe("Regulatory lists results MUST be on"),
  excludeLists: z.array(listEnum).describe("Regulatory lists results must NOT be on"),
  maxHazard: z.enum(["any", "low", "moderate"]).describe("Hazard ceiling requested by the user"),
  functionClass: z.string().nullable().describe("Functional use class such as Solvents or Surfactants, if stated"),
});

const HAZARD_CEILING = { any: undefined, low: 14, moderate: 39 } as const;

export async function aiSearch(question: string, base: SearchFilters, viewer: Viewer) {
  const owner = billingOwner(viewer);
  if (owner) await recordUsage({ ...owner, kind: "ai_search", userId: viewer.userId, path: "/search" });

  const [{ output }, { embedding }] = await Promise.all([
    generateText({
      model: SEARCH_MODEL,
      output: Output.object({ schema: querySchema }),
      system: [
        "You translate chemical-database questions into structured search filters.",
        "Available regulatory lists:",
        ...REGULATORY_LIST_CODES.map((c) => `- ${c}: ${REGULATORY_LISTS[c].description}`),
      ].join("\n"),
      prompt: question,
    }),
    embed({ model: EMBEDDING_MODEL, value: question }),
  ]);

  const filters: SearchFilters = {
    ...base,
    lists: [...(base.lists ?? []), ...(output.includeLists as RegulatoryListCode[])],
    excludeLists: output.excludeLists as RegulatoryListCode[],
    maxHazardScore: HAZARD_CEILING[output.maxHazard] ?? base.maxHazardScore,
    functionClass: output.functionClass ?? undefined,
  };

  const casHits = (
    await Promise.all(
      output.casNumbers.flatMap((c) => {
        const cas = normalizeCas(c);
        return cas ? [searchChemicals(cas, {}, 1)] : [];
      }),
    )
  ).flat();
  const [keywordHits, semanticHits] = await Promise.all([
    output.keywords ? searchChemicals(output.keywords, filters, 25) : Promise.resolve([]),
    semanticSearch(embedding, filters, 25),
  ]);

  const seen = new Set<number>();
  const results: SearchResult[] = [];
  for (const r of [...casHits, ...keywordHits, ...semanticHits]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    results.push(r);
  }
  return { interpretation: output.interpretation, results: results.slice(0, 40) };
}
