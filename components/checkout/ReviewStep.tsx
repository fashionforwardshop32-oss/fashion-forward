"use client";

import { PriceTag } from "@/components/ui/PriceTag";
import { Button } from "@/components/ui/Button";
import type { CartDetailLine } from "@/lib/cart/actions";

export function ReviewStep({
  lines,
  addressSummary,
}: {
  lines: CartDetailLine[];
  addressSummary: string;
}) {
  const available = lines.filter((l) => l.available);
  // Unavailable lines stay out of the total, but they don't get to vanish
  // silently: a product that went out of stock or got archived between the
  // cart page and this screen is called out below, the way /cart does with
  // CartLineItem's "no longer available" row. Read-only here — this is a
  // summary, so there's nothing to edit, just something to be told about.
  const unavailable = lines.filter((l) => !l.available);
  const subtotal = available.reduce((sum, l) => sum + l.price * l.qty, 0);

  return (
    <div className="space-y-4">
      {unavailable.length > 0 && (
        <div className="rounded-card bg-accent/10 p-4">
          <p className="text-sm font-medium text-ink">
            {unavailable.length === 1
              ? "1 item is no longer available and has been removed from your order."
              : `${unavailable.length} items are no longer available and have been removed from your order.`}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            They sold out or were taken off the store since you added them, so they aren&apos;t
            in the total below. Everything else is ready to go.
          </p>
        </div>
      )}

      <div className="rounded-card border border-ink/10 bg-surface p-4">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Order summary</h2>
        <div className="space-y-2">
          {available.map((l) => (
            <div key={l.variantId} className="flex items-center justify-between text-sm">
              <span className="text-ink">
                {l.title} ({l.size}) × {l.qty}
              </span>
              <span className="text-ink">₹{l.price * l.qty}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
          <span className="font-medium text-ink">Total</span>
          <PriceTag price={subtotal} />
        </div>
      </div>

      <div className="rounded-card border border-ink/10 bg-surface p-4">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Delivering to</h2>
        <p className="text-sm text-ink-muted">{addressSummary}</p>
      </div>

      <div className="rounded-card border border-dashed border-ink/20 bg-tint p-4 text-center">
        <p className="text-sm font-medium text-ink">Payment launches in Week 4</p>
        <p className="mt-1 text-xs text-ink-muted">
          UPI, card and Cash on Delivery are next — this screen already knows your cart and
          address for it.
        </p>
        <Button type="button" disabled className="mt-3 w-full">
          Pay ₹{subtotal}
        </Button>
      </div>
    </div>
  );
}
