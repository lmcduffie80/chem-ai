import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type Alternate, getProductAlternates } from "@/lib/alternates/query";
import { manufacturerSdsSearchUrl, supplierRoleLabel } from "@/lib/product-sources";

const SHARED_CHIPS = 6;

export async function AlternatesSection({ productId }: { productId: string }) {
  const result = await getProductAlternates(productId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alternates</CardTitle>
        <CardDescription>Other products containing the same ingredients, closest formulation first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {result.status === "unavailable" ? (
          <p className="text-muted-foreground text-sm">Alternates are temporarily unavailable. Try again in a few minutes.</p>
        ) : result.status === "no_ingredients" ? (
          <p className="text-muted-foreground text-sm">
            We can&apos;t match this product because none of its ingredients are on the TSCA inventory.
          </p>
        ) : result.close.length + result.partial.length === 0 ? (
          <p className="text-muted-foreground text-sm">No other products in the catalog share this product&apos;s ingredients.</p>
        ) : (
          <>
            <AlternatesTable title="Close matches" rows={result.close} sourceCount={result.sourceCount} />
            <AlternatesTable title="Partial matches" rows={result.partial} sourceCount={result.sourceCount} />
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Based on formulations reported to EPA. Confirm against the manufacturer&apos;s current SDS before switching.
        </p>
      </CardContent>
    </Card>
  );
}

function AlternatesTable({ title, rows, sourceCount }: { title: string; rows: Alternate[]; sourceCount: number }) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} ({rows.length})
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Match</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Maker / source</TableHead>
            <TableHead>Shared ingredients</TableHead>
            <TableHead>SDS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id}>
              <TableCell
                className="font-medium tabular-nums"
                title={`Shares ${a.sharedCount} of ${sourceCount} ingredients; weighted by reported amounts and how common each ingredient is`}
              >
                {Math.round(a.score * 100)}%
              </TableCell>
              <TableCell className="max-w-xs min-w-48 whitespace-normal">
                <Link href={`/products/${a.id}`} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {[a.category, a.documentDate?.slice(0, 4)].filter(Boolean).join(" · ")}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="text-muted-foreground text-xs">{supplierRoleLabel(a.makerKind)} </span>
                <Link href={`/suppliers/${a.makerId}`} className="hover:underline">
                  {a.maker}
                </Link>
              </TableCell>
              <TableCell className="max-w-sm min-w-48 whitespace-normal">
                <div className="flex flex-wrap items-center gap-1">
                  {a.shared.slice(0, SHARED_CHIPS).map((s) => (
                    <Badge key={s.casRn} variant="secondary" className="font-normal">
                      {s.name}
                    </Badge>
                  ))}
                  {a.shared.length > SHARED_CHIPS && (
                    <span className="text-muted-foreground text-xs">+{a.shared.length - SHARED_CHIPS} shared</span>
                  )}
                  {a.addedCount > 0 && <span className="text-muted-foreground text-xs">+{a.addedCount} other</span>}
                </div>
              </TableCell>
              <TableCell>
                {a.sdsId ? (
                  <Link href={`/sds/${a.sdsId}`} className="text-sm hover:underline">
                    SDS
                  </Link>
                ) : (
                  <a
                    href={manufacturerSdsSearchUrl(a.name, a.maker, a.makerKind)}
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
    </div>
  );
}
