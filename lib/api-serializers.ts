import type { ChemicalProduct } from "@/lib/chemical-products";
import type { ChemicalDetail } from "@/lib/chemicals";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://chemspace.app";

export function serializeChemical(c: ChemicalDetail, products: ChemicalProduct[]) {
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
    totalProducts: c.totalProductCount,
    products: products.map(serializeChemicalProduct),
    sdsDocuments: products
      .filter((p) => p.sdsId)
      .map((p) => ({ id: p.sdsId, productId: p.id, revisionDate: p.sdsRevisionDate })),
    url: `${APP_URL}/chemicals/${c.casRn}`,
  };
}

export function serializeChemicalProduct(p: ChemicalProduct) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    supplier: { id: p.supplierId, name: p.supplierName, kind: p.supplierKind },
    minPct: p.minPct,
    maxPct: p.maxPct,
    share: p.weight,
    sdsId: p.sdsId,
    url: `${APP_URL}/products/${p.id}`,
  };
}
