import Link from "next/link";
import { getViewer } from "@/lib/auth";

const NAV = [
  { href: "/workspace", label: "Overview" },
  { href: "/workspace/inventory", label: "Inventory" },
  { href: "/workspace/sds", label: "SDS library" },
  { href: "/workspace/watchlist", label: "Watchlist & alerts" },
  { href: "/workspace/api-keys", label: "API keys" },
  { href: "/workspace/members", label: "Members", adminOnly: true },
] as const;

export default async function WorkspaceLayout({ children }: LayoutProps<"/workspace">) {
  const viewer = await getViewer();
  const items = NAV.filter((item) => !("adminOnly" in item && item.adminOnly) || viewer.orgRole === "admin");

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="border-border/60 mb-6 flex gap-1 overflow-x-auto border-b pb-px text-sm">
        {items.map((item) => (
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
