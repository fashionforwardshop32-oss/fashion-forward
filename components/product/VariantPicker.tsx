"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useCart } from "@/lib/cart/context";

type Variant = { id: string; size: string; stock_qty: number };

export function VariantPicker({ variants }: { variants: Variant[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    variants.find((v) => v.stock_qty > 0)?.id ?? null,
  );
  const [justAdded, setJustAdded] = useState(false);
  const { addItem } = useCart();

  const selected = variants.find((v) => v.id === selectedId);

  function handleAddToBag() {
    if (!selected) return;
    addItem(selected.id, 1);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {variants.map((v) => {
          const outOfStock = v.stock_qty === 0;
          const isSelected = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              disabled={outOfStock}
              onClick={() => setSelectedId(v.id)}
              aria-pressed={isSelected}
              className={`rounded-card border px-4 py-2 text-sm font-medium ${
                outOfStock
                  ? "cursor-not-allowed border-ink/10 text-ink-muted line-through"
                  : isSelected
                    ? "border-brand bg-brand text-on-brand"
                    : "border-ink/15 text-ink"
              }`}
            >
              {v.size}
            </button>
          );
        })}
      </div>

      <Button type="button" disabled={!selected} className="w-full" onClick={handleAddToBag}>
        {justAdded ? "Added ✓" : selected ? "Add to bag" : "Select a size"}
      </Button>
    </div>
  );
}
