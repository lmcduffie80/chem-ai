import type { ProviderProduct, SdsProvider, UpdatesPage } from "../provider";
import { buildTextPdf } from "./fixture-pdf";

const DEMO_SUPPLIER = {
  externalId: "demo-supplier",
  name: "Demo Supplier (fixture data)",
  country: "US",
  website: "https://example.com",
  contacts: [{ name: "Demo Contact", email: "sds@example.com", role: "Regulatory" }],
  certifications: ["ISO 9001"],
};

const PRODUCTS: ProviderProduct[] = [
  {
    externalId: "demo-acetone",
    name: "Acetone, ACS Reagent",
    sku: "DEMO-ACE-4L",
    grade: "ACS",
    purity: ">=99.5%",
    supplier: DEMO_SUPPLIER,
    components: [{ casRn: "67-64-1", name: "Acetone", minPct: 99.5, maxPct: 100 }],
    sdsDocuments: [{ externalId: "demo-acetone-sds", revisionDate: "2025-03-01", contentHash: "fixture-2" }],
  },
  {
    externalId: "demo-degreaser",
    name: "Industrial Degreaser Blend",
    sku: "DEMO-DGR-20L",
    supplier: DEMO_SUPPLIER,
    components: [
      { casRn: "79-01-6", name: "Trichloroethylene", minPct: 60, maxPct: 80 },
      { casRn: "108-88-3", name: "Toluene", minPct: 10, maxPct: 30 },
    ],
    sdsDocuments: [{ externalId: "demo-degreaser-sds", revisionDate: "2019-06-15", contentHash: "fixture-2" }],
  },
];

const SDS_TEXT: Record<string, string[]> = {
  "demo-acetone-sds": [
    "SAFETY DATA SHEET - FIXTURE DATA, NOT FOR REAL USE",
    "Revision date: 2025-03-01",
    "1. Identification",
    "Product name: Acetone, ACS Reagent. Product code: DEMO-ACE-4L. Supplier: Demo Supplier, sds@example.com.",
    "Recommended use: Laboratory solvent.",
    "2. Hazard(s) identification",
    "Signal word: Danger. H225 Highly flammable liquid and vapour. H319 Causes serious eye irritation.",
    "H336 May cause drowsiness or dizziness. P210 Keep away from heat, sparks, open flames.",
    "3. Composition/information on ingredients",
    "Acetone, CAS 67-64-1, 99.5-100%",
    "4. First-aid measures",
    "Eyes: rinse cautiously with water for several minutes. Inhalation: remove to fresh air.",
    "5. Fire-fighting measures",
    "Use alcohol-resistant foam, dry chemical or CO2. Vapours may form explosive mixtures with air.",
    "6. Accidental release measures",
    "Eliminate ignition sources. Absorb with inert material.",
    "7. Handling and storage",
    "Store in a cool, well-ventilated place. Keep container tightly closed. Ground and bond containers.",
    "8. Exposure controls/personal protection",
    "OSHA PEL 1000 ppm TWA. ACGIH TLV 250 ppm TWA, 500 ppm STEL. Wear safety goggles and butyl gloves.",
    "9. Physical and chemical properties",
    "Clear colourless liquid. Boiling point 56 C. Flash point -20 C. Vapour pressure 24 kPa at 20 C.",
    "10. Stability and reactivity",
    "Stable. Incompatible with strong oxidizers.",
    "11. Toxicological information",
    "LD50 oral rat 5800 mg/kg. Eye irritant.",
    "12. Ecological information",
    "Readily biodegradable. Low bioaccumulation potential.",
    "13. Disposal considerations",
    "Dispose of as hazardous waste (RCRA U002, D001).",
    "14. Transport information",
    "UN1090, Acetone, Class 3, Packing group II.",
    "15. Regulatory information",
    "TSCA: listed, active. CERCLA RQ 5000 lb. RCRA U002.",
    "16. Other information",
    "Fixture document generated for development.",
  ],
  "demo-degreaser-sds": [
    "SAFETY DATA SHEET - FIXTURE DATA, NOT FOR REAL USE",
    "Revision date: 2019-06-15",
    "1. Identification",
    "Product name: Industrial Degreaser Blend. Product code: DEMO-DGR-20L. Supplier: Demo Supplier.",
    "Recommended use: Vapour degreasing of metal parts.",
    "2. Hazard(s) identification",
    "Signal word: Danger. H350 May cause cancer. H341 Suspected of causing genetic defects.",
    "H225 Highly flammable liquid and vapour. H361d Suspected of damaging the unborn child. H315 Causes skin irritation.",
    "3. Composition/information on ingredients",
    "Trichloroethylene, CAS 79-01-6, 60-80%. Toluene, CAS 108-88-3, 10-30%.",
    "4. First-aid measures",
    "Inhalation: move to fresh air, seek medical attention. Skin: wash with soap and water.",
    "5. Fire-fighting measures",
    "Use water spray, foam or dry chemical. Thermal decomposition releases hydrogen chloride and phosgene.",
    "6. Accidental release measures",
    "Ventilate area. Contain spill and prevent entry into drains.",
    "7. Handling and storage",
    "Use only in closed systems or with local exhaust ventilation. Store away from heat.",
    "8. Exposure controls/personal protection",
    "Trichloroethylene OSHA PEL 100 ppm TWA. Toluene OSHA PEL 200 ppm TWA. Use Viton gloves and respirator.",
    "9. Physical and chemical properties",
    "Colourless liquid with sweet odour. Boiling range 87-111 C.",
    "10. Stability and reactivity",
    "Avoid strong bases, reactive metals and open flames.",
    "11. Toxicological information",
    "Trichloroethylene is classified as carcinogenic to humans (IARC Group 1).",
    "12. Ecological information",
    "Harmful to aquatic life with long lasting effects.",
    "13. Disposal considerations",
    "Dispose of as hazardous waste (RCRA U228, F001).",
    "14. Transport information",
    "UN1992, Flammable liquid, toxic, n.o.s., Class 3 (6.1), Packing group II.",
    "15. Regulatory information",
    "TSCA section 6 risk management rule applies to trichloroethylene. SARA 313 listed. HAP. Prop 65 carcinogen.",
    "16. Other information",
    "Fixture document generated for development.",
  ],
};

/** Local-development adapter. Never enable in production; it serves invented supplier data. */
export class FixtureProvider implements SdsProvider {
  readonly id = "fixture";

  async listUpdates(): Promise<UpdatesPage> {
    return { productIds: PRODUCTS.map((p) => p.externalId) };
  }

  async fetchProduct(externalId: string) {
    return PRODUCTS.find((p) => p.externalId === externalId) ?? null;
  }

  async fetchSdsPdf(externalId: string) {
    const lines = SDS_TEXT[externalId];
    return lines ? buildTextPdf(lines) : null;
  }
}
