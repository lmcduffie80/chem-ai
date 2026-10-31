import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireWorkspaceViewer } from "@/lib/workspace";
import { WorkspaceGate } from "../workspace-gate";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Members" };

export default function MembersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Members />
    </Suspense>
  );
}

async function Members() {
  const access = await requireWorkspaceViewer("/workspace/members");
  if (!access.orgId) return <WorkspaceGate access={access} feature="Member management" />;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="text-muted-foreground text-sm">
          Admins manage billing and members. Editors (Clerk&apos;s default member role) can change inventory, SDSs and the
          team watchlist. Viewers (custom <code>org:viewer</code> role) are read-only.
        </p>
      </div>
      <MembersPanel />
    </div>
  );
}
