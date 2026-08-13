"use server";

import { createClient } from "@supabase/supabase-js";
import type { CartLine } from "./context";

function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export type CartDetailLine = {
  variantId: string;
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
 */
export async function getCartDetails(lines: CartLine[]): Promise<CartDetailLine[]> {
  if (lines.length === 0) return [];

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
        qty: line.qty,
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

    return {
      variantId: variant.id,
      qty: line.qty,
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
