"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function updateProduct(productId: string, formData: FormData) {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const gender = String(formData.get("gender") ?? "unisex");
  const ageGroup = String(formData.get("ageGroup") ?? "").trim();
  const basePrice = Number(formData.get("basePrice"));
  const publishNow = formData.get("publishNow") === "on";
  const sizes = JSON.parse(String(formData.get("sizesJson") ?? "[]")) as {
    size: string;
    stockQty: string;
  }[];

  if (!title || !categoryId || !ageGroup || !Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error("updateProduct: missing or invalid required fields");
  }

  const supabase = createServerClient();

  // `.select("slug")` so new-variant SKUs can reuse createProduct's
  // slug-based scheme -- see the sku line below for why the product id
  // can't be used.
  const { data: product, error: productError } = await supabase
    .from("products")
    .update({
      title,
      category_id: categoryId,
      gender,
      age_group: ageGroup,
      base_price: basePrice,
      status: publishNow ? "active" : "draft",
    })
    .eq("id", productId)
    .select("slug")
    .single();

  if (productError || !product) {
    throw new Error(`updateProduct: ${productError?.message ?? "product not found"}`);
  }

  // Stock is per-variant and variants are identified by size, which the
  // owner can't rename mid-edit in this form (add/remove only) — update
  // stock_qty for sizes that already exist, insert any newly-added ones.
  for (const row of sizes) {
    const size = row.size.trim();
    const stockQty = Number(row.stockQty);
    if (!size || !Number.isFinite(stockQty) || stockQty < 0) continue;

    const { data: existing, error: lookupError } = await supabase
      .from("variants")
      .select("id")
      .eq("product_id", productId)
      .eq("size", size)
      .maybeSingle();

    // Without this, a transient lookup failure falls through to the INSERT
    // branch and creates a duplicate row: `variants`' unique constraint
    // covers (product_id, size, color) and color is nullable, so Postgres
    // treats the two NULL-color rows as distinct and lets both in.
    if (lookupError) {
      throw new Error(`updateProduct: variant lookup failed: ${lookupError.message}`);
    }

    if (existing) {
      const { error } = await supabase
        .from("variants")
        .update({ stock_qty: stockQty })
        .eq("id", existing.id);
      if (error) throw new Error(`updateProduct: variant update failed: ${error.message}`);
    } else {
      // Slug-based, matching createProduct. A `${productId}-${size}` SKU
      // truncated to 40 chars leaves only 3 characters for the size after a
      // 36-char UUID and a hyphen, so real kidswear sizes collide outright
      // ("12-18M" and "12-24M" both become "12-", as do "10-11Y"/"10-12Y").
      const sku = `${product.slug}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "");
      const { error } = await supabase
        .from("variants")
        .insert({ product_id: productId, size, sku, stock_qty: stockQty });
      if (error) throw new Error(`updateProduct: variant insert failed: ${error.message}`);
    }
  }

  // Sizes the owner removed in the form (via ProductForm's "Remove" button)
  // never reach the loop above, so they'd otherwise stay live in the DB —
  // delete any existing variant whose size isn't in the submitted list.
  const submittedSizes = new Set(sizes.map((row) => row.size.trim()).filter(Boolean));

  // An empty submission is never a request to delete every variant. It can
  // arrive from a form that rendered zero size rows, or from a malformed
  // sizesJson -- neither is the owner saying "remove all sizes", and the
  // form has no way to express that anyway (the last row can't be removed).
  if (submittedSizes.size > 0) {
    const { data: existingVariants, error: existingError } = await supabase
      .from("variants")
      .select("id, size")
      .eq("product_id", productId);

    if (existingError) {
      throw new Error(`updateProduct: variant fetch failed: ${existingError.message}`);
    }

    const toDelete = (existingVariants ?? []).filter((v) => !submittedSizes.has(v.size));
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("variants")
        .delete()
        .in("id", toDelete.map((v) => v.id));
      if (error) throw new Error(`updateProduct: variant delete failed: ${error.message}`);
    }
  }

  // Storefront pages are ISR with revalidate = 300, so without this an edit
  // takes up to five minutes to show up publicly -- which reads as "it
  // didn't save". "layout" revalidates the whole tree under / (home,
  // category pages, PDPs) in one call.
  revalidatePath("/", "layout");

  redirect("/admin/products");
}
