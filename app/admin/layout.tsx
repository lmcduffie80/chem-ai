import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePlatformAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  title: { template: "%s · Admin · Allochemix", default: "Admin" },
  robots: { index: false },
};

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/ingestion", label: "Ingestion" },
  { href: "/admin/quality", label: "Data quality" },
  { href: "/admin/alternatives", label: "Alternatives review" },
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/usage", label: "Usage" },
];

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-8"><Skeleton className="h-96 w-full" /></div>}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}

async function AdminShell({ children }: { children: React.ReactNode }) {
  // Gate the whole section, including nav chrome, so non-admins get a plain 404.
  await requirePlatformAdmin();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="border-border/60 mb-6 flex items-center gap-1 overflow-x-auto border-b pb-px text-sm">
        <span className="text-primary mr-3 font-semibold">Admin</span>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="text-muted-foreground hover:text-foreground rounded-t-md px-3 py-2 whitespace-nowrap"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
