import { billingOwner, getViewer } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { recordUsage } from "@/lib/usage";
import { getInventory, getWatchlist } from "@/lib/workspace";

function csv(rows: (string | number | null | undefined)[][]) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = v === null || v === undefined ? "" : String(v);
          // Neutralise spreadsheet formula injection as well as quoting.
          const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(","),
    )
    .join("\n");
}

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer.userId) return new Response("Sign in required", { status: 401 });
  if (!can(viewer.plan, "exports")) return new Response("Exports require a Pro plan", { status: 402 });

  const type = new URL(request.url).searchParams.get("type");
  let body: string;
  if (type === "inventory") {
    if (!viewer.orgId || !can(viewer.orgPlan, "workspace")) return new Response("Team plan required", { status: 402 });
    const items = await getInventory(viewer.orgId);
    body = csv([
      ["label", "cas_rn", "chemical_name", "location", "quantity", "unit", "hazard_score", "regulatory_lists", "notes"],
      ...items.map(({ item, casRn, chemicalName, hazardScore, listCodes }) => [
        item.label,
        casRn,
        chemicalName,
        item.location,
        item.quantity,
        item.unit,
        hazardScore,
        listCodes.join(";"),
        item.notes,
      ]),
    ]);
  } else if (type === "watchlist") {
    const items = await getWatchlist(viewer);
    body = csv([
      ["cas_rn", "name", "scope", "hazard_score", "regulatory_lists", "added"],
      ...items.map((w) => [w.casRn, w.name, w.ownerType, w.hazardScore, w.listCodes.join(";"), w.createdAt.toISOString()]),
    ]);
  } else {
    return new Response("Unknown export type", { status: 400 });
  }

  const owner = billingOwner(viewer)!;
  await recordUsage({ ...owner, kind: "export", userId: viewer.userId, path: `/api/workspace/export?type=${type}` });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="chemspace-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
