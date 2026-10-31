"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { deleteUploadedSds, uploadSds } from "@/app/actions/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SdsUploadForm() {
  const [state, action, pending] = useActionState(uploadSds, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      toast.success("Uploaded. Sections will be extracted in about a minute.");
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="file">PDF</Label>
        <Input id="file" name="file" type="file" accept="application/pdf" required />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" placeholder="Defaults to the file name" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      </div>
    </form>
  );
}

export function DeleteSdsButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Delete"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!confirm("Delete this SDS for everyone in your organization?")) return;
          const result = await deleteUploadedSds(id);
          if (result.error) toast.error(result.error);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
