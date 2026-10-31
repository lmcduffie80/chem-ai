import { type SQL, sql } from "drizzle-orm";

/** Drizzle expands JS arrays into parameter lists, so build an explicit Postgres text[] instead. */
export function textArray(values: string[]): SQL {
  if (values.length === 0) return sql`'{}'::text[]`;
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

export function vectorLiteral(values: number[]): SQL {
  return sql`${`[${values.join(",")}]`}::vector`;
}
