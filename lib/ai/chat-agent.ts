import { embed, type InferAgentUIMessage, isStepCount, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { REGULATORY_LIST_CODES, REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";
import { type SearchFilters, type SearchResult, asLists, searchChemicals, searchProducts, semanticSearch } from "@/lib/search";
import { EMBEDDING_MODEL, TEXT_MODEL } from "./models";

const listEnum = z.enum(REGULATORY_LIST_CODES as [string, ...string[]]);
const HAZARD_CEILING = { any: undefined, low: 14, moderate: 39 } as const;

const findChemicals = tool({
  description:
    "Look up chemicals in the Allochemix database. Pass several short queries at once: specific chemical names " +
    "(e.g. 'atrazine', 'S-metolachlor'), CAS numbers, or short class phrases (e.g. 'nonionic surfactant'). " +
    "Returns only real database records.",
  inputSchema: z.object({
    queries: z.array(z.string().min(1)).min(1).max(8).describe("Short chemical names, CAS numbers or class phrases"),
    agChem: z.boolean().describe("Limit to agricultural / pesticide chemistry"),
    maxHazard: z.enum(["any", "low", "moderate"]).describe("Hazard ceiling; use 'any' unless the customer cares"),
    excludeLists: z.array(listEnum).describe("Regulatory lists the customer wants to avoid"),
  }),
  execute: async ({ queries, agChem, maxHazard, excludeLists }) => {
    const filters: SearchFilters = {
      agChem,
      maxHazardScore: HAZARD_CEILING[maxHazard],
      excludeLists: excludeLists as RegulatoryListCode[],
    };
    const semantic = embed({ model: EMBEDDING_MODEL, value: queries.join(", ") })
      .then(({ embedding }) => semanticSearch(embedding, filters, 6))
      .catch((error: unknown) => {
        console.warn("chat: semantic search unavailable, using keyword results only", error);
        return [];
      });
    const keywordHits = await Promise.all(queries.map((q) => searchChemicals(q, filters, 3)));
    const seen = new Set<number>();
    const merged: SearchResult[] = [];
    for (const r of [...keywordHits.flat(), ...(await semantic)]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    return merged.slice(0, 16).map((r) => ({
      name: r.preferredName,
      cas: r.casRn,
      hazardScore: r.hazardScore,
      tscaStatus: r.tscaStatus,
      saferChoice: r.saferChoiceStatus,
      lists: asLists(r.lists),
      url: `/chemicals/${r.casRn}`,
    }));
  },
});

const findProducts = tool({
  description:
    "Search commercial products (formulations) by product name, maker or use. " +
    "Use agChem to restrict to agriculture and pesticide products.",
  inputSchema: z.object({
    query: z.string().describe("Product name, maker or use keywords; may be empty when agChem is true"),
    agChem: z.boolean().describe("Limit to agricultural / pesticide products"),
  }),
  execute: async ({ query, agChem }) => {
    const { total, results } = await searchProducts(query, 8, 0, { agChem });
    return {
      total,
      products: results.map((p) => ({
        name: p.name,
        maker: p.maker,
        category: p.category,
        url: `/products/${p.id}`,
      })),
    };
  },
});

export const chemChatAgent = new ToolLoopAgent({
  model: TEXT_MODEL,
  instructions: [
    "You are the Allochemix sales assistant. Users are reps at chemical and agricultural distributors.",
    "They describe a customer's need (crop, pest or weed, application, process, constraints) and you work out",
    "which chemicals and products they could offer.",
    "",
    "How to work:",
    "1. Use your own knowledge to list the active ingredients or chemistries that typically address the need",
    "   (e.g. for pre-emergent waterhemp in corn: atrazine, S-metolachlor, acetochlor, mesotrione, pyroxasulfone).",
    "2. Look them up with findChemicals in one call (pass the names as separate queries). Use findProducts to find",
    "   formulations by an active ingredient name or brand when the user wants products.",
    "3. Recommend only chemicals and products the tools returned; never invent names, CAS numbers or products.",
    "   If something you expected is not in the database, say it was not found rather than dropping it silently.",
    "",
    "Rules:",
    "- The database has identity, hazard and regulatory data, not efficacy or label data. When you say why something fits,",
    "  make clear it is general agronomic knowledge to verify, not a database fact.",
    "- If the need is unclear, ask one or two short clarifying questions (crop, target pest, application method, regulatory limits).",
    "- Use agChem=true for crop protection, fertilizer, adjuvant or other farm needs.",
    "- For each recommendation give the name, CAS (or maker for products) and one line on why it fits.",
    "- Mention relevant hazard or regulatory flags from the results. Remind the user to confirm EPA/state registration,",
    "  the product label and the SDS before selling; the label is the law.",
    "- Write plain text with short '-' bullets. No markdown tables, headings or bold. Keep answers brief.",
    "",
    "Regulatory list codes you may see:",
    ...REGULATORY_LIST_CODES.map((c) => `- ${c}: ${REGULATORY_LISTS[c].label}`),
  ].join("\n"),
  tools: { findChemicals, findProducts },
  stopWhen: isStepCount(8),
});

export type ChemChatMessage = InferAgentUIMessage<typeof chemChatAgent>;
