import { describe, expect, it } from "vitest";
import { isLegalTransition, type OrderStatus } from "@/lib/orders/transitions";

const ALL_STATUSES: OrderStatus[] = [
  "pending_payment",
  "cod_pending",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
  "rto",
];

describe("isLegalTransition", () => {
  it("allows the happy-path sequence", () => {
    expect(isLegalTransition("pending_payment", "confirmed")).toBe(true);
    expect(isLegalTransition("cod_pending", "confirmed")).toBe(true);
    expect(isLegalTransition("confirmed", "packed")).toBe(true);
    expect(isLegalTransition("packed", "out_for_delivery")).toBe(true);
    expect(isLegalTransition("out_for_delivery", "delivered")).toBe(true);
  });

  it("allows cancelled from any pre-delivery state", () => {
    for (const from of [
      "pending_payment",
      "cod_pending",
      "confirmed",
      "packed",
      "out_for_delivery",
    ] as OrderStatus[]) {
      expect(isLegalTransition(from, "cancelled")).toBe(true);
    }
  });

  it("allows returned and rto only from delivered or out_for_delivery", () => {
    expect(isLegalTransition("delivered", "returned")).toBe(true);
    expect(isLegalTransition("out_for_delivery", "rto")).toBe(true);
    expect(isLegalTransition("pending_payment", "returned")).toBe(false);
    expect(isLegalTransition("confirmed", "rto")).toBe(false);
  });

  it("rejects skipping steps forward", () => {
    expect(isLegalTransition("pending_payment", "packed")).toBe(false);
    expect(isLegalTransition("confirmed", "delivered")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    // "delivered" is intentionally excluded: it has exactly one legal
    // successor (returned), already covered by the "allows returned and rto
    // only from delivered or out_for_delivery" test above.
    for (const terminal of ["cancelled", "returned", "rto"] as OrderStatus[]) {
      for (const to of ALL_STATUSES) {
        if (to === terminal) continue;
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("rejects a status transitioning to itself", () => {
    for (const s of ALL_STATUSES) {
      expect(isLegalTransition(s, s)).toBe(false);
    }
  });

  it("rejects pending_payment and cod_pending transitioning into each other", () => {
    expect(isLegalTransition("pending_payment", "cod_pending")).toBe(false);
    expect(isLegalTransition("cod_pending", "pending_payment")).toBe(false);
  });
});
