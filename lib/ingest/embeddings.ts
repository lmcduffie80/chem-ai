import { embedMany } from "ai";
import { asc, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { IngestStats } from "@/db/schema";
import { vectorLiteral } from "@/db/sql";
import { EMBEDDING_MODEL } from "@/lib/ai/models";

export async function selectChemicalsToEmbed(limit: number) {
  "use step";
  const rows = await db
    .select({ id: schema.chemicals.id })
    .from(schema.chemicals)
    .where(isNull(schema.chemicals.embedding))
    .orderBy(asc(schema.chemicals.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** Text that captures what a chemical is and does, so nearest neighbours are functional analogues. */
export async function chemicalEmbeddingText(chemicalIds: number[]) {
  const rows = await db.execute<{
    id: number;
    cas_rn: string;
    preferred_name: string;
    molecular_formula: string | null;
    function_classes: string[];
    synonyms: string[] | null;
    h_statements: string[] | null;
  }>(sql`
    select c.id, c.cas_rn, c.preferred_name, c.molecular_formula, c.function_classes,
      (select array_agg(s.name) from (select name from synonyms where chemical_id = c.id limit 8) s) as synonyms,
      (select h.h_statements from hazards h where h.chemical_id = c.id limit 1) as h_statements
    from chemicals c
    where c.id in ${sql`(${sql.join(chemicalIds.map((id) => sql`${id}`), sql`, `)})`}
  `);
  return rows.rows.map((r) => ({
    id: r.id,
    text: [
      r.preferred_name,
      `CAS ${r.cas_rn}`,
      r.molecular_formula ? `Formula ${r.molecular_formula}` : null,
      r.function_classes?.length ? `Functional use: ${r.function_classes.join(", ")}` : null,
      r.synonyms?.length ? `Also known as: ${r.synonyms.join("; ")}` : null,
      r.h_statements?.length ? `GHS: ${r.h_statements.join(" ")}` : null,
    ]
      .filter(Boolean)
      .join(". "),
  }));
}

export async function embedChemicals(chemicalIds: number[]): Promise<IngestStats> {
  "use step";
  if (chemicalIds.length === 0) return { processed: 0 };
  const items = await chemicalEmbeddingText(chemicalIds);
  const { embeddings } = await embedMany({ model: EMBEDDING_MODEL, values: items.map((i) => i.text) });

  const values = sql.join(
    items.map((item, i) => sql`(${item.id}::int, ${vectorLiteral(embeddings[i])})`),
    sql`, `,
  );
  await db.execute(sql`
    update chemicals c set embedding = v.embedding, embedded_at = now()
    from (values ${values}) as v(id, embedding)
    where c.id = v.id
  `);
  return { processed: items.length, updated: items.length };
}
