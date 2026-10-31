"use client";

import { Sparkles } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { generateAlternativesAction } from "@/app/actions/alternatives";
import { Button } from "@/components/ui/button";

export function GenerateAlternativesButton({ chemicalId, hasExisting }: { chemicalId: number; hasExisting: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await generateAlternativesAction(chemicalId);
          if (result.error) toast.error(result.error);
          else toast.success(`Found ${result.count} candidate alternatives`);
        })
      }
    >
      <Sparkles />
      {pending ? "Analyzing candidates…" : hasExisting ? "Refresh with AI" : "Find safer alternatives"}
    </Button>
  );
}
