import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-border/60 text-muted-foreground border-t py-8 text-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 md:flex-row md:items-center md:justify-between">
        <p>
          Chemical identity and regulatory data from U.S. EPA (TSCA Inventory, CompTox, Safer Choice) and NIH PubChem.
          Not a substitute for the manufacturer&apos;s SDS.
        </p>
        <nav className="flex gap-4">
          <Link href="/data-sources" className="hover:text-foreground">
            Data sources &amp; licensing
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/docs/api" className="hover:text-foreground">
            API
          </Link>
        </nav>
      </div>
    </footer>
  );
}
