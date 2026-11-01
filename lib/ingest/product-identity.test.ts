import { describe, expect, it } from "vitest";
import { isNewerDocument, productKey } from "./product-identity";

describe("productKey", () => {
  it("collapses case, punctuation and whitespace", () => {
    expect(productKey("Method", "Method Body Lotion — Daily Zen", 1)).toBe(
      productKey("method", "method body lotion daily  zen", 2),
    );
  });
  it("strips accents", () => {
    expect(productKey("L'Oréal", "Crème", 1)).toBe(productKey("L'Oreal", "Creme", 2));
  });
  it("keeps different makers apart", () => {
    expect(productKey("Walmart", "Bleach", 1)).not.toBe(productKey("Target", "Bleach", 2));
  });
  it("never merges products whose names normalize to nothing", () => {
    expect(productKey("Walmart", "—", 1)).not.toBe(productKey("Walmart", "—", 2));
  });
});

describe("isNewerDocument", () => {
  it("prefers the later date", () => {
    expect(isNewerDocument({ doc: 1, t: 200 }, { doc: 2, t: 100 })).toBe(true);
    expect(isNewerDocument({ doc: 2, t: 100 }, { doc: 1, t: 200 })).toBe(false);
  });
  it("breaks date ties with the higher document id", () => {
    expect(isNewerDocument({ doc: 5, t: 100 }, { doc: 4, t: 100 })).toBe(true);
    expect(isNewerDocument({ doc: 4, t: 100 }, { doc: 5, t: 100 })).toBe(false);
  });
});
