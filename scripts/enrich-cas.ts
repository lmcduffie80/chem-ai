import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchGhsBatch } from "@/lib/ingest/pubchem";

// Usage: pnpm enrich:cas 67-64-1 71-43-2 ...   (PubChem identity, synonyms and GHS for specific CAS numbers)
async function main() {
  const casList = process.argv.slice(2);
  if (casList.length === 0) throw new Error("Pass one or more CAS numbers");
  const rows = await db
    .select({ id: schema.chemicals.id })
    .from(schema.chemicals)
    .where(inArray(schema.chemicals.casRn, casList));
  for (let i = 0; i < rows.length; i += 25) {
    console.log(await fetchGhsBatch(rows.slice(i, i + 25).map((r) => r.id)));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
