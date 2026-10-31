import type { PlanTier } from "@/db/schema";

export type PlanConfig = {
  label: string;
  price: string;
  description: string;
  /** null means unlimited. */
  sdsViewsPerMonth: number | null;
  aiAlternatives: boolean;
  aiSearch: boolean;
  watchlists: boolean;
  exports: boolean;
  workspace: boolean;
  regulatoryAlerts: boolean;
  api: boolean;
  apiRequestsPerMinute: number;
  apiRequestsPerMonth: number;
  bulkExport: boolean;
  highlights: string[];
};

export const PLANS: Record<PlanTier, PlanConfig> = {
  free: {
    label: "Free",
    price: "$0",
    description: "Look up any EPA-registered chemical.",
    sdsViewsPerMonth: 10,
    aiAlternatives: false,
    aiSearch: false,
    watchlists: false,
    exports: false,
    workspace: false,
    regulatoryAlerts: false,
    api: false,
    apiRequestsPerMinute: 0,
    apiRequestsPerMonth: 0,
    bulkExport: false,
    highlights: ["CAS, name and synonym search", "Chemical, hazard and regulatory pages", "10 SDS views per month"],
  },
  pro: {
    label: "Pro",
    price: "$49/mo",
    description: "For EHS professionals and formulators.",
    sdsViewsPerMonth: null,
    aiAlternatives: true,
    aiSearch: true,
    watchlists: true,
    exports: true,
    workspace: false,
    regulatoryAlerts: false,
    api: false,
    apiRequestsPerMinute: 0,
    apiRequestsPerMonth: 0,
    bulkExport: false,
    highlights: ["Unlimited SDS access", "AI-ranked safer alternatives", "Natural-language search", "Watchlists and CSV exports"],
  },
  team: {
    label: "Team",
    price: "$199/mo",
    description: "Shared SDS library and inventory for your site.",
    sdsViewsPerMonth: null,
    aiAlternatives: true,
    aiSearch: true,
    watchlists: true,
    exports: true,
    workspace: true,
    regulatoryAlerts: true,
    api: false,
    apiRequestsPerMinute: 0,
    apiRequestsPerMonth: 0,
    bulkExport: false,
    highlights: ["Everything in Pro", "Organization workspace with roles", "Shared SDS library and inventory", "Regulatory change alerts"],
  },
  enterprise: {
    label: "Enterprise",
    price: "Contact sales",
    description: "API access, SSO and bulk data for large programs.",
    sdsViewsPerMonth: null,
    aiAlternatives: true,
    aiSearch: true,
    watchlists: true,
    exports: true,
    workspace: true,
    regulatoryAlerts: true,
    api: true,
    apiRequestsPerMinute: 600,
    apiRequestsPerMonth: 1_000_000,
    bulkExport: true,
    highlights: ["Everything in Team", "REST API with API keys", "SSO via Clerk", "Bulk export and SLA"],
  },
};

const RANK: Record<PlanTier, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

export function higherPlan(a: PlanTier, b: PlanTier): PlanTier {
  return RANK[a] >= RANK[b] ? a : b;
}

export function planAtLeast(plan: PlanTier, minimum: PlanTier) {
  return RANK[plan] >= RANK[minimum];
}

export type Feature = {
  [K in keyof PlanConfig]: PlanConfig[K] extends boolean ? K : never;
}[keyof PlanConfig];

export function can(plan: PlanTier, feature: Feature) {
  return PLANS[plan][feature];
}

/** The cheapest plan that unlocks a feature, for upgrade prompts. */
export function minimumPlanFor(feature: Feature): PlanTier {
  return (Object.keys(PLANS) as PlanTier[]).find((p) => PLANS[p][feature]) ?? "enterprise";
}
