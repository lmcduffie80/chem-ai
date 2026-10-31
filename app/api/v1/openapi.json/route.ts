import { openApiDocument } from "@/lib/openapi";

export function GET(request: Request) {
  return Response.json(openApiDocument(new URL(request.url).origin), {
    headers: { "access-control-allow-origin": "*" },
  });
}
