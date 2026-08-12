import { notFound } from "next/navigation";
import { getCategoryBySlug } from "@/lib/db/categories";
import { listActiveProductsByCategory } from "@/lib/db/products";
import { CategoryFilters } from "./CategoryFilters";

export const revalidate = 300; // ISR, per spec §5's route table

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categorySlug } = await params;

  const category = await getCategoryBySlug(categorySlug);
  if (!category) notFound();

  const products = await listActiveProductsByCategory(categorySlug);

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">{category.name}</h1>
      <CategoryFilters products={products} />
    </main>
  );
}
