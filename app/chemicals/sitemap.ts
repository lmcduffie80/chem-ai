import { asc, count } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { cacheLife } from "next/cache";
import { db, schema } from "@/db";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://allochemix.com";
const PER_SITEMAP = 50_000;

export async function generateSitemaps() {
  "use cache";
  cacheLife("days");
  const [{ total }] = await db.select({ total: count() }).from(schema.chemicals);
  return Array.from({ length: Math.max(1, Math.ceil(total / PER_SITEMAP)) }, (_, id) => ({ id }));
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  "use cache";
  cacheLife("days");
  const page = Number(await props.id);
  const rows = await db
    .select({ casRn: schema.chemicals.casRn, updatedAt: schema.chemicals.updatedAt })
    .from(schema.chemicals)
    .orderBy(asc(schema.chemicals.id))
    .limit(PER_SITEMAP)
    .offset(page * PER_SITEMAP);
  return rows.map((r) => ({ url: `${BASE_URL}/chemicals/${r.casRn}`, lastModified: r.updatedAt }));
}
