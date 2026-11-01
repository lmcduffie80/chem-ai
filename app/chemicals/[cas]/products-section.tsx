import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getChemicalProducts, PRODUCTS_PAGE_SIZE, productTotal } from "@/lib/chemical-products";
import type { ChemicalDetail } from "@/lib/chemicals";
import { formatPctRange, manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";

type Props = {
  chemicalId: number;
  casRn: string;
  categories: ChemicalDetail["productCategories"];
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function ProductsSection({ chemicalId, casRn, categories, searchParams }: Props) {
  const params = await searchParams;
  const category = typeof params.category === "string" && params.category ? params.category : null;
  const page = Math.max(1, Number.parseInt(typeof params.page === "string" ? params.page : "1", 10) || 1);
  const products = await getChemicalProducts(chemicalId, category, page);
  const total = Math.max(productTotal(categories, category), (page - 1) * PRODUCTS_PAGE_SIZE + products.length);
  const pages = Math.max(1, Math.ceil(total / PRODUCTS_PAGE_SIZE));

  const href = (next: { category?: string | null; page?: number }) => {
    const q = new URLSearchParams();
    const c = next.category === undefined ? category : next.category;
    if (c) q.set("category", c);
    if ((next.page ?? 1) > 1) q.set("page", String(next.page));
    const query = q.toString();
    return `/chemicals/${casRn}${query ? `?${query}` : ""}#products`;
  };

  return (
    <Card id="products">
      <CardHeader>
        <CardTitle>Products containing this chemical</CardTitle>
        <CardDescription>
          {total === 0
            ? "No products in the Chemspace catalog list this ingredient yet."
            : `${total.toLocaleString()} products${category ? ` in ${category}` : ""}, highest share first. Open a product to see its alternates.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Link href={href({ category: null })}>
              <Badge variant={category ? "outline" : "default"} className="font-normal">
                All
              </Badge>
            </Link>
            {categories.map((c) => (
              <Link key={`${c.source}:${c.category}`} href={href({ category: c.category })}>
                <Badge variant={category === c.category ? "default" : "secondary"} className="font-normal">
                  {c.category} · {c.productCount.toLocaleString()}
                </Badge>
              </Link>
            ))}
          </div>
        )}
        {products.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {total === 0
              ? "Product listings come from EPA ChemExpo and supplier SDS feeds. See “Where to buy” for suppliers selling this chemical, or upload your own SDS in a Team workspace."
              : "No products on this page."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Maker / source</TableHead>
                <TableHead>Share</TableHead>
                <TableHead>SDS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-xs min-w-48 whitespace-normal">
                    <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {[p.category, p.documentDate?.slice(0, 4)].filter(Boolean).join(" · ")}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="text-muted-foreground text-xs">{supplierRoleLabel(p.supplierKind)} </span>
                    <Link href={`/suppliers/${p.supplierId}`} className="hover:underline">
                      {p.supplierName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {p.minPct === null && p.maxPct === null && p.weight === 1 ? "100%" : formatPctRange(p.minPct, p.maxPct)}
                  </TableCell>
                  <TableCell>
                    {p.sdsId ? (
                      <Link href={`/sds/${p.sdsId}`} className="text-sm hover:underline">
                        {p.sdsRevisionDate ?? "View"}
                      </Link>
                    ) : (
                      <a
                        href={manufacturerSdsSearchUrl(p.name, p.supplierName, p.supplierKind)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm whitespace-nowrap underline-offset-4 hover:underline"
                      >
                        Find SDS ↗
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            {page > 1 ? <Link href={href({ page: page - 1 })} className="hover:underline">← Previous</Link> : <span />}
            <span className="text-muted-foreground">
              Page {page.toLocaleString()} of {pages.toLocaleString()}
            </span>
            {page < pages ? <Link href={href({ page: page + 1 })} className="hover:underline">Next →</Link> : <span />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
