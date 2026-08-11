import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/db/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Floral Cotton Frock")).toBe("floral-cotton-frock");
  });

  it("strips punctuation", () => {
    expect(slugify("Kid's Dino Print Tee!")).toBe("kids-dino-print-tee");
  });

  it("collapses repeated whitespace and hyphens", () => {
    expect(slugify("  Denim   Dungaree -- Set  ")).toBe("denim-dungaree-set");
  });

  it("handles an all-punctuation input without crashing", () => {
    expect(slugify("!!!")).toBe("");
  });
});
