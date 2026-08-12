"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function toggleProductStatus(productId: string, currentStatus: string) {
  await requireAdmin();

  const nextStatus = currentStatus === "active" ? "archived" : "active";
  const supabase = createServerClient();
  const { error } = await supabase
    .from("products")
    .update({ status: nextStatus })
    .eq("id", productId);

  if (error) throw new Error(`toggleProductStatus: ${error.message}`);

  revalidatePath("/admin/products");
}
