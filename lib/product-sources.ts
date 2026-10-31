export const CHEMEXPO_SOURCE = "chemexpo";

export type SupplierKind = "manufacturer" | "retailer" | "database";

export function supplierRoleLabel(kind: string) {
  if (kind === "database") return "Listed in";
  if (kind === "retailer") return "Sold by";
  return "Made by";
}

/**
 * Manufacturer SDSs are copyrighted and hosted by the manufacturer, so we link to a search for
 * the official document rather than storing a copy. Aggregator names are left out of the query.
 */
export function manufacturerSdsSearchUrl(productName: string, supplierName?: string | null, supplierKind?: string) {
  const maker = supplierKind && supplierKind !== "database" && supplierName ? `${supplierName} ` : "";
  const query = `${maker}"${productName}" safety data sheet`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export function formatPctRange(minPct: number | null, maxPct: number | null) {
  if (minPct === null && maxPct === null) return "—";
  if (minPct !== null && maxPct !== null && minPct === maxPct) return `${minPct}%`;
  return `${minPct ?? 0}–${maxPct ?? 100}%`;
}
