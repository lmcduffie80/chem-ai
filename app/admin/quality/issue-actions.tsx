"use client";

import { useTransition } from "react";
import { setIssueStatus } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function IssueActions({ id, status }: { id: number; status: "open" | "resolved" | "ignored" }) {
  const [pending, startTransition] = useTransition();
  const set = (next: "open" | "resolved" | "ignored") => startTransition(() => setIssueStatus(id, next));
  if (status !== "open") {
    return (
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("open")}>
        Reopen
      </Button>
    );
  }
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("resolved")}>
        Resolve
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("ignored")}>
        Ignore
      </Button>
    </div>
  );
}
