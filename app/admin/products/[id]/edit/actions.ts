"use server";

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

  const { error: productError } = await supabase
    .from("products")
    .update({
      title,
      category_id: categoryId,
      gender,
      age_group: ageGroup,
      base_price: basePrice,
      status: publishNow ? "active" : "draft",
    })
    .eq("id", productId);

  if (productError) {
    throw new Error(`updateProduct: ${productError.message}`);
  }

  // Stock is per-variant and variants are identified by size, which the
  // owner can't rename mid-edit in this form (add/remove only) — update
  // stock_qty for sizes that already exist, insert any newly-added ones.
  for (const row of sizes) {
    const size = row.size.trim();
    const stockQty = Number(row.stockQty);
    if (!size || !Number.isFinite(stockQty) || stockQty < 0) continue;

    const { data: existing } = await supabase
      .from("variants")
      .select("id")
      .eq("product_id", productId)
      .eq("size", size)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("variants")
        .update({ stock_qty: stockQty })
        .eq("id", existing.id);
      if (error) throw new Error(`updateProduct: variant update failed: ${error.message}`);
    } else {
      const sku = `${productId}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
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
  const { data: existingVariants } = await supabase
    .from("variants")
    .select("id, size")
    .eq("product_id", productId);

  const toDelete = (existingVariants ?? []).filter((v) => !submittedSizes.has(v.size));
  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("variants")
      .delete()
      .in("id", toDelete.map((v) => v.id));
    if (error) throw new Error(`updateProduct: variant delete failed: ${error.message}`);
  }

  redirect("/admin/products");
}
