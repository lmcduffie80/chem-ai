import { type SQL, sql } from "drizzle-orm";

/** First segment of a "General › Family › Type" category, or "Uncategorized". */
export function generalCategory(column: SQL) {
  return sql`coalesce(nullif(split_part(coalesce(${column}, ''), ' › ', 1), ''), 'Uncategorized')`;
}
