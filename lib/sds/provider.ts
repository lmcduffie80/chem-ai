export type ProviderSupplier = {
  externalId: string;
  name: string;
  country?: string;
  website?: string;
  contacts?: { name?: string; email?: string; phone?: string; role?: string }[];
  certifications?: string[];
};

export type ProviderComponent = {
  casRn?: string;
  name: string;
  minPct?: number;
  maxPct?: number;
};

export type ProviderSdsDocument = {
  externalId: string;
  revisionDate?: string;
  language?: string;
  region?: string;
  /** Vendor-supplied fingerprint; lets us skip re-downloading unchanged PDFs. */
  contentHash?: string;
};

export type ProviderProduct = {
  externalId: string;
  name: string;
  sku?: string;
  grade?: string;
  purity?: string;
  description?: string;
  supplier: ProviderSupplier;
  components: ProviderComponent[];
  sdsDocuments: ProviderSdsDocument[];
};

export type UpdatesPage = { productIds: string[]; nextCursor?: string };

/**
 * Contract every licensed SDS/supplier vendor adapter implements
 * (3E/Verisk, UL WERCS, Chemwatch, Sphera, ...).
 */
export interface SdsProvider {
  readonly id: string;
  listUpdates(since: Date | null, cursor?: string): Promise<UpdatesPage>;
  fetchProduct(externalId: string): Promise<ProviderProduct | null>;
  fetchSdsPdf(sdsExternalId: string): Promise<Uint8Array | null>;
}
