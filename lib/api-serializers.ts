import type { ChemicalDetail } from "@/lib/chemicals";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://chemspace.app";

export function serializeChemical(c: ChemicalDetail) {
  return {
    casRn: c.casRn,
    name: c.preferredName,
    identifiers: { dtxsid: c.dtxsid, pubchemCid: c.pubchemCid, inchikey: c.inchikey, smiles: c.smiles },
    molecularFormula: c.molecularFormula,
    molecularWeight: c.molWeight,
    tsca: { status: c.tscaStatus, flags: c.tscaFlags, uvcb: c.isUvcb },
    hazardScore: c.hazardScore,
    hazards: c.hazards.map((h) => ({
      source: h.source,
      signalWord: h.signalWord,
      hStatements: h.hStatements,
      pStatements: h.pStatements,
      pictograms: h.pictograms,
      score: h.score,
    })),
    regulatoryLists: c.listings.map((l) => ({ code: l.listCode, details: l.details, effectiveDate: l.effectiveDate })),
    saferChoiceStatus: c.saferChoiceStatus,
    functionClasses: c.functionClasses,
    synonyms: c.synonyms.map((s) => s.name),
    products: c.products.map((p) => ({
      id: p.productId,
      name: p.productName,
      supplier: { id: p.supplierId, name: p.supplierName },
      minPct: p.minPct,
      maxPct: p.maxPct,
    })),
    sdsDocuments: c.sdsDocuments.map((d) => ({
      id: d.id,
      productId: d.productId,
      revisionDate: d.revisionDate,
      language: d.language,
      region: d.region,
    })),
    url: `${APP_URL}/chemicals/${c.casRn}`,
  };
}
