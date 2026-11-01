import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Data sources & attribution",
  description: "Where Chemspace data comes from, how often it refreshes, and how it may be used.",
};

const SOURCES = [
  {
    name: "EPA TSCA Chemical Substance Inventory (non-confidential)",
    url: "https://www.epa.gov/tsca-inventory",
    refresh: "Weekly",
    use: "CAS registry numbers, inventory names, active/inactive commercial status, UVCB and regulatory flags.",
    terms: "U.S. Government work; public domain.",
  },
  {
    name: "EPA CompTox Chemicals Dashboard (CCTE APIs)",
    url: "https://comptox.epa.gov/dashboard",
    refresh: "Daily, incremental",
    use: "DTXSID identifiers, preferred names, structures, molecular properties and synonyms.",
    terms: "U.S. Government work; public domain. Cite the CompTox Chemicals Dashboard.",
  },
  {
    name: "PubChem (NIH/NLM)",
    url: "https://pubchem.ncbi.nlm.nih.gov",
    refresh: "Daily, incremental",
    use: "GHS hazard classifications (aggregated from ECHA C&L notifications and other contributors), identity and synonyms.",
    terms: "Public data; individual depositors (e.g. ECHA) may carry their own terms, which are linked from each PubChem record.",
  },
  {
    name: "EPA Safer Chemical Ingredients List (SCIL)",
    url: "https://www.epa.gov/saferchoice/safer-ingredients",
    refresh: "Weekly",
    use: "Functional-use classes and Safer Choice status used to seed safer alternatives.",
    terms: "U.S. Government work; public domain.",
  },
  {
    name: "Regulatory lists: EPCRA §313 (TRI), CERCLA, Clean Air Act HAPs, RCRA, California Proposition 65",
    url: "https://www.epa.gov/epcra",
    refresh: "Weekly",
    use: "List membership, thresholds and change tracking for regulatory alerts.",
    terms: "Federal lists are public domain. Proposition 65 is published by California OEHHA.",
  },
  {
    name: "EPA ChemExpo — Chemicals and Products Database (CPDat)",
    url: "https://comptox.epa.gov/chemexpo/",
    refresh: "Weekly",
    use: "Consumer and commercial product formulations: product names, manufacturers, product categories and reported ingredient weight fractions, plus EPA pesticide inert-ingredient lists. Chemspace keeps every product, merging repeat filings into the newest, and uses the compositions to suggest alternate products.",
    terms:
      "U.S. Government work; public domain. EPA compiled CPDat from manufacturer SDS and ingredient disclosures, retailer data and third-party databases (e.g. EWG, SIRI). Compositions may be out of date; consult the manufacturer's current SDS.",
  },
  {
    name: "PubChem chemical vendor listings",
    url: "https://pubchem.ncbi.nlm.nih.gov/docs/vendors",
    refresh: "Weekly, on demand",
    use: "\"Where to buy\" links to supplier catalog pages, where each supplier publishes its own SDS.",
    terms: "Listings are deposited by the vendors themselves. Chemspace links to vendor pages and does not copy their SDS.",
  },
  {
    name: "Licensed SDS & supplier feed",
    url: null,
    refresh: "Daily",
    use: "Supplier profiles, products, compositions and original Safety Data Sheets.",
    terms:
      "Redistributed to subscribers under a commercial license. SDS documents remain the property of their manufacturers; always consult the original PDF.",
  },
];

export default function DataSourcesPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Data sources & attribution</h1>
        <p className="text-muted-foreground">
          Chemspace combines public regulatory and product data with links to manufacturers&apos; own SDS. Below is
          every source, how we use it, and how often it refreshes.
        </p>
      </div>

      <div className="grid gap-4">
        {SOURCES.map((s) => (
          <Card key={s.name}>
            <CardHeader>
              <CardTitle className="text-base">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </CardTitle>
              <CardDescription>Refresh: {s.refresh}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>{s.use}</p>
              <p className="text-muted-foreground">{s.terms}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="text-muted-foreground space-y-3 text-sm">
        <h2 className="text-foreground text-lg font-medium">CAS Registry Numbers®</h2>
        <p>
          CAS Registry Number® is a registered trademark of the American Chemical Society. CAS numbers shown in
          Chemspace are those published by the U.S. EPA in the public TSCA Inventory and related government datasets.
          Chemspace is not affiliated with or endorsed by CAS, a division of the American Chemical Society.
        </p>
        <h2 className="text-foreground text-lg font-medium">AI-generated content</h2>
        <p>
          SDS summaries, section extraction, natural-language search and suggested alternatives are produced with AI
          models and may contain errors. Safer-alternative suggestions are screening aids, not substitution
          recommendations. Verify suitability, performance and regulatory status before any change.
        </p>
        <h2 className="text-foreground text-lg font-medium">No warranty</h2>
        <p>
          Data is provided as-is for informational purposes. It is not a substitute for the manufacturer&apos;s SDS,
          professional judgment, or the official text of any regulation.
        </p>
      </section>
    </div>
  );
}
