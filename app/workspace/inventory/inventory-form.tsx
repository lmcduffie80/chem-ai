"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { addInventoryItem, removeInventoryItem } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InventoryForm() {
  const [state, action, pending] = useActionState(addInventoryItem, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      toast.success("Added to inventory");
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-6">
      <div className="space-y-1 sm:col-span-1">
        <Label htmlFor="cas">CAS number</Label>
        <Input id="cas" name="cas" placeholder="67-64-1" />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="label">Label</Label>
        <Input id="label" name="label" placeholder="Defaults to the chemical name" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="location">Location</Label>
        <Input id="location" name="location" placeholder="Bldg 2, Cabinet A" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="quantity">Quantity</Label>
        <Input id="quantity" name="quantity" inputMode="decimal" placeholder="4" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="unit">Unit</Label>
        <Input id="unit" name="unit" placeholder="L" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-6">
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add item"}
        </Button>
        {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      </div>
    </form>
  );
}

export function RemoveInventoryButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await removeInventoryItem(id);
          if (result.error) toast.error(result.error);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
