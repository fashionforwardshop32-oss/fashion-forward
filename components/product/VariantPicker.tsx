"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Variant = { id: string; size: string; stock_qty: number };

export function VariantPicker({ variants }: { variants: Variant[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    variants.find((v) => v.stock_qty > 0)?.id ?? null,
  );

  const selected = variants.find((v) => v.id === selectedId);

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

      <Button type="button" disabled={!selected} className="w-full">
        {selected ? "Add to bag" : "Select a size"}
      </Button>
      <p className="mt-2 text-center text-xs text-ink-muted">
        Cart launches in Week 3 — sizes and stock shown here are live.
      </p>
    </div>
  );
}
