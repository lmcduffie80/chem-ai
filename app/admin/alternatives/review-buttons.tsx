"use client";

import { useTransition } from "react";
import { reviewAlternative } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";

export function ReviewButtons({ id, status }: { id: number; status: "pending" | "approved" | "rejected" }) {
  const [pending, startTransition] = useTransition();
  const set = (next: "pending" | "approved" | "rejected") => startTransition(() => reviewAlternative(id, next));
  return (
    <div className="flex items-start gap-1">
      {status !== "approved" && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => set("approved")}>
          Approve
        </Button>
      )}
      {status !== "rejected" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("rejected")}>
          Reject
        </Button>
      )}
      {status !== "pending" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => set("pending")}>
          Reset
        </Button>
      )}
    </div>
  );
}
