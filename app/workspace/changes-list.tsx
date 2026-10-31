import Link from "next/link";
import { ListBadge } from "@/components/chem-badges";
import type { RegulatoryListCode } from "@/db/schema";

type Change = {
  id: number;
  listCode: RegulatoryListCode;
  changeType: "added" | "removed" | "updated";
  detectedAt: Date;
  casRn: string;
  name: string;
};

const VERB = { added: "added to", removed: "removed from", updated: "updated on" } as const;

export function ChangesList({ changes }: { changes: Change[] }) {
  if (changes.length === 0) {
    return <p className="text-muted-foreground text-sm">No changes detected yet. We check regulatory lists weekly.</p>;
  }
  return (
    <ul className="divide-border/60 divide-y text-sm">
      {changes.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
          <Link href={`/chemicals/${c.casRn}`} className="font-medium hover:underline">
            {c.name}
          </Link>
          <span className="text-muted-foreground">{VERB[c.changeType]}</span>
          <ListBadge code={c.listCode} />
          <span className="text-muted-foreground ml-auto text-xs">
            {c.detectedAt.toLocaleDateString("en-US", { dateStyle: "medium" })}
          </span>
        </li>
      ))}
    </ul>
  );
}
