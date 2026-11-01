import { apiError, withApiKey } from "@/lib/api";
import { serializeChemicalProduct } from "@/lib/api-serializers";
import { getChemicalProducts, PRODUCTS_PAGE_SIZE, productTotal } from "@/lib/chemical-products";
import { getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/chemicals/[cas]/products">>(async (request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  const query = new URL(request.url).searchParams;
  const category = query.get("category") || null;
  const page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
  const products = await getChemicalProducts(chemical.id, category, page);
  return Response.json({
    data: {
      casRn: chemical.casRn,
      category,
      page,
      pageSize: PRODUCTS_PAGE_SIZE,
      total: productTotal(chemical.productCategories, category),
      products: products.map(serializeChemicalProduct),
    },
  });
});
