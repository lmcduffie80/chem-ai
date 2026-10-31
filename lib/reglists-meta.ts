export type RegulatoryListCode = "SARA313" | "CERCLA" | "HAP" | "PROP65" | "RCRA" | "PEST_INERT";

type ListMeta = {
  label: string;
  envVar: string;
  description: string;
  /** "hazard" lists flag a chemical of concern; "use" lists record a permitted use. */
  kind: "hazard" | "use";
  defaultUrl?: string;
};

export const CHEMEXPO_LIST_PRESENCE_URL = "https://comptox.epa.gov/chemexpo/dl_lp_chemicals/";

export const REGULATORY_LISTS: Record<RegulatoryListCode, ListMeta> = {
  SARA313: {
    label: "SARA 313 (TRI)",
    envVar: "REGLIST_SARA313_URL",
    description: "EPCRA Section 313 Toxics Release Inventory chemicals",
    kind: "hazard",
  },
  CERCLA: {
    label: "CERCLA Hazardous Substances",
    envVar: "REGLIST_CERCLA_URL",
    description: "CERCLA hazardous substances and reportable quantities",
    kind: "hazard",
  },
  HAP: {
    label: "Clean Air Act HAP",
    envVar: "REGLIST_HAP_URL",
    description: "Hazardous Air Pollutants under CAA Section 112",
    kind: "hazard",
  },
  PROP65: {
    label: "California Prop 65",
    envVar: "REGLIST_PROP65_URL",
    description: "Chemicals known to the State of California to cause cancer or reproductive toxicity",
    kind: "hazard",
  },
  RCRA: {
    label: "RCRA P/U Lists",
    envVar: "REGLIST_RCRA_URL",
    description: "RCRA acute hazardous (P) and toxic (U) commercial chemical product wastes",
    kind: "hazard",
  },
  PEST_INERT: {
    label: "EPA pesticide inert ingredient",
    envVar: "REGLIST_PEST_INERT_URL",
    description: "Approved for use as an inert (non-active) ingredient in pesticide products under EPA inert ingredient lists",
    kind: "use",
    defaultUrl: CHEMEXPO_LIST_PRESENCE_URL,
  },
};

export const REGULATORY_LIST_CODES = Object.keys(REGULATORY_LISTS) as RegulatoryListCode[];
