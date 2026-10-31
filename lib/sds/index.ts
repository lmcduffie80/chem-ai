import type { SdsProvider } from "./provider";
import { FixtureProvider } from "./providers/fixture";
import { GenericRestProvider } from "./providers/generic-rest";

export function getSdsProvider(): SdsProvider {
  const kind = process.env.SDS_PROVIDER ?? "generic-rest";
  switch (kind) {
    case "fixture":
      if (process.env.VERCEL_ENV === "production") {
        throw new Error("The fixture SDS provider cannot be used in production.");
      }
      return new FixtureProvider();
    case "generic-rest": {
      const base = process.env.SDS_PROVIDER_BASE_URL;
      const key = process.env.SDS_PROVIDER_API_KEY;
      if (!base || !key) throw new Error("SDS_PROVIDER_BASE_URL and SDS_PROVIDER_API_KEY must be set.");
      return new GenericRestProvider(base, key, process.env.SDS_PROVIDER_ID ?? "licensed");
    }
    default:
      throw new Error(`Unknown SDS_PROVIDER "${kind}"`);
  }
}

export type { SdsProvider } from "./provider";
