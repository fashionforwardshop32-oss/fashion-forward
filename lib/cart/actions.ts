"use server";

import { createClient } from "@supabase/supabase-js";
import type { CartLine } from "./context";

function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * Upper bound on how many lines one call may ask about. This is a
 * publicly-callable Server Action taking a caller-supplied array straight
 * into an `.in("id", …)` query — nothing here is a data-exposure risk (it
 * reads through the same public RLS policies anonymous browsing already
 * uses), but an unbounded array is free amplification for the caller and
 * paid work for us. The catalogue is ~150 SKUs; no honest bag is near 100.
 */
const MAX_CART_LINES = 100;

export type CartDetailLine = {
  variantId: string;
  /**
   * Trustworthy quantity: a whole number, and on an `available` line never
   * above that variant's real `stockQty`. Not necessarily what the caller
   * passed in — see the clamp in getCartDetails. Consumers must price and
   * total against this field, never the raw CartLine.qty they sent.
   */
  qty: number;
  productId: string;
  productSlug: string;
  title: string;
  size: string;
  price: number;
  stockQty: number;
  imageUrl: string | null;
  available: boolean; // false if the variant/product no longer exists or isn't active
};

type VariantRow = {
  id: string;
  size: string;
  stock_qty: number;
  products: {
    id: string;
    slug: string;
    title: string;
    base_price: number;
    status: string;
    product_images: { url_400: string; position: number }[];
  } | null;
};

/**
 * Turns {variantId, qty} pairs (the only thing the browser cart stores) into
 * live, trustworthy data: current price, current stock, current title/image.
 * A variant that no longer exists, or whose product is no longer active,
 * comes back with available: false and zeroed price/stock — callers must
 * not include unavailable lines in any total.
 *
 * This is the sole trustworthy price/stock gatekeeper — Week 4's order
 * creation will be built on top of it — so it validates the caller's `qty`
 * rather than echoing it back. The browser cart lives in localStorage,
 * which anyone can hand-edit, and the +/- stepper's client-side clamp is
 * a convenience, not a control.
 */
export async function getCartDetails(lines: CartLine[]): Promise<CartDetailLine[]> {
  if (lines.length === 0) return [];
  if (lines.length > MAX_CART_LINES) {
    throw new Error(`getCartDetails: too many lines (max ${MAX_CART_LINES})`);
  }

  const supabase = createReadClient();
  const variantIds = lines.map((l) => l.variantId);

  const { data, error } = await supabase
    .from("variants")
    .select(
      "id, size, stock_qty, products(id, slug, title, base_price, status, product_images(url_400, position))",
    )
    .in("id", variantIds);

  if (error) throw new Error(`getCartDetails: ${error.message}`);

  const byId = new Map((data as unknown as VariantRow[]).map((v) => [v.id, v]));

  return lines.map((line) => {
    const variant = byId.get(line.variantId);
    const product = variant?.products;
    const isActive = product?.status === "active";

    if (!variant || !product || !isActive) {
      return {
        variantId: line.variantId,
        // No real stock to clamp against here, but still don't echo a
        // fractional/negative/NaN qty back out of this function.
        qty: Number.isFinite(line.qty) ? Math.max(1, Math.trunc(line.qty)) : 1,
        productId: "",
        productSlug: "",
        title: "No longer available",
        size: "",
        price: 0,
        stockQty: 0,
        imageUrl: null,
        available: false,
      };
    }

    const cover = [...product.product_images].sort((a, b) => a.position - b.position)[0];

    // Never echo the caller's qty back untouched: coerce it to a whole
    // number, floor it at 1, and cap it at the stock that actually exists.
    // A hand-edited localStorage entry (qty: 9999, qty: 2.5, qty: -3) would
    // otherwise flow straight into the checkout total. Note this can land on
    // 0 when stock_qty is 0 — a line that's listed but unbuyable, which the
    // stepper already renders with "+" disabled and prices at ₹0.
    // Number.isFinite first, because Math.trunc(NaN) is NaN and NaN survives
    // both Math.max and Math.min — the clamp alone would pass it through.
    const requestedQty = Number.isFinite(line.qty) ? Math.trunc(line.qty) : 1;
    const clampedQty = Math.min(Math.max(1, requestedQty), variant.stock_qty);

    return {
      variantId: variant.id,
      qty: clampedQty,
      productId: product.id,
      productSlug: product.slug,
      title: product.title,
      size: variant.size,
      price: product.base_price,
      stockQty: variant.stock_qty,
      imageUrl: cover?.url_400 ?? null,
      available: true,
    };
  });
}
