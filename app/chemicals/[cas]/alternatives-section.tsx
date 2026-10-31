import Link from "next/link";
import { HazardBadge, SaferChoiceBadge } from "@/components/chem-badges";
import { Badge } from "@/components/ui/badge";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { getViewer } from "@/lib/auth";
import { getAlternatives } from "@/lib/chemicals";
import { can } from "@/lib/entitlements";
import { GenerateAlternativesButton } from "./generate-alternatives-button";

export async function AlternativesSection({ chemicalId, casRn }: { chemicalId: number; casRn: string }) {
  const viewer = await getViewer();
  const alternatives = await getAlternatives(chemicalId);

  if (!can(viewer.plan, "aiAlternatives")) {
    return (
      <UpgradePrompt
        plan="pro"
        signedIn={Boolean(viewer.userId)}
        title={alternatives.length ? `${alternatives.length} safer alternatives available` : "Safer alternatives"}
        description="Upgrade to Pro to see ranked substitutes with hazard comparisons and rationale."
      />
    );
  }

  return (
    <div className="space-y-4">
      {alternatives.length === 0 ? (
        <p className="text-muted-foreground text-sm">No alternatives have been generated for CAS {casRn} yet.</p>
      ) : (
        <ul className="divide-border/60 divide-y rounded-lg border">
          {alternatives.map((a) => (
            <li key={a.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/chemicals/${a.casRn}`} className="font-medium hover:underline">
                  {a.preferredName} <span className="text-muted-foreground font-mono text-xs">CAS {a.casRn}</span>
                </Link>
                <span className="text-muted-foreground text-sm tabular-nums">Score {Math.round(a.score)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <HazardBadge score={a.hazardScore} />
                <SaferChoiceBadge status={a.saferChoiceStatus} />
                {a.functionClass && <Badge variant="outline">{a.functionClass}</Badge>}
                {a.hazardDelta !== null && a.hazardDelta > 0 && (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                    −{Math.round(a.hazardDelta)} hazard
                  </Badge>
                )}
                {a.status === "approved" && (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                    Expert reviewed
                  </Badge>
                )}
                {a.status === "pending" && (
                  <Badge variant="outline" className="text-muted-foreground">
                    AI-suggested · pending expert review
                  </Badge>
                )}
              </div>
              {a.rationale && <p className="text-muted-foreground text-sm">{a.rationale}</p>}
            </li>
          ))}
        </ul>
      )}
      <GenerateAlternativesButton chemicalId={chemicalId} hasExisting={alternatives.length > 0} />
    </div>
  );
}
