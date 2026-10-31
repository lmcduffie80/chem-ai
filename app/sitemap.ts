import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://chemspace.app";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/search", "/pricing", "/docs/api", "/data-sources"].map((path) => ({
    url: `${BASE_URL}${path}`,
    changeFrequency: "weekly",
  }));
}
