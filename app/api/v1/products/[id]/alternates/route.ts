import { apiError, withApiKey } from "@/lib/api";
import { getProductAlternates } from "@/lib/alternates/query";
import { serializeAlternate } from "@/lib/api-serializers";
import { getProduct } from "@/lib/chemicals";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://chemspace.app";

export const GET = withApiKey<RouteContext<"/api/v1/products/[id]/alternates">>(async (_request, _api, { params }) => {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return apiError(404, "not_found", `No product with id ${id}.`);
  const result = await getProductAlternates(product.id);
  if (result.status === "unavailable") {
    return apiError(503, "unavailable", "Alternates are temporarily unavailable; retry shortly.");
  }
  const ok = result.status === "ok";
  return Response.json({
    data: {
      product: { id: product.id, name: product.name, maker: product.supplier.name, url: `${APP_URL}/products/${product.id}` },
      reason: ok ? null : "no_tsca_ingredients",
      close: ok ? result.close.map(serializeAlternate) : [],
      partial: ok ? result.partial.map(serializeAlternate) : [],
    },
  });
});
