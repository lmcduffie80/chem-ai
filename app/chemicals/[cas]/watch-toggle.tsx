"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { toggleWatch } from "@/app/actions/watchlist";
import { Button } from "@/components/ui/button";

export function WatchToggle({
  chemicalId,
  watching,
  state,
  ownerType,
}: {
  chemicalId: number;
  watching: boolean;
  state: "ok" | "upgrade" | "signed_out";
  ownerType?: "user" | "org";
}) {
  const [optimistic, setOptimistic] = useOptimistic(watching);
  const [pending, startTransition] = useTransition();

  if (state !== "ok") {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href={state === "signed_out" ? "/sign-in" : "/billing?plan=pro"}>
          <Eye /> Watch for changes
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant={optimistic ? "secondary" : "outline"}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          setOptimistic(!optimistic);
          const result = await toggleWatch(chemicalId, ownerType);
          if (result.error) toast.error(result.error);
          else toast.success(result.watching ? "Added to watchlist" : "Removed from watchlist");
        })
      }
    >
      {optimistic ? <EyeOff /> : <Eye />}
      {optimistic ? "Watching" : "Watch for changes"}
    </Button>
  );
}
