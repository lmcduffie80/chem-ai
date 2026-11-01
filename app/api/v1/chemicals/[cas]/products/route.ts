import { apiError, withApiKey } from "@/lib/api";
import { serializeChemicalProduct } from "@/lib/api-serializers";
import {
  getChemicalProducts,
  PRODUCTS_PAGE_SIZE,
  parseProductsCategory,
  parseProductsPage,
} from "@/lib/chemical-products";
import { getChemicalByCas } from "@/lib/chemicals";

export const GET = withApiKey<RouteContext<"/api/v1/chemicals/[cas]/products">>(async (request, _api, { params }) => {
  const { cas } = await params;
  const chemical = await getChemicalByCas(cas);
  if (!chemical) return apiError(404, "not_found", `No chemical with CAS ${cas} on the TSCA inventory.`);
  const query = new URL(request.url).searchParams;
  const requested = query.get("category");
  const category = parseProductsCategory(requested, chemical.productCategories);
  if (requested && !category) {
    return apiError(400, "invalid_category", `CAS ${cas} has no products in category "${requested}".`);
  }
  const page = parseProductsPage(query.get("page"));
  const { total, products } = await getChemicalProducts(chemical.id, chemical.casRn, category, page);
  return Response.json({
    data: {
      casRn: chemical.casRn,
      category,
      page,
      pageSize: PRODUCTS_PAGE_SIZE,
      total,
      products: products.map(serializeChemicalProduct),
    },
  });
});
