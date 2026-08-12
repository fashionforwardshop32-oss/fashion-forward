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
