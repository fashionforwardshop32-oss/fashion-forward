import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "./actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = createServerClient();
  const [{ data: product }, { data: categories }, { data: variants }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("variants").select("size, stock_qty").eq("product_id", id).order("size"),
  ]);

  if (!product) notFound();

  const updateProductWithId = updateProduct.bind(null, id);

  return (
    <main>
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Edit product</h1>
      <form action={updateProductWithId}>
        <ProductForm
          categories={categories ?? []}
          submitLabel="Save changes"
          defaultValues={{
            title: product.title,
            categoryId: product.category_id ?? "",
            gender: product.gender,
            ageGroup: product.age_group,
            basePrice: String(product.base_price),
            publishNow: product.status === "active",
            sizes: (variants ?? []).map((v) => ({ size: v.size, stockQty: String(v.stock_qty) })),
          }}
        />
      </form>
    </main>
  );
}
