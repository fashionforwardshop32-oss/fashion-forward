import type { ReactNode } from "react";
import { CartProvider } from "@/lib/cart/context";
import { ShopHeader } from "@/components/shop/ShopHeader";

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <ShopHeader />
      {children}
    </CartProvider>
  );
}
