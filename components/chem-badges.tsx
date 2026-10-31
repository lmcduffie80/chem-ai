import { Badge } from "@/components/ui/badge";
import { hazardBand } from "@/lib/hazard";
import { REGULATORY_LISTS, type RegulatoryListCode } from "@/lib/reglists-meta";
import { cn } from "@/lib/utils";

const BAND_STYLES = {
  low: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  moderate: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  high: "border-red-500/40 bg-red-500/10 text-red-300",
  unknown: "border-border text-muted-foreground",
} as const;

export function HazardBadge({ score }: { score: number | null | undefined }) {
  const band = hazardBand(score);
  return (
    <Badge variant="outline" className={cn("font-medium", BAND_STYLES[band])}>
      {band === "unknown" ? "Hazard: not assessed" : `Hazard ${band} · ${Math.round(score ?? 0)}`}
    </Badge>
  );
}

export function ListBadge({ code }: { code: RegulatoryListCode }) {
  return (
    <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-300" title={REGULATORY_LISTS[code].description}>
      {REGULATORY_LISTS[code].label}
    </Badge>
  );
}

export function TscaBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className={status === "ACTIVE" ? "border-emerald-500/40 text-emerald-300" : "text-muted-foreground"}>
      TSCA {status.toLowerCase()}
    </Badge>
  );
}

export function SaferChoiceBadge({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <Badge variant="outline" className="border-green-500/40 bg-green-500/10 text-green-300">
      Safer Choice: {status}
    </Badge>
  );
}
