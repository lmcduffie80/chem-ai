/** Prints database and largest-table sizes.  pnpm db:size */
import { sql } from "drizzle-orm";
import { db } from "../db";

async function main() {
  const { rows } = await db.execute(sql`
    select 'database' as name, pg_size_pretty(pg_database_size(current_database())) as size
    union all
    select relname, pg_size_pretty(pg_total_relation_size(relid))
    from (select relid, relname from pg_catalog.pg_statio_user_tables
          order by pg_total_relation_size(relid) desc limit 6) t
  `);
  console.table(rows);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
