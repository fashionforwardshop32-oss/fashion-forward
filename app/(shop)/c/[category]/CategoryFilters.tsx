"use client";

import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import { formatInr } from "@/components/ui/PriceTag";
import type { ProductListItem } from "@/lib/db/products";

export function CategoryFilters({ products }: { products: ProductListItem[] }) {
  const [gender, setGender] = useState<"all" | "boy" | "girl" | "unisex">("all");
  const [size, setSize] = useState<string>("all");
  const [maxPrice, setMaxPrice] = useState<number>(
    Math.max(0, ...products.map((p) => p.base_price)),
  );

  const allSizes = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.sizes))).sort(),
    [products],
  );
  const priceCeiling = useMemo(
    () => Math.max(0, ...products.map((p) => p.base_price)),
    [products],
  );

  const filtered = products.filter((p) => {
    if (gender !== "all" && p.gender !== gender) return false;
    if (size !== "all" && !p.sizes.includes(size)) return false;
    if (p.base_price > maxPrice) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as typeof gender)}
          className="rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
        >
          <option value="all">All genders</option>
          <option value="boy">Boys</option>
          <option value="girl">Girls</option>
          <option value="unisex">Unisex</option>
        </select>

        <select
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
        >
          <option value="all">All sizes</option>
          {allSizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-ink">
          Up to {formatInr(maxPrice)}
          <input
            type="range"
            min={0}
            max={priceCeiling}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-muted">No products match those filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
