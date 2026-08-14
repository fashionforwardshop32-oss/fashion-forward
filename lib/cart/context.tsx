"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CartLine = { variantId: string; qty: number };

const STORAGE_KEY = "ff_cart";

function readStoredCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof l.variantId === "string" &&
        typeof l.qty === "number" &&
        l.qty > 0,
    );

    // Fold duplicate variantIds together. addItem() already merges on add, so
    // this is only reachable by hand-editing localStorage — but a duplicate
    // would double-count the subtotal and collide on the React `key` in every
    // list that renders these, so it's cheaper to normalise here than to have
    // each consumer defend against it.
    const byVariant = new Map<string, number>();
    for (const line of valid) {
      byVariant.set(line.variantId, (byVariant.get(line.variantId) ?? 0) + line.qty);
    }
    return [...byVariant].map(([variantId, qty]) => ({ variantId, qty }));
  } catch {
    return [];
  }
}

type CartContextValue = {
  lines: CartLine[];
  addItem: (variantId: string, qty?: number) => void;
  removeItem: (variantId: string) => void;
  updateQty: (variantId: string, qty: number) => void;
  count: number;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLines(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines, hydrated]);

  const addItem = useCallback((variantId: string, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === variantId);
      if (existing) {
        return prev.map((l) => (l.variantId === variantId ? { ...l, qty: l.qty + qty } : l));
      }
      return [...prev, { variantId, qty }];
    });
  }, []);

  const removeItem = useCallback((variantId: string) => {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }, []);

  const updateQty = useCallback((variantId: string, qty: number) => {
    setLines((prev) => {
      if (qty <= 0) return prev.filter((l) => l.variantId !== variantId);
      return prev.map((l) => (l.variantId === variantId ? { ...l, qty } : l));
    });
  }, []);

  const count = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines]);

  const value = useMemo(
    () => ({ lines, addItem, removeItem, updateQty, count }),
    [lines, addItem, removeItem, updateQty, count],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
