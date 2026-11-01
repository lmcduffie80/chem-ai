import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://allochemix.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/workspace", "/billing", "/api/", "/sds/", "/search?"],
      },
    ],
    sitemap: [`${BASE_URL}/sitemap.xml`, `${BASE_URL}/chemicals/sitemap/0.xml`, `${BASE_URL}/chemicals/sitemap/1.xml`],
  };
}
