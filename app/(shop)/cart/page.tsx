"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useCart } from "@/lib/cart/context";
import { getCartDetails, type CartDetailLine } from "@/lib/cart/actions";
import { CartLineItem } from "@/components/cart/CartLineItem";

export default function CartPage() {
  const { lines } = useCart();
  const [details, setDetails] = useState<CartDetailLine[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    getCartDetails(lines)
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lines]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-ink-muted">Couldn&apos;t load your bag. Please try reloading.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-block font-medium text-brand"
        >
          Reload
        </button>
      </main>
    );
  }

  if (details === null) {
    return <main className="mx-auto max-w-2xl p-4 text-ink-muted">Loading your bag…</main>;
  }

  if (details.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-ink-muted">Your bag is empty.</p>
        <Link href="/" className="mt-3 inline-block font-medium text-brand">
          Continue shopping
        </Link>
      </main>
    );
  }

  const available = details.filter((d) => d.available);
  const subtotal = available.reduce((sum, d) => sum + d.price * d.qty, 0);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Your bag</h1>
      <div className="space-y-3">
        {details.map((line) => (
          <CartLineItem key={line.variantId} line={line} />
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-ink/10 pt-4">
        <span className="text-sm font-medium text-ink">Subtotal</span>
        <span className="text-lg font-bold text-ink">₹{subtotal}</span>
      </div>
      <Link href="/checkout">
        <Button className="mt-4 w-full" disabled={available.length === 0}>
          Proceed to checkout
        </Button>
      </Link>
    </main>
  );
}
