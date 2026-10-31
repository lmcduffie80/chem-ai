import type { ProviderProduct, SdsProvider, UpdatesPage } from "../provider";

/**
 * Adapter for a vendor feed exposed (directly or through a thin shim) as:
 *   GET {base}/products/updates?since=ISO&cursor=…  -> { productIds: string[], nextCursor?: string }
 *   GET {base}/products/{id}                         -> ProviderProduct
 *   GET {base}/sds/{id}/pdf                          -> application/pdf
 * Authenticated with `Authorization: Bearer SDS_PROVIDER_API_KEY`.
 */
export class GenericRestProvider implements SdsProvider {
  readonly id: string;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    id = "generic-rest",
  ) {
    this.id = id;
  }

  private async request(path: string, accept = "application/json") {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, accept },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`SDS provider ${path} failed: ${res.status} ${res.statusText}`);
    return res;
  }

  async listUpdates(since: Date | null, cursor?: string): Promise<UpdatesPage> {
    const params = new URLSearchParams();
    if (since) params.set("since", since.toISOString());
    if (cursor) params.set("cursor", cursor);
    const res = await this.request(`/products/updates?${params}`);
    return res ? ((await res.json()) as UpdatesPage) : { productIds: [] };
  }

  async fetchProduct(externalId: string): Promise<ProviderProduct | null> {
    const res = await this.request(`/products/${encodeURIComponent(externalId)}`);
    return res ? ((await res.json()) as ProviderProduct) : null;
  }

  async fetchSdsPdf(sdsExternalId: string): Promise<Uint8Array | null> {
    const res = await this.request(`/sds/${encodeURIComponent(sdsExternalId)}/pdf`, "application/pdf");
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  }
}
