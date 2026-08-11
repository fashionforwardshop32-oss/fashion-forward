"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uniqueProductSlug } from "@/lib/db/slug";
import { uploadProductImages } from "@/lib/images/upload";

export async function createProduct(formData: FormData) {
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
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  if (!title || !categoryId || !ageGroup || !Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error("createProduct: missing or invalid required fields");
  }

  const validSizes = sizes
    .map((s) => ({ size: s.size.trim(), stockQty: Number(s.stockQty) }))
    .filter((s) => s.size.length > 0 && Number.isFinite(s.stockQty) && s.stockQty >= 0);

  if (validSizes.length === 0) {
    throw new Error("createProduct: at least one valid size with stock is required");
  }

  const supabase = createServerClient();
  const slug = await uniqueProductSlug(supabase, title);

  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      title,
      slug,
      category_id: categoryId,
      gender,
      age_group: ageGroup,
      base_price: basePrice,
      status: publishNow ? "active" : "draft",
    })
    .select()
    .single();

  if (productError || !product) {
    throw new Error(`createProduct: ${productError?.message ?? "no product returned"}`);
  }

  const variantRows = validSizes.map((s) => ({
    product_id: product.id,
    size: s.size,
    sku: `${slug}-${s.size}`.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    stock_qty: s.stockQty,
  }));

  const { error: variantError } = await supabase.from("variants").insert(variantRows);
  if (variantError) {
    throw new Error(`createProduct: variant insert failed: ${variantError.message}`);
  }

  if (photos.length > 0) {
    const uploaded = await uploadProductImages(photos, product.id);
    const imageRows = uploaded.map((img) => ({
      product_id: product.id,
      url_400: img.url_400,
      url_800: img.url_800,
      url_1600: img.url_1600,
      position: img.position,
    }));
    const { error: imageError } = await supabase.from("product_images").insert(imageRows);
    if (imageError) {
      throw new Error(`createProduct: image row insert failed: ${imageError.message}`);
    }
  }

  redirect("/admin/products");
}
