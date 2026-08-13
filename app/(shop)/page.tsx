import Link from "next/link";
import { listCategories } from "@/lib/db/categories";
import { listNewArrivals } from "@/lib/db/products";
import { ProductCard } from "@/components/product/ProductCard";
import { buttonClasses } from "@/components/ui/Button";

export const revalidate = 300;

export default async function HomePage() {
  const [categories, newArrivals] = await Promise.all([listCategories(), listNewArrivals(8)]);

  return (
    <main>
      <section className="bg-tint px-4 py-12 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Fashion Forward</h1>
        <p className="mx-auto mt-2 max-w-md text-ink-muted">
          Kids&apos; clothing in RT Nagar, Bangalore — now online, same-day delivery.
        </p>
        {newArrivals.length > 0 && (
          <Link href="#new-arrivals" className={buttonClasses("primary", "mt-5")}>
            Shop new arrivals
          </Link>
        )}
      </section>

      {categories.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">Shop by category</h2>
          <div className="flex flex-wrap gap-3">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="rounded-card bg-tint px-5 py-3 font-medium text-brand"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {newArrivals.length > 0 && (
        <section id="new-arrivals" className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">New arrivals</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {categories.length === 0 && newArrivals.length === 0 && (
        <p className="p-8 text-center text-ink-muted">
          Products are on their way — check back soon.
        </p>
      )}
    </main>
  );
}
