import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/db/products";
import { Badge } from "@/components/ui/Badge";
import { PriceTag } from "@/components/ui/PriceTag";
import { VariantPicker } from "@/components/product/VariantPicker";
import { SizeChart } from "@/components/product/SizeChart";

export const revalidate = 300;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const totalStock = product.variants.reduce((sum, v) => sum + v.stock_qty, 0);

  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          {product.images.length > 0 ? (
            product.images.map((img) => (
              // eslint-disable-next-line @next/next/no-img-element -- Cloudflare Workers has no next/image runtime optimizer; images are pre-sized to 400/800/1600 WebP at upload time, see lib/images/photon.ts
              <img
                key={img.position}
                src={img.url_800}
                srcSet={`${img.url_400} 400w, ${img.url_800} 800w, ${img.url_1600} 1600w`}
                sizes="(max-width: 640px) 100vw, 50vw"
                alt={img.alt ?? product.title}
                className="w-full rounded-card bg-tint object-cover"
              />
            ))
          ) : (
            <div className="aspect-square rounded-card bg-tint" />
          )}
        </div>

        <div>
          {totalStock === 0 && (
            <Badge tone="accent" className="mb-2">
              Sold out
            </Badge>
          )}
          <h1 className="font-display text-2xl font-bold text-ink">{product.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{product.age_group}</p>
          <div className="mt-3">
            <PriceTag price={product.base_price} />
          </div>

          {product.description && <p className="mt-4 text-sm text-ink">{product.description}</p>}

          <div className="mt-5">
            <VariantPicker variants={product.variants} />
          </div>

          <div className="mt-5">
            <SizeChart />
          </div>
        </div>
      </div>
    </main>
  );
}
