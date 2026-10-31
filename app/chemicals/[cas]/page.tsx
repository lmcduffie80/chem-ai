import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HazardBadge, ListBadge, SaferChoiceBadge, TscaBadge } from "@/components/chem-badges";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type ChemicalDetail, getChemicalByCas } from "@/lib/chemicals";
import { describeH } from "@/lib/ghs";
import { REGULATORY_LISTS } from "@/lib/reglists-meta";
import { AlternativesSection } from "./alternatives-section";
import { WatchButton } from "./watch-button";

export async function generateMetadata({ params }: PageProps<"/chemicals/[cas]">): Promise<Metadata> {
  const { cas } = await params;
  const chem = await getChemicalByCas(decodeURIComponent(cas));
  if (!chem) return { title: "Chemical not found" };
  return {
    title: `${chem.preferredName} (CAS ${chem.casRn})`,
    description: `${chem.preferredName}, CAS ${chem.casRn}: GHS hazards, regulatory listings, SDS documents, suppliers and safer alternatives.`,
    alternates: { canonical: `/chemicals/${chem.casRn}` },
  };
}

export default function ChemicalPage({ params }: PageProps<"/chemicals/[cas]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Suspense fallback={<ChemicalSkeleton />}>
        <ChemicalContent params={params} />
      </Suspense>
    </div>
  );
}

async function ChemicalContent({ params }: Pick<PageProps<"/chemicals/[cas]">, "params">) {
  const { cas } = await params;
  const chem = await getChemicalByCas(decodeURIComponent(cas));
  if (!chem) notFound();

  return (
    <div className="space-y-8">
      <Header chem={chem} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Hazards chem={chem} />
          <Products chem={chem} />
          <Card>
            <CardHeader>
              <CardTitle>Safer alternatives</CardTitle>
              <CardDescription>
                Functional substitutes with lower hazard scores, drawn from EPA&apos;s Safer Chemical Ingredients List,
                structural similarity and AI review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<Skeleton className="h-32 w-full" />}>
                <AlternativesSection chemicalId={chem.id} casRn={chem.casRn} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Identity chem={chem} />
          <Regulatory chem={chem} />
          <Synonyms chem={chem} />
        </div>
      </div>
    </div>
  );
}

function Header({ chem }: { chem: ChemicalDetail }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="space-y-2">
        <p className="text-muted-foreground font-mono text-sm">CAS {chem.casRn}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{chem.preferredName}</h1>
        <div className="flex flex-wrap gap-1.5">
          <HazardBadge score={chem.hazardScore} />
          <TscaBadge status={chem.tscaStatus} />
          <SaferChoiceBadge status={chem.saferChoiceStatus} />
          {chem.isUvcb && <Badge variant="outline">UVCB</Badge>}
          {chem.listings.map((l) => (
            <ListBadge key={l.listCode} code={l.listCode} />
          ))}
        </div>
      </div>
      <Suspense fallback={<Skeleton className="h-9 w-32" />}>
        <WatchButton chemicalId={chem.id} />
      </Suspense>
    </div>
  );
}

function Identity({ chem }: { chem: ChemicalDetail }) {
  const rows: [string, React.ReactNode][] = [
    ["CAS RN", chem.casRn],
    ["DTXSID", chem.dtxsid ? (
      <a href={`https://comptox.epa.gov/dashboard/chemical/details/${chem.dtxsid}`} className="underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
        {chem.dtxsid}
      </a>
    ) : null],
    ["PubChem CID", chem.pubchemCid ? (
      <a href={`https://pubchem.ncbi.nlm.nih.gov/compound/${chem.pubchemCid}`} className="underline-offset-4 hover:underline" target="_blank" rel="noreferrer">
        {chem.pubchemCid}
      </a>
    ) : null],
    ["Formula", chem.molecularFormula],
    ["Mol. weight", chem.molWeight ? `${chem.molWeight.toFixed(2)} g/mol` : null],
    ["InChIKey", chem.inchikey],
    ["SMILES", chem.smiles],
    ["TSCA flags", chem.tscaFlags.length ? chem.tscaFlags.join(", ") : null],
    ["Functional use", chem.functionClasses.length ? chem.functionClasses.join(", ") : null],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Identity</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-xs break-all">{v}</dd>
              </div>
            ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Hazards({ chem }: { chem: ChemicalDetail }) {
  const hazard = chem.hazards[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>GHS hazards</CardTitle>
        <CardDescription>
          {hazard ? `Source: ${hazard.source === "pubchem" ? "PubChem (ECHA C&L aggregate)" : hazard.source}` : "Not yet assessed"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hazard ? (
          <p className="text-muted-foreground text-sm">
            No GHS classification has been loaded for this substance yet. Check the supplier SDS below.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {hazard.signalWord && (
                <Badge variant={hazard.signalWord === "Danger" ? "destructive" : "secondary"}>{hazard.signalWord}</Badge>
              )}
              {hazard.pictograms.map((p) => (
                <Badge key={p} variant="outline">
                  {p}
                </Badge>
              ))}
            </div>
            <ul className="space-y-1 text-sm">
              {hazard.hStatements.map((h) => (
                <li key={h}>
                  <span className="font-mono font-medium">{h}</span>{" "}
                  <span className="text-muted-foreground">{describeH(h)}</span>
                </li>
              ))}
            </ul>
            {hazard.pStatements.length > 0 && (
              <p className="text-muted-foreground font-mono text-xs">{hazard.pStatements.join(", ")}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Products({ chem }: { chem: ChemicalDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Products, suppliers &amp; SDS</CardTitle>
        <CardDescription>{chem.products.length} commercial products contain this substance.</CardDescription>
      </CardHeader>
      <CardContent>
        {chem.products.length === 0 ? (
          <p className="text-muted-foreground text-sm">No supplier products are linked to this CAS number yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>SDS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chem.products.map((p) => {
                const sds = chem.sdsDocuments.find((d) => d.productId === p.productId);
                return (
                  <TableRow key={p.productId}>
                    <TableCell>
                      <Link href={`/products/${p.productId}`} className="font-medium hover:underline">
                        {p.productName}
                      </Link>
                      <div className="text-muted-foreground text-xs">{[p.sku, p.grade, p.purity].filter(Boolean).join(" · ")}</div>
                    </TableCell>
                    <TableCell>
                      <Link href={`/suppliers/${p.supplierId}`} className="hover:underline">
                        {p.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.minPct !== null || p.maxPct !== null ? `${p.minPct ?? 0}–${p.maxPct ?? 100}%` : "—"}
                    </TableCell>
                    <TableCell>
                      {sds ? (
                        <Link href={`/sds/${sds.id}`} className="text-sm hover:underline">
                          {sds.revisionDate ?? "View"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function Regulatory({ chem }: { chem: ChemicalDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Regulatory listings</CardTitle>
      </CardHeader>
      <CardContent>
        {chem.listings.length === 0 ? (
          <p className="text-muted-foreground text-sm">Not on any tracked list (SARA 313, CERCLA, HAP, Prop 65, RCRA).</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {chem.listings.map((l) => (
              <li key={l.listCode}>
                <div className="font-medium">{REGULATORY_LISTS[l.listCode].label}</div>
                <div className="text-muted-foreground text-xs">
                  {Object.entries(l.details)
                    .slice(0, 4)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ")}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Synonyms({ chem }: { chem: ChemicalDetail }) {
  if (chem.synonyms.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Synonyms</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
          {chem.synonyms.map((s) => (
            <li key={s.name}>{s.name}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function ChemicalSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-2/3" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-96 lg:col-span-2" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}
