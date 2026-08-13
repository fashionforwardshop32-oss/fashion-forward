const BANGALORE_PINCODE = /^560\d{3}$/;

/**
 * Bangalore's postal prefix is 560 (560001-560XXX). Delivery is
 * Bangalore-only for now (spec §2 constraints) — every other Indian
 * pincode is out of the service area, not invalid data.
 */
export function isBangalorePincode(pincode: string): boolean {
  return BANGALORE_PINCODE.test(pincode.trim());
}
