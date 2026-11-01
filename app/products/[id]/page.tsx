import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HazardBadge } from "@/components/chem-badges";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProduct } from "@/lib/chemicals";
import { CHEMEXPO_SOURCE, formatPctRange, manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";
import { AlternatesSection } from "./alternates-section";

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  return { title: product ? `${product.name} — ${product.supplier.name}` : "Product not found" };
}

export default function ProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ProductContent params={params} />
      </Suspense>
    </div>
  );
}

async function ProductContent({ params }: Pick<PageProps<"/products/[id]">, "params">) {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">
          {supplierRoleLabel(product.supplier.kind)}{" "}
          <Link href={`/suppliers/${product.supplier.id}`} className="hover:underline">
            {product.supplier.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">{product.name}</h1>
        <p className="text-muted-foreground text-sm">
          {[
            product.category,
            product.sku && `SKU ${product.sku}`,
            product.grade,
            product.purity,
            product.documentDate && `Document dated ${product.documentDate}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {product.description && <p className="text-sm">{product.description}</p>}
        {product.source === CHEMEXPO_SOURCE && (
          <p className="text-muted-foreground text-xs">
            Composition reported to{" "}
            <a href={product.sourceUrl ?? "https://comptox.epa.gov/chemexpo/"} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              EPA ChemExpo (CPDat) ↗
            </a>{" "}
            by {product.supplier.name}. Formulations change; confirm against the manufacturer&apos;s current SDS.
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Composition</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>CAS</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Hazard</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.components.map((c, i) => (
                <TableRow key={i}>
                  <TableCell>{c.chemicalName ?? c.componentName ?? c.casRn ?? "Unnamed ingredient"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.casRn ? (
                      <Link href={`/chemicals/${c.casRn}`} className="hover:underline">
                        {c.casRn}
                      </Link>
                    ) : (
                      "Proprietary"
                    )}
                  </TableCell>
                  <TableCell>{formatPctRange(c.minPct, c.maxPct)}</TableCell>
                  <TableCell>
                    <HazardBadge score={c.hazardScore} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <AlternatesSection productId={product.id} />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Safety data sheets</CardTitle>
        </CardHeader>
        <CardContent>
          {product.sdsDocuments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Allochemix doesn&apos;t hold a copy of this SDS.{" "}
              <a
                href={manufacturerSdsSearchUrl(product.name, product.supplier.name, product.supplier.kind)}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline-offset-4 hover:underline"
              >
                Find the manufacturer&apos;s SDS ↗
              </a>
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {product.sdsDocuments.map((d) => (
                <li key={d.id}>
                  <Link href={`/sds/${d.id}`} className="hover:underline">
                    {d.revisionDate ? `Revision ${d.revisionDate}` : "SDS"} · {d.language.toUpperCase()} · {d.region}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
