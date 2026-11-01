import { sql } from "drizzle-orm";
import { ArrowLeftRight, Building2, Leaf, Scale, Search, Webhook } from "lucide-react";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { SearchBox } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { db } from "@/db";

const FEATURES = [
  { icon: Search, title: "Every EPA-registered CAS", body: "The full TSCA inventory, enriched with EPA CompTox and PubChem identity data and synonyms." },
  {
    icon: ArrowLeftRight,
    title: "Alternate products",
    body: "Products with the same ingredients, ranked by how closely the formulation matches, with a side-by-side comparison.",
  },
  { icon: Building2, title: "Makers, suppliers and SDS", body: "Who makes and sells each product, with a link to the manufacturer's current SDS." },
  { icon: Leaf, title: "Safer alternatives", body: "Functional substitutes ranked by hazard reduction, Safer Choice status and AI review." },
  { icon: Scale, title: "Regulatory tracking", body: "SARA 313, CERCLA, HAP, Prop 65 and RCRA listings with change alerts on your watchlist." },
  { icon: Webhook, title: "API for your systems", body: "Pull product, chemical and SDS data into ERP, procurement and EHS tools." },
];

async function Stats() {
  "use cache";
  cacheLife("hours");
  const { rows } = await db.execute<{ chemicals: number; sds: number; suppliers: number }>(sql`
    select (select count(*)::int from chemicals) as chemicals,
           (select count(*)::int from sds_documents) as sds,
           (select count(*)::int from suppliers) as suppliers`);
  const stats = rows[0];
  return (
    <dl className="grid grid-cols-3 gap-6 text-center">
      {[
        ["Chemical substances", stats.chemicals],
        ["Safety data sheets", stats.sds],
        ["Suppliers", stats.suppliers],
      ].map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{Number(value).toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4">
      <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 py-20 text-center">
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Find alternate chemical products by what&apos;s in them</h1>
        <p className="text-muted-foreground text-lg">
          Look up any CAS number registered with the EPA. See the products that contain it, alternate products with the
          same ingredients, who makes them, their SDS, hazards and regulatory listings — for procurement, EHS and product
          teams.
        </p>
        <div className="w-full max-w-2xl">
          <SearchBox />
        </div>
        <p className="text-muted-foreground text-sm">
          Try{" "}
          {["67-64-1", "Formaldehyde", "Trichloroethylene", "Sodium hydroxide"].map((q, i) => (
            <span key={q}>
              {i > 0 && ", "}
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="text-foreground underline-offset-4 hover:underline">
                {q}
              </Link>
            </span>
          ))}
        </p>
      </section>

      <section className="border-border/60 mx-auto max-w-3xl border-y py-8">
        <Stats />
      </section>

      <section className="grid gap-6 py-16 md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="border-border/60 rounded-lg border p-5">
            <Icon className="text-primary mb-3 size-5" />
            <h3 className="font-medium">{title}</h3>
            <p className="text-muted-foreground mt-1 text-sm">{body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col items-center gap-4 pb-20 text-center">
        <h2 className="text-2xl font-semibold">Built for teams</h2>
        <p className="text-muted-foreground max-w-xl">
          Shared SDS libraries, site inventories, watchlists with regulatory alerts, and an API on Enterprise, for
          purchasing and safety teams alike.
        </p>
        <Button asChild>
          <Link href="/pricing">See plans</Link>
        </Button>
      </section>
    </div>
  );
}
