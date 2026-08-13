import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PriceTag } from "@/components/ui/PriceTag";
import type { ProductListItem } from "@/lib/db/products";

export function ProductCard({ product }: { product: ProductListItem }) {
  return (
    <Link href={`/p/${product.slug}`}>
      <Card className="overflow-hidden transition-transform hover:-translate-y-0.5">
        <div className="aspect-[4/5] bg-tint">
          {product.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudflare Workers has no next/image runtime optimizer; images are pre-sized to 400/800/1600 WebP at upload time, see lib/images/photon.ts
            <img
              src={product.cover_image_url}
              alt={product.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <p className="text-sm font-medium text-ink">{product.title}</p>
          <p className="text-xs text-ink-muted">{product.age_group}</p>
          <PriceTag price={product.base_price} />
        </div>
      </Card>
    </Link>
  );
}
