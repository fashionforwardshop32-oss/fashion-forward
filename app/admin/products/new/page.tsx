import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "./actions";

export default async function NewProductPage() {
  await requireAdmin();

  const supabase = createServerClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <main>
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Add product</h1>
      <form action={createProduct}>
        <ProductForm categories={categories ?? []} submitLabel="Create product" />
      </form>
    </main>
  );
}
