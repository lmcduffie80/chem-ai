import type { Alternate } from "@/lib/alternates/query";
import type { ChemicalProduct } from "@/lib/chemical-products";
import type { ChemicalDetail } from "@/lib/chemicals";
import { manufacturerSdsSearchUrl } from "@/lib/product-sources";

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

export function serializeAlternate(a: Alternate) {
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    maker: { id: a.makerId, name: a.maker, kind: a.makerKind },
    score: Math.round(a.score * 1000) / 1000,
    sharedCas: a.shared.map((s) => s.casRn),
    sharedCount: a.sharedCount,
    addedCount: a.addedCount,
    sds: a.sdsId
      ? { id: a.sdsId, url: `${APP_URL}/sds/${a.sdsId}` }
      : { searchUrl: manufacturerSdsSearchUrl(a.name, a.maker, a.makerKind) },
    url: `${APP_URL}/products/${a.id}`,
  };
}
