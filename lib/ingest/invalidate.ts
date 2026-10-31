import { revalidateTag } from "next/cache";

/**
 * Marks cached pages stale after ingestion. Outside a Next.js request (e.g. `tsx` scripts)
 * there is no cache to invalidate, so failures are ignored.
 */
export function invalidateTags(tags: Iterable<string>) {
  for (const tag of new Set(tags)) {
    try {
      revalidateTag(tag, "max");
    } catch {
      return;
    }
  }
}

export const chemicalTag = (cas: string) => `chemical:${cas}`;
