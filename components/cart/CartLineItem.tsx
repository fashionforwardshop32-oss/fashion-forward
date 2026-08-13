"use client";

import { PriceTag } from "@/components/ui/PriceTag";
import { useCart } from "@/lib/cart/context";
import type { CartDetailLine } from "@/lib/cart/actions";

export function CartLineItem({ line }: { line: CartDetailLine }) {
  const { updateQty, removeItem } = useCart();

  if (!line.available) {
    return (
      <div className="flex items-center justify-between rounded-card border border-ink/10 bg-surface p-3">
        <span className="text-sm text-ink-muted">This item is no longer available.</span>
        <button
          type="button"
          onClick={() => removeItem(line.variantId)}
          className="text-sm font-medium text-accent"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 rounded-card border border-ink/10 bg-surface p-3">
      <div className="h-20 w-20 flex-none overflow-hidden rounded-card bg-tint">
        {line.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudflare Workers has no next/image runtime optimizer; images are pre-sized to 400/800/1600 WebP at upload time, see lib/images/photon.ts
          <img src={line.imageUrl} alt={line.title} className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">{line.title}</p>
        <p className="text-xs text-ink-muted">Size {line.size}</p>
        <div className="mt-2 flex items-center justify-between">
          <div className="inline-flex items-center rounded-card border border-ink/15">
            <button
              type="button"
              onClick={() => updateQty(line.variantId, line.qty - 1)}
              className="w-8 py-1 text-ink"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="w-8 text-center text-sm font-medium">{line.qty}</span>
            <button
              type="button"
              onClick={() => updateQty(line.variantId, Math.min(line.qty + 1, line.stockQty))}
              disabled={line.qty >= line.stockQty}
              className="w-8 py-1 text-ink disabled:opacity-40"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
          <PriceTag price={line.price * line.qty} />
        </div>
        <button
          type="button"
          onClick={() => removeItem(line.variantId)}
          className="mt-1 text-xs text-ink-muted underline"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
