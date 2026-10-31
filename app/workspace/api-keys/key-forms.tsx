"use client";

import { Copy } from "lucide-react";
import { useActionState, useTransition } from "react";
import { toast } from "sonner";
import { createApiKey, revokeApiKey } from "@/app/actions/api-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CreateKeyForm() {
  const [state, action, pending] = useActionState(createApiKey, {});
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <Input name="name" placeholder="e.g. ERP integration" className="max-w-xs" required />
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </form>
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      {state.key && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-200">Copy this key now. You won&apos;t be able to see it again.</p>
          <div className="flex items-center gap-2">
            <code className="bg-background/60 flex-1 overflow-x-auto rounded px-2 py-1 text-xs">{state.key}</code>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Copy key"
              onClick={() => navigator.clipboard.writeText(state.key!).then(() => toast.success("Copied"))}
            >
              <Copy />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RevokeKeyButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (!confirm("Revoke this key? Requests using it will fail immediately.")) return;
          const result = await revokeApiKey(id);
          if (result.error) toast.error(result.error);
          else toast.success("Key revoked");
        })
      }
    >
      Revoke
    </Button>
  );
}
