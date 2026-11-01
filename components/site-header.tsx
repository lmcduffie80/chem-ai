import { FlaskConical } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AuthControls } from "@/components/auth-controls";
import { SearchBox } from "@/components/search-box";

const NAV = [
  { href: "/search", label: "Search" },
  { href: "/workspace", label: "Workspace" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs/api", label: "API" },
];

export function SiteHeader() {
  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <FlaskConical className="text-primary size-5" />
          Allochemix
        </Link>
        <nav className="text-muted-foreground hidden items-center gap-4 text-sm md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-foreground transition-colors">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden w-72 lg:block">
          <SearchBox compact />
        </div>
        <Suspense fallback={<div className="h-8 w-20" />}>
          <AuthControls />
        </Suspense>
      </div>
    </header>
  );
}
