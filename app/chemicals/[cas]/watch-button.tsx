import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { billingOwner, getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { WatchToggle } from "./watch-toggle";

export async function WatchButton({ chemicalId }: { chemicalId: number }) {
  const viewer = await getViewer();
  const owner = billingOwner(viewer);
  if (!owner) return <WatchToggle chemicalId={chemicalId} watching={false} state="signed_out" />;
  if (!can(viewer.plan, "watchlists")) return <WatchToggle chemicalId={chemicalId} watching={false} state="upgrade" />;

  const [existing] = await db
    .select({ id: schema.watchlists.id })
    .from(schema.watchlists)
    .where(
      and(
        eq(schema.watchlists.ownerType, owner.ownerType),
        eq(schema.watchlists.ownerId, owner.ownerId),
        eq(schema.watchlists.chemicalId, chemicalId),
      ),
    );
  return <WatchToggle chemicalId={chemicalId} watching={Boolean(existing)} state="ok" />;
}
