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
      await supabase.from("variants").update({ stock_qty: stockQty }).eq("id", existing.id);
    } else {
      const sku = `${productId}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
      await supabase.from("variants").insert({ product_id: productId, size, sku, stock_qty: stockQty });
    }
  }

  redirect("/admin/products");
}
