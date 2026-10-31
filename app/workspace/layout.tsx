import Link from "next/link";

const NAV = [
  { href: "/workspace", label: "Overview" },
  { href: "/workspace/inventory", label: "Inventory" },
  { href: "/workspace/sds", label: "SDS library" },
  { href: "/workspace/watchlist", label: "Watchlist & alerts" },
  { href: "/workspace/api-keys", label: "API keys" },
  { href: "/workspace/members", label: "Members" },
];

export default function WorkspaceLayout({ children }: LayoutProps<"/workspace">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav className="border-border/60 mb-6 flex gap-1 overflow-x-auto border-b pb-px text-sm">
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
