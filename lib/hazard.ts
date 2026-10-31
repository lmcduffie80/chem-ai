/**
 * Hazard score (0-100) derived from GHS H-statements. Higher is more hazardous.
 * Weights favour chronic and irreversible effects so that alternatives ranking
 * penalises CMR substances more than, say, mild irritants.
 */
const H_WEIGHTS: Record<string, number> = {
  // Carcinogenicity, mutagenicity, reproductive toxicity
  H340: 30, H341: 15, H350: 30, H351: 15, H360: 30, H361: 15, H362: 8,
  // Acute toxicity
  H300: 20, H310: 20, H330: 20, H301: 12, H311: 12, H331: 12, H302: 5, H312: 5, H332: 5,
  // Specific target organ toxicity
  H370: 15, H371: 8, H372: 15, H373: 8, H335: 3, H336: 3,
  // Aspiration
  H304: 8,
  // Sensitisation
  H317: 8, H334: 12,
  // Corrosion and irritation
  H314: 10, H318: 8, H315: 3, H319: 3,
  // Environment
  H400: 6, H410: 12, H411: 8, H412: 4, H413: 2, H420: 6,
  // Physical
  H200: 15, H201: 15, H202: 12, H203: 12, H220: 8, H224: 8, H225: 6, H226: 3, H228: 4,
  H240: 12, H241: 10, H242: 6, H250: 10, H260: 8, H270: 6, H271: 10, H272: 5, H290: 2,
};

export function hazardScoreFromStatements(hStatements: string[]): number {
  const codes = new Set(hStatements.map((h) => h.trim().toUpperCase().slice(0, 4)));
  let total = 0;
  for (const code of codes) total += H_WEIGHTS[code] ?? 1;
  return Math.min(100, total);
}

export function hazardBand(score: number | null | undefined): "low" | "moderate" | "high" | "unknown" {
  if (score === null || score === undefined) return "unknown";
  if (score >= 40) return "high";
  if (score >= 15) return "moderate";
  return "low";
}
