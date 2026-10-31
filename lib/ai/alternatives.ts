import { generateText, Output } from "ai";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { textArray, vectorLiteral } from "@/db/sql";
import { embedChemicals } from "@/lib/ingest/embeddings";
import { errorMessage } from "@/lib/ingest/stats";
import { TEXT_MODEL } from "./models";

const MAX_CANDIDATES = 40;
const MAX_ALTERNATIVES = 8;

type Candidate = {
  id: number;
  cas_rn: string;
  preferred_name: string;
  function_classes: string[];
  safer_choice_status: string | null;
  hazard_score: number | null;
  h_statements: string[] | null;
  similarity: number;
  from_scil: boolean;
};

const rerankSchema = z.object({
  alternatives: z
    .array(
      z.object({
        casRn: z.string(),
        score: z.number().min(0).max(100).describe("Overall suitability as a safer drop-in substitute"),
        functionClass: z.string().nullable().describe("The shared function, e.g. Solvent, Surfactant, Chelating agent"),
        rationale: z.string().describe("Two sentences: why it can perform the same function and how its hazards compare"),
      }),
    )
    .max(MAX_ALTERNATIVES),
});

function saferChoiceWeight(status: string | null) {
  if (!status) return 0;
  if (/green circle|^green$/i.test(status)) return 1;
  if (/half|green/i.test(status)) return 0.7;
  if (/yellow/i.test(status)) return 0.3;
  return 0;
}

/** Heuristic used for pre-ranking, and as the final ranking when the LLM is unavailable. */
function heuristicScore(c: Candidate, targetHazard: number | null) {
  const delta = targetHazard !== null && c.hazard_score !== null ? targetHazard - c.hazard_score : 0;
  return 100 * (0.5 * c.similarity + 0.3 * Math.max(0, Math.min(1, delta / 50)) + 0.2 * saferChoiceWeight(c.safer_choice_status));
}

/**
 * Most hazardous targets are not on SCIL themselves, so their functional-use classes are inferred
 * from SCIL's own class vocabulary to find Safer Choice candidates with the same function.
 */
async function inferFunctionClasses(target: { casRn: string; preferredName: string }, hStatements: string[]) {
  const { rows } = await db.execute<{ fc: string }>(sql`
    select distinct unnest(function_classes) as fc from chemicals where safer_choice_status is not null order by 1
  `);
  const vocabulary = rows.map((r) => r.fc);
  if (vocabulary.length === 0) return [];
  try {
    const { output } = await generateText({
      model: TEXT_MODEL,
      output: Output.object({
        schema: z.object({ classes: z.array(z.string()).max(3).describe("Most common industrial/consumer functions") }),
      }),
      system: "You are an industrial chemist. Choose only from the allowed functional-use classes.",
      prompt: JSON.stringify({ chemical: { casRn: target.casRn, name: target.preferredName, hStatements }, allowedClasses: vocabulary }),
    });
    return output.classes.filter((c) => vocabulary.includes(c));
  } catch (error) {
    console.error("Function-class inference failed:", errorMessage(error));
    return [];
  }
}

async function loadCandidates(target: {
  id: number;
  functionClasses: string[];
  hazardScore: number | null;
  embedding: number[] | null;
}) {
  const hazardCeiling = target.hazardScore ?? 100;
  const vec = target.embedding ? vectorLiteral(target.embedding) : null;
  const fromScil = target.functionClasses.length
    ? sql`c.function_classes && ${textArray(target.functionClasses)} and c.safer_choice_status is not null`
    : sql`false`;
  const similarPool = vec
    ? sql`(select c.id from chemicals c
        where c.id <> ${target.id} and c.embedding is not null and coalesce(c.hazard_score, 0) < ${hazardCeiling}
        order by c.embedding <=> ${vec} limit 40)`
    : sql`(select null::int as id where false)`;

  const { rows } = await db.execute<Candidate>(sql`
    with pool as (
      ${similarPool}
      union
      (select c.id from chemicals c where c.id <> ${target.id} and ${fromScil}
        and coalesce(c.hazard_score, 0) < ${hazardCeiling}
        order by (c.safer_choice_status = 'Green circle') desc, c.hazard_score asc nulls last, c.id limit 60)
    )
    select c.id, c.cas_rn, c.preferred_name, c.function_classes, c.safer_choice_status, c.hazard_score,
      (select h.h_statements from hazards h where h.chemical_id = c.id limit 1) as h_statements,
      ${vec ? sql`case when c.embedding is null then 0 else 1 - (c.embedding <=> ${vec}) end` : sql`0`} as similarity,
      (${fromScil}) as from_scil
    from pool join chemicals c on c.id = pool.id
  `);
  return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
}

/** Builds (or rebuilds) the ranked alternatives for one chemical. Reviewed rows keep their review status. */
export async function generateAlternatives(chemicalId: number) {
  let [target] = await db.select().from(schema.chemicals).where(eq(schema.chemicals.id, chemicalId));
  if (!target) throw new Error(`Chemical ${chemicalId} not found`);
  if (!target.embedding) {
    try {
      await embedChemicals([chemicalId]);
      [target] = await db.select().from(schema.chemicals).where(eq(schema.chemicals.id, chemicalId));
    } catch (error) {
      console.error("Embedding failed; continuing with SCIL candidates only:", errorMessage(error));
    }
  }
  const [hazard] = await db.select().from(schema.hazards).where(eq(schema.hazards.chemicalId, chemicalId));
  const functionClasses = target.functionClasses.length
    ? target.functionClasses
    : await inferFunctionClasses(target, hazard?.hStatements ?? []);

  const candidates = (
    await loadCandidates({
      id: target.id,
      functionClasses,
      hazardScore: target.hazardScore,
      embedding: target.embedding,
    })
  )
    .map((c) => ({ ...c, heuristic: heuristicScore(c, target.hazardScore) }))
    .sort((a, b) => b.heuristic - a.heuristic)
    .slice(0, MAX_CANDIDATES);
  if (candidates.length === 0) return 0;

  const byCas = new Map(candidates.map((c) => [c.cas_rn, c]));
  let ranked: { cand: (typeof candidates)[number]; score: number; functionClass: string | null; rationale: string | null; method: "ai" | "scil" | "similarity" }[];

  try {
    const { output } = await generateText({
      model: TEXT_MODEL,
      output: Output.object({ schema: rerankSchema }),
      system:
        "You are an industrial chemist advising on safer chemical substitution. Only recommend candidates from the provided list that can plausibly perform the same function as the target. Prefer lower hazard scores, Safer Choice listings, and the absence of CMR (H340/H350/H360) and PBT/aquatic chronic statements. Omit candidates that are not credible substitutes. Score each kept candidate from 0 to 100, where 90+ is a near drop-in replacement with clearly lower hazard, 60-89 is suitable for many applications, and 30-59 needs reformulation. A candidate missing hazard data is not penalised if it is on the Safer Choice list.",
      prompt: JSON.stringify({
        target: {
          casRn: target.casRn,
          name: target.preferredName,
          functionClasses,
          hazardScore: target.hazardScore,
          hStatements: hazard?.hStatements ?? [],
        },
        candidates: candidates.map((c) => ({
          casRn: c.cas_rn,
          name: c.preferred_name,
          functionClasses: c.function_classes,
          saferChoice: c.safer_choice_status,
          hazardScore: c.hazard_score,
          hStatements: c.h_statements ?? [],
        })),
      }),
    });
    ranked = output.alternatives.flatMap((a) => {
      const cand = byCas.get(a.casRn);
      return cand ? [{ cand, score: a.score, functionClass: a.functionClass, rationale: a.rationale, method: "ai" as const }] : [];
    });
  } catch (error) {
    console.error("Alternative re-ranking failed; using heuristic ranking:", errorMessage(error));
    ranked = candidates.slice(0, MAX_ALTERNATIVES).map((cand) => ({
      cand,
      score: Math.round(cand.heuristic),
      functionClass: cand.function_classes.find((f) => functionClasses.includes(f)) ?? null,
      rationale: null,
      method: cand.from_scil ? ("scil" as const) : ("similarity" as const),
    }));
  }

  for (const r of ranked) {
    const hazardDelta =
      target.hazardScore !== null && r.cand.hazard_score !== null ? target.hazardScore - r.cand.hazard_score : null;
    await db
      .insert(schema.alternatives)
      .values({
        chemicalId,
        altChemicalId: r.cand.id,
        score: r.score,
        hazardDelta,
        functionClass: r.functionClass,
        rationale: r.rationale,
        method: r.method,
      })
      .onConflictDoUpdate({
        target: [schema.alternatives.chemicalId, schema.alternatives.altChemicalId],
        set: {
          score: r.score,
          hazardDelta,
          functionClass: r.functionClass,
          rationale: r.rationale,
          method: r.method,
          updatedAt: new Date(),
        },
      });
  }

  const keptIds = ranked.map((r) => r.cand.id);
  await db
    .delete(schema.alternatives)
    .where(
      and(
        eq(schema.alternatives.chemicalId, chemicalId),
        eq(schema.alternatives.status, "pending"),
        keptIds.length ? notInArray(schema.alternatives.altChemicalId, keptIds) : undefined,
      ),
    );
  return ranked.length;
}
