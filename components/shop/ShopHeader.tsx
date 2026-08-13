"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart/context";

export function ShopHeader() {
  const { count } = useCart();

  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-display text-lg font-bold text-brand">
          Fashion Forward
        </Link>
        <Link
          href="/cart"
          className="relative inline-flex items-center gap-2 rounded-card bg-tint px-3 py-2 text-sm font-medium text-brand"
        >
          Bag
          {count > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-bold text-on-accent">
              {count}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}
