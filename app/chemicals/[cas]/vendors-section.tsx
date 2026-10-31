import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getVendors } from "@/lib/vendors";

const SHOWN = 24;

export async function VendorsSection(props: { casRn: string; pubchemCid: number | null; names: string[] }) {
  const result = await getVendors(props);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Where to buy</CardTitle>
        <CardDescription>
          Suppliers listing this chemical in PubChem. Each catalog page links to that supplier&apos;s own SDS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!result ? (
          <p className="text-muted-foreground text-sm">Supplier listings are temporarily unavailable. Try again shortly.</p>
        ) : result.vendors.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No supplier listings found in PubChem.{" "}
            <a href={result.pubchemUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
              Search PubChem ↗
            </a>
          </p>
        ) : (
          <div className="space-y-3">
            <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {result.vendors.slice(0, SHOWN).map((v) => (
                <li key={v.name} className="flex items-baseline justify-between gap-2">
                  {v.url ? (
                    <a href={v.url} target="_blank" rel="noreferrer nofollow" className="truncate hover:underline">
                      {v.name} ↗
                    </a>
                  ) : (
                    <span className="truncate">{v.name}</span>
                  )}
                  {v.listings > 1 && <span className="text-muted-foreground shrink-0 text-xs">{v.listings} listings</span>}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs">
              {result.vendors.length > SHOWN && `${result.vendors.length - SHOWN} more suppliers · `}
              <a href={result.pubchemUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                All listings on PubChem ↗
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
