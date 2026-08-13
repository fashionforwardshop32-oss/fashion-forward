import { describe, expect, it } from "vitest";
import { isBangalorePincode } from "@/lib/validation/pincode";

describe("isBangalorePincode", () => {
  it("accepts a real Bangalore pincode", () => {
    expect(isBangalorePincode("560032")).toBe(true);
  });

  it("accepts a pincode with surrounding whitespace", () => {
    expect(isBangalorePincode(" 560001 ")).toBe(true);
  });

  it("rejects a non-Bangalore pincode", () => {
    expect(isBangalorePincode("400001")).toBe(false); // Mumbai
  });

  it("rejects a malformed pincode", () => {
    expect(isBangalorePincode("56003")).toBe(false); // 5 digits
    expect(isBangalorePincode("5600321")).toBe(false); // 7 digits
    expect(isBangalorePincode("5600AB")).toBe(false); // letters
  });
});
