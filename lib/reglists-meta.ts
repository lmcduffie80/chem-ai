export type RegulatoryListCode = "SARA313" | "CERCLA" | "HAP" | "PROP65" | "RCRA";

export const REGULATORY_LISTS: Record<RegulatoryListCode, { label: string; envVar: string; description: string }> = {
  SARA313: {
    label: "SARA 313 (TRI)",
    envVar: "REGLIST_SARA313_URL",
    description: "EPCRA Section 313 Toxics Release Inventory chemicals",
  },
  CERCLA: {
    label: "CERCLA Hazardous Substances",
    envVar: "REGLIST_CERCLA_URL",
    description: "CERCLA hazardous substances and reportable quantities",
  },
  HAP: {
    label: "Clean Air Act HAP",
    envVar: "REGLIST_HAP_URL",
    description: "Hazardous Air Pollutants under CAA Section 112",
  },
  PROP65: {
    label: "California Prop 65",
    envVar: "REGLIST_PROP65_URL",
    description: "Chemicals known to the State of California to cause cancer or reproductive toxicity",
  },
  RCRA: {
    label: "RCRA P/U Lists",
    envVar: "REGLIST_RCRA_URL",
    description: "RCRA acute hazardous (P) and toxic (U) commercial chemical product wastes",
  },
};

export const REGULATORY_LIST_CODES = Object.keys(REGULATORY_LISTS) as RegulatoryListCode[];
