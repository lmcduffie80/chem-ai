"use client";

import { Play } from "lucide-react";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { removeSourceFile, triggerIngest, uploadSourceFile } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TriggerButton({ job }: { job: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await triggerIngest(job);
          if (result.error) toast.error(result.error);
          else toast.success(`Started ${job} (${result.runId})`);
        })
      }
    >
      <Play /> {pending ? "Starting…" : "Run now"}
    </Button>
  );
}

export function SourceUploadForm({ sources }: { sources: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState(uploadSourceFile, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <select
        name="key"
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        defaultValue=""
        required
      >
        <option value="" disabled>
          Source…
        </option>
        {sources.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <Input type="file" name="file" accept=".csv,.zip,.txt,.html,text/csv,application/zip" className="max-w-xs" required />
      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload override"}
      </Button>
      {state.error && <span className="text-destructive text-sm">{state.error}</span>}
      {state.ok && <span className="text-sm text-green-400">Uploaded. Run the job to ingest it.</span>}
    </form>
  );
}

export function RemoveSourceButton({ sourceKey }: { sourceKey: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => startTransition(() => removeSourceFile(sourceKey))}>
      Remove
    </Button>
  );
}
