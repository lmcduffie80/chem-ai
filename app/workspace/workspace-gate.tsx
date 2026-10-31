import { UpgradePrompt } from "@/components/upgrade-prompt";
import type { WorkspaceAccess } from "@/lib/workspace";

/** Explains what's missing when the viewer has no Team+ organization selected. Returns null when access is fine. */
export function WorkspaceGate({ access, feature }: { access: WorkspaceAccess; feature: string }) {
  if (access.workspaceEnabled) return null;
  if (!access.orgId) {
    return (
      <div className="border-border bg-muted/30 space-y-2 rounded-lg border border-dashed p-5">
        <p className="font-medium">Select an organization</p>
        <p className="text-muted-foreground text-sm">
          {feature} is shared across an organization. Create or switch to one using the organization switcher in the
          header.
        </p>
      </div>
    );
  }
  return (
    <UpgradePrompt
      plan="team"
      title={`${feature} requires a Team plan`}
      description="Team adds a shared inventory, SDS library, team watchlist and regulatory alerts for everyone in your organization."
    />
  );
}
