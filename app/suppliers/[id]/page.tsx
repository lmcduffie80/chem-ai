import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSupplier } from "@/lib/chemicals";
import { CHEMEXPO_SOURCE } from "@/lib/product-sources";

export async function generateMetadata({ params }: PageProps<"/suppliers/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supplier = await getSupplier(id);
  return { title: supplier ? `${supplier.name} — supplier` : "Supplier not found" };
}

export default function SupplierPage({ params }: PageProps<"/suppliers/[id]">) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SupplierContent params={params} />
      </Suspense>
    </div>
  );
}

async function SupplierContent({ params }: Pick<PageProps<"/suppliers/[id]">, "params">) {
  const { id } = await params;
  const supplier = await getSupplier(id);
  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {supplier.kind === "database" ? "Product database" : supplier.kind === "retailer" ? "Retailer" : "Manufacturer"}
          {supplier.source === CHEMEXPO_SOURCE && " · via EPA ChemExpo"}
        </p>
        <h1 className="text-2xl font-semibold">{supplier.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          {supplier.country && <Badge variant="outline">{supplier.country}</Badge>}
          {supplier.certifications.map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </div>
        {supplier.website && (
          <a href={supplier.website} target="_blank" rel="noreferrer" className="text-sm underline-offset-4 hover:underline">
            {supplier.website}
          </a>
        )}
      </div>

      {supplier.contacts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {supplier.contacts.map((c, i) => (
                <li key={i}>
                  <span className="font-medium">{c.name ?? "Contact"}</span>
                  {c.role && <span className="text-muted-foreground"> · {c.role}</span>}
                  <div className="text-muted-foreground">{[c.email, c.phone].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Products ({supplier.products.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-border/60 divide-y">
            {supplier.products.map((p) => (
              <li key={p.id} className="py-2">
                <Link href={`/products/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
                <span className="text-muted-foreground text-sm"> {[p.sku, p.grade].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
