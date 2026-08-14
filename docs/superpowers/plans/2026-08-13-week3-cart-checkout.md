# Fashion Forward — Week 3: Cart, WhatsApp OTP Auth, Address Capture, Checkout UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a shopper a real, working path from PDP to a priced, address-attached order review — cart persistence, phone verification via WhatsApp OTP, address capture with a Bangalore-only delivery gate, and a checkout flow that stops just short of taking money. Payment (Razorpay/COD), order creation, and stock decrements are explicitly Week 4 — this week ends at "review order," not "place order."

**Architecture:** Extends the Week 1/2 Next.js 15 App Router app. Cart lives in `localStorage` as `{variantId, qty}` pairs only — per spec §3's trust boundary, price and stock are never trusted from the client; every cart read re-fetches live data via a Server Action. Phone verification uses Supabase Auth's phone OTP delivered over **WhatsApp only** (no SMS fallback — an explicit, deliberate choice this week, since Supabase's phone auth only supports a WhatsApp channel through a Twilio or Twilio Verify provider). Address writes go through the **anon/authenticated** client directly, protected by Week 1's existing `"customer manages own addresses"` RLS policy — no service-role client needed for this week's address work. The one place this week does need the service-role client is creating the `customers` row itself right after OTP verification succeeds, because Week 1 deliberately left `customers` with no INSERT policy for `authenticated` (see Week 1's final-review Minor #2, which flagged this exact gap as "designed decision for Week 3").

**Tech Stack:** Next.js 15.5.22, `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.111.0 — all already installed, **no new dependencies this week**. No new database migrations either — Week 1's schema and RLS already cover everything this plan needs (`addresses`' full-CRUD-for-owner policy, `variants`/`products`/`product_images`' public-read policies for cart re-pricing).

## Global Constraints

- Project root: `C:\Users\tejas\fashion-forward` (existing git repo, remote `origin` → `github.com/fashionforwardshop32-oss/fashion-forward`, branch `main`).
- No component may contain a literal hex value or a raw Tailwind palette class — only the semantic tokens already in `app/globals.css` (`bg-brand`, `text-on-brand`, `bg-accent`, `text-on-accent`, `bg-highlight`, `bg-tint`, `bg-surface`, `text-ink`, `text-ink-muted`, `rounded-card`, `font-display`, `font-body`).
- **The browser cart stores only `{variantId, qty}` — never price, title, or stock.** Every place the cart's contents are displayed or totaled must come from a fresh server call (spec §3, hard trust-boundary rule, not a style preference).
- **WhatsApp OTP only, no SMS channel** — `signInWithOtp` must always pass `options: { channel: "whatsapp" }`. This is a deliberate, explicit product decision made this week, not an oversight — do not add an SMS fallback "for robustness."
- Phone numbers are stored and submitted in E.164 format (`+91XXXXXXXXXX`) — India-only, matching the Bangalore-only delivery scope.
- Pincode gate: a delivery address is valid only if its pincode matches Bangalore's postal prefix, `/^560\d{3}$/`. Outside that: block the save, show a message, and link to a WhatsApp contact number sourced from `NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER` — never hardcode a phone number in a component.
- This plan does **not** create the `customers` row via a database trigger — it uses an explicit Server Action (`ensureCustomerRecord`) called right after OTP verification, keeping auth-adjacent logic in application code rather than hidden in Postgres, consistent with how this project has handled every other write path so far.
- Every task ends in a `git commit`. Commit messages are plain, imperative, no marketing language.
- PowerShell is the user's primary shell outside this session; all commands below are written for the Bash tool already in use in this session (Git Bash).
- **Local testing of the OTP flow cannot use real WhatsApp delivery** — Twilio + a WhatsApp sender are a production-only setup step for the human (tracked as an open item, not something any task here can complete). Task 2's brief includes an explicit discovery step to find Supabase CLI's local test-OTP mechanism before assuming the flow is untestable locally.

---

## File Structure

```
fashion-forward/
  app/
    (shop)/
      layout.tsx                       (new — wraps storefront pages with CartProvider + ShopHeader)
      cart/
        page.tsx                       (new — cart page)
      checkout/
        page.tsx                       (new — checkout orchestration: auth → address → review)
      p/[slug]/page.tsx                (modified — VariantPicker now does real add-to-cart)
  components/
    shop/
      ShopHeader.tsx                   (new — logo + cart link/count, client component)
    product/
      VariantPicker.tsx                (modified — wires "Add to bag" to the real cart)
    cart/
      CartLineItem.tsx                 (new — one cart row: image, title, qty stepper, remove, live price)
    checkout/
      PhoneAuthStep.tsx                (new — phone entry + WhatsApp OTP send/verify)
      AddressStep.tsx                  (new — existing-address list + new-address form + pincode gate)
      ReviewStep.tsx                   (new — cart summary + chosen address + Week-4 payment stub)
  lib/
    cart/
      context.tsx                      (new — CartProvider, useCart() hook, localStorage-backed)
      actions.ts                       (new — getCartDetails() Server Action, live re-pricing)
    auth/
      customer.ts                      (new — ensureCustomerRecord() Server Action)
    validation/
      pincode.ts                       (new — isBangalorePincode())
  tests/
    pincode.test.ts                    (new — unit tests for isBangalorePincode())
  .env.local.example                   (modified — adds NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER)
```

---

### Task 1: Cart (localStorage + live re-pricing + cart page + shop header)

**Files:**
- Create: `lib/cart/context.tsx`
- Create: `lib/cart/actions.ts`
- Create: `components/shop/ShopHeader.tsx`
- Create: `components/cart/CartLineItem.tsx`
- Create: `app/(shop)/layout.tsx`
- Create: `app/(shop)/cart/page.tsx`
- Modify: `components/product/VariantPicker.tsx`

**Interfaces:**
- Consumes: `getProductBySlug`'s `variants` shape from Week 2 (`{id, size, stock_qty}`); `Button`/`Card`/`PriceTag` from Week 1.
- Produces: `useCart()` — `{ lines: CartLine[], addItem(variantId: string, qty?: number): void, removeItem(variantId: string): void, updateQty(variantId: string, qty: number): void, count: number }`. `CartLine = { variantId: string; qty: number }`. `getCartDetails(lines: CartLine[]): Promise<CartDetailLine[]>` — the Server Action every later cart/checkout screen calls to turn `{variantId, qty}` into real, current data. Task 4 (checkout review) calls this directly.

- [ ] **Step 1: Write `lib/cart/context.tsx`**

```tsx
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
    return parsed.filter(
      (l): l is CartLine =>
        typeof l === "object" &&
        l !== null &&
        typeof l.variantId === "string" &&
        typeof l.qty === "number" &&
        l.qty > 0,
    );
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
```

- [ ] **Step 2: Write `lib/cart/actions.ts`**

```ts
"use server";

import { createClient } from "@supabase/supabase-js";
import type { CartLine } from "./context";

function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export type CartDetailLine = {
  variantId: string;
  qty: number;
  productId: string;
  productSlug: string;
  title: string;
  size: string;
  price: number;
  stockQty: number;
  imageUrl: string | null;
  available: boolean; // false if the variant/product no longer exists or isn't active
};

type VariantRow = {
  id: string;
  size: string;
  stock_qty: number;
  products: {
    id: string;
    slug: string;
    title: string;
    base_price: number;
    status: string;
    product_images: { url_400: string; position: number }[];
  } | null;
};

/**
 * Turns {variantId, qty} pairs (the only thing the browser cart stores) into
 * live, trustworthy data: current price, current stock, current title/image.
 * A variant that no longer exists, or whose product is no longer active,
 * comes back with available: false and zeroed price/stock — callers must
 * not include unavailable lines in any total.
 */
export async function getCartDetails(lines: CartLine[]): Promise<CartDetailLine[]> {
  if (lines.length === 0) return [];

  const supabase = createReadClient();
  const variantIds = lines.map((l) => l.variantId);

  const { data, error } = await supabase
    .from("variants")
    .select(
      "id, size, stock_qty, products(id, slug, title, base_price, status, product_images(url_400, position))",
    )
    .in("id", variantIds);

  if (error) throw new Error(`getCartDetails: ${error.message}`);

  const byId = new Map((data as unknown as VariantRow[]).map((v) => [v.id, v]));

  return lines.map((line) => {
    const variant = byId.get(line.variantId);
    const product = variant?.products;
    const isActive = product?.status === "active";

    if (!variant || !product || !isActive) {
      return {
        variantId: line.variantId,
        qty: line.qty,
        productId: "",
        productSlug: "",
        title: "No longer available",
        size: "",
        price: 0,
        stockQty: 0,
        imageUrl: null,
        available: false,
      };
    }

    const cover = [...product.product_images].sort((a, b) => a.position - b.position)[0];

    return {
      variantId: variant.id,
      qty: line.qty,
      productId: product.id,
      productSlug: product.slug,
      title: product.title,
      size: variant.size,
      price: product.base_price,
      stockQty: variant.stock_qty,
      imageUrl: cover?.url_400 ?? null,
      available: true,
    };
  });
}
```

- [ ] **Step 3: Write `components/shop/ShopHeader.tsx`**

```tsx
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
          className="relative inline-flex items-center gap-2 rounded-card bg-tint px-3 py-2 text-sm font-medium text-brand-ink"
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
```

`text-brand-ink` doesn't exist in `app/globals.css` (a gap every Week 2 task hit) — use `text-brand` instead.

- [ ] **Step 4: Write `app/(shop)/layout.tsx`**

```tsx
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
```

- [ ] **Step 5: Write `components/cart/CartLineItem.tsx`**

```tsx
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
```

- [ ] **Step 6: Write `app/(shop)/cart/page.tsx`**

```tsx
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

  useEffect(() => {
    let cancelled = false;
    getCartDetails(lines).then((result) => {
      if (!cancelled) setDetails(result);
    });
    return () => {
      cancelled = true;
    };
  }, [lines]);

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
```

- [ ] **Step 7: Wire `VariantPicker`'s "Add to bag" for real**

Read `components/product/VariantPicker.tsx` first — it currently renders a disabled `Button` with the note "Cart launches in Week 3." Replace the disabled button and note with a real, working add-to-cart call using `useCart()`. Keep everything else (the out-of-stock-sizes-greyed-never-hidden logic) exactly as it is — do not touch that part.

```tsx
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
```

- [ ] **Step 8: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/cart`.

- [ ] **Step 9: Manual verification**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Open a real PDP (`http://localhost:3100/p/<slug>`), pick a size, click "Add to bag" — confirm the header's bag count increments. Open `/cart` — confirm the item appears with a live price and image (not from localStorage — check `localStorage.getItem('ff_cart')` in devtools only holds `{variantId, qty}`, nothing else). Increase quantity past stock — confirm the `+` button disables at the stock ceiling. Remove the item — confirm the empty-cart state shows.

```bash
kill %1
```

- [ ] **Step 10: Commit**

```bash
git add lib/cart components/shop components/cart "app/(shop)/layout.tsx" "app/(shop)/cart" components/product/VariantPicker.tsx
git commit -m "feat: add cart with live server re-pricing and shop header"
```

---

### Task 2: WhatsApp OTP phone authentication

**Files:**
- Create: `lib/auth/customer.ts`
- Create: `components/checkout/PhoneAuthStep.tsx`

**Interfaces:**
- Consumes: `createServerClient` (service-role, from `lib/supabase/server.ts`, Week 1/2) — used only inside `ensureCustomerRecord`. `createClient` (browser, from `lib/supabase/client.ts`, Week 2) — used inside `PhoneAuthStep` for `signInWithOtp`/`verifyOtp`.
- Produces: `ensureCustomerRecord(): Promise<{ id: string; phone: string } | null>` — Task 4's checkout orchestration calls this right after a successful OTP verify. `<PhoneAuthStep onVerified={() => void} />` — Task 4 renders this until the shopper is authenticated.

- [ ] **Step 1: Discovery — find the local test-OTP mechanism before writing the UI**

Real WhatsApp delivery needs Twilio configured in the Supabase dashboard, which doesn't exist yet — that's a production-only setup step for the human, not something this task can complete. But you should NOT assume the flow is untestable locally. Check for a local bypass:

```bash
grep -n -A5 "\[auth.sms\]" supabase/config.toml
npx supabase --help | grep -i sms
```

Look specifically for a `test_otp` mapping (Supabase CLI's local stack has historically supported configuring fixed phone→OTP pairs for exactly this kind of local testing, avoiding real SMS/WhatsApp costs in dev). If you find it, use it to write a real, working manual verification in Step 6 below. If nothing like it exists on the installed CLI version, say so plainly in your report, and fall back to verifying `signInWithOtp`/`verifyOtp` are wired correctly by inspecting the actual network calls in devtools (confirm the request body has `channel: "whatsapp"`, confirm a 200 comes back) rather than completing a real end-to-end verify — do not skip verification silently, and do not invent a workaround that weakens the real auth flow to make testing easier.

- [ ] **Step 2: Verify the exact `verifyOtp` type parameter against installed types**

The Supabase docs don't clearly state whether a WhatsApp-delivered OTP is verified with `type: "sms"` or a different literal. Don't guess — check the installed package's own types:

```bash
grep -rn "type.*VerifyOtpParams\|VerifyMobileOtpParams" node_modules/@supabase/auth-js/dist/module/lib/types.d.ts 2>/dev/null | head -20
```

Read enough of the surrounding type definition to find the literal union `verifyOtp`'s `type` field accepts for phone-based verification (likely `"sms" | "phone_change"` or similar — the WhatsApp channel affects only how the code is *sent*, not how it's verified, so `"sms"` is the probable answer, but confirm it directly against the types file rather than assuming). Use whatever you find in Step 3's code.

- [ ] **Step 3: Write `components/checkout/PhoneAuthStep.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { ensureCustomerRecord } from "@/lib/auth/customer";

function toE164(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

export function PhoneAuthStep({ onVerified }: { onVerified: () => void }) {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createClient();

  async function sendOtp() {
    setError(null);
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    const phone = toE164(phoneInput);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone,
      options: { channel: "whatsapp" },
    });
    setLoading(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setStep("otp");
  }

  async function verifyOtp() {
    setError(null);
    if (otp.trim().length < 4) {
      setError("Enter the code sent to your WhatsApp.");
      return;
    }
    setLoading(true);
    const phone = toE164(phoneInput);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone,
      token: otp.trim(),
      type: "sms",
    });
    if (verifyError) {
      setLoading(false);
      setError(verifyError.message);
      return;
    }
    const customer = await ensureCustomerRecord();
    setLoading(false);
    if (!customer) {
      setError("Couldn't set up your account. Try again.");
      return;
    }
    onVerified();
  }

  return (
    <div className="rounded-card border border-ink/10 bg-surface p-4">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">Verify your number</h2>
      <p className="mb-4 text-sm text-ink-muted">
        We'll send a code on WhatsApp — no account, no password.
      </p>

      {error && <p className="mb-3 rounded-card bg-accent/10 p-2 text-sm text-ink">{error}</p>}

      {step === "phone" ? (
        <div className="space-y-3">
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium text-ink">
              Mobile number
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-muted">+91</span>
              <input
                id="phone"
                inputMode="numeric"
                maxLength={10}
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="98765 43210"
                className="flex-1 rounded-card border border-ink/15 px-3 py-2 text-ink"
              />
            </div>
          </div>
          <Button type="button" onClick={sendOtp} disabled={loading} className="w-full">
            {loading ? "Sending…" : "Send code via WhatsApp"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="otp" className="mb-1 block text-sm font-medium text-ink">
              Code from WhatsApp
            </label>
            <input
              id="otp"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="123456"
              className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
            />
          </div>
          <Button type="button" onClick={verifyOtp} disabled={loading} className="w-full">
            {loading ? "Verifying…" : "Verify"}
          </Button>
          <button
            type="button"
            onClick={() => setStep("phone")}
            className="w-full text-center text-sm text-ink-muted underline"
          >
            Use a different number
          </button>
        </div>
      )}
    </div>
  );
}
```

Adjust the `type: "sms"` literal on the `verifyOtp` call if Step 2's investigation found a different correct value — this is the one line in this file that depends on that discovery.

- [ ] **Step 4: Write `lib/auth/customer.ts`**

```ts
"use server";

import { createServerClient, createSessionClient } from "@/lib/supabase/server";

/**
 * Creates the customers row for the just-verified auth session, if one
 * doesn't already exist. Uses the service-role client because Week 1's
 * RLS deliberately gives `authenticated` no INSERT policy on `customers`
 * (see supabase/migrations/20260803000002_rls.sql) — customer-row
 * creation is meant to go through server-side code, not a direct client
 * insert, and this is that code.
 */
export async function ensureCustomerRecord(): Promise<{ id: string; phone: string } | null> {
  const session = await createSessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user?.phone) return null;

  const service = createServerClient();

  const { data: existing } = await service
    .from("customers")
    .select("id, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await service
    .from("customers")
    .insert({ id: user.id, phone: user.phone })
    .select("id, phone")
    .single();

  if (error || !created) {
    return null;
  }

  return created;
}
```

Check `lib/supabase/server.ts`'s actual current exports before writing this file — Week 2 established the service-role client is named `createServerClient` and the session-aware one is `createSessionClient`, both exported from the same file. Confirm both names still match reality before using them; if either has changed, use the real name.

- [ ] **Step 5: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Manual verification**

If Step 1 found a local test-OTP mechanism, use it to run a real `signInWithOtp` → `verifyOtp` → `ensureCustomerRecord` round trip against local Supabase, and confirm a real `customers` row appears (`npx supabase db query --local "select id, phone from customers order by created_at desc limit 1;"`). If no local mechanism exists, verify what Step 1 said you'd fall back to (devtools network inspection of the `signInWithOtp` call), and clearly document in your report that full auth-to-customer-row verification is blocked on the human configuring Twilio + WhatsApp in production.

- [ ] **Step 7: Commit**

```bash
git add lib/auth components/checkout/PhoneAuthStep.tsx
git commit -m "feat: add WhatsApp OTP phone authentication"
```

---

### Task 3: Address capture + Bangalore pincode gate

**Files:**
- Create: `lib/validation/pincode.ts`
- Create: `tests/pincode.test.ts`
- Create: `components/checkout/AddressStep.tsx`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `createClient()` browser client (Week 2, `lib/supabase/client.ts`) — address reads/writes go through this directly, protected by Week 1's `"customer manages own addresses"` RLS policy (`for all to authenticated using (customer_id = auth.uid())`), no service-role client needed.
- Produces: `isBangalorePincode(pincode: string): boolean`. `<AddressStep customerId={string} onAddressChosen={(addressId: string) => void} />` — Task 4 renders this after `PhoneAuthStep` reports success.

- [ ] **Step 1: Write the failing test for `isBangalorePincode`**

```ts
// tests/pincode.test.ts
import { describe, expect, it } from "vitest";
import { isBangalorePincode } from "@/lib/validation/pincode";

describe("isBangalorePincode", () => {
  it("accepts a real Bangalore pincode", () => {
    expect(isBangalorePincode("560032")).toBe(true);
  });

  it("accepts a pincode with surrounding whitespace", () => {
    expect(isBangalorePincode(" 560001 ")).toBe(true);
  });

  it("rejects a non-Bangalore pincode", () => {
    expect(isBangalorePincode("400001")).toBe(false); // Mumbai
  });

  it("rejects a malformed pincode", () => {
    expect(isBangalorePincode("56003")).toBe(false); // 5 digits
    expect(isBangalorePincode("5600321")).toBe(false); // 7 digits
    expect(isBangalorePincode("5600AB")).toBe(false); // letters
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/pincode.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/validation/pincode'`.

- [ ] **Step 3: Write `lib/validation/pincode.ts`**

```ts
const BANGALORE_PINCODE = /^560\d{3}$/;

/**
 * Bangalore's postal prefix is 560 (560001-560XXX). Delivery is
 * Bangalore-only for now (spec §2 constraints) — every other Indian
 * pincode is out of the service area, not invalid data.
 */
export function isBangalorePincode(pincode: string): boolean {
  return BANGALORE_PINCODE.test(pincode.trim());
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/pincode.test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Add the WhatsApp contact number env var**

```bash
# .env.local.example — append this line
NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER=
```

For local testing, set a real-format placeholder in your own `.env.local` (not committed) — any valid-looking Indian mobile number works for verifying the link renders, e.g. `+919999999999`.

- [ ] **Step 6: Write `components/checkout/AddressStep.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { isBangalorePincode } from "@/lib/validation/pincode";

type Address = {
  id: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  is_default: boolean;
};

export function AddressStep({
  customerId,
  onAddressChosen,
}: {
  customerId: string;
  onAddressChosen: (addressId: string) => void;
}) {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pincode, setPincode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outOfZone, setOutOfZone] = useState(false);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER ?? "";

  useEffect(() => {
    supabase
      .from("addresses")
      .select("id, line1, line2, landmark, pincode, is_default")
      .eq("customer_id", customerId)
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        setAddresses(data ?? []);
        if (data && data.length > 0) {
          setSelectedId(data[0]!.id);
        } else {
          setShowForm(true);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function saveAddress() {
    setError(null);
    setOutOfZone(false);

    if (line1.trim().length < 5) {
      setError("Enter your full address.");
      return;
    }
    if (!/^\d{6}$/.test(pincode.trim())) {
      setError("Enter a valid 6-digit pincode.");
      return;
    }
    if (!isBangalorePincode(pincode)) {
      setOutOfZone(true);
      return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("addresses")
      .insert({
        customer_id: customerId,
        line1: line1.trim(),
        line2: line2.trim() || null,
        landmark: landmark.trim() || null,
        city: "Bangalore",
        pincode: pincode.trim(),
        is_default: (addresses ?? []).length === 0,
      })
      .select("id")
      .single();
    setSaving(false);

    if (insertError || !data) {
      setError("Couldn't save that address. Try again.");
      return;
    }

    onAddressChosen(data.id);
  }

  if (addresses === null) {
    return <p className="text-sm text-ink-muted">Loading addresses…</p>;
  }

  return (
    <div className="rounded-card border border-ink/10 bg-surface p-4">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Delivery address</h2>

      {addresses.length > 0 && !showForm && (
        <div className="space-y-2">
          {addresses.map((a) => (
            <label
              key={a.id}
              className={`block cursor-pointer rounded-card border p-3 text-sm ${
                selectedId === a.id ? "border-brand bg-tint" : "border-ink/15"
              }`}
            >
              <input
                type="radio"
                name="address"
                className="mr-2"
                checked={selectedId === a.id}
                onChange={() => setSelectedId(a.id)}
              />
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ""} — {a.pincode}
            </label>
          ))}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              className="flex-1"
              disabled={!selectedId}
              onClick={() => selectedId && onAddressChosen(selectedId)}
            >
              Deliver here
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(true)}>
              + New address
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-3">
          {outOfZone ? (
            <div className="rounded-card bg-accent/10 p-3 text-sm text-ink">
              <p className="font-medium">We don't deliver to this pincode yet.</p>
              <p className="mt-1 text-ink-muted">
                Fashion Forward currently ships within Bangalore only.
              </p>
              {whatsappNumber && (
                <a
                  href={`https://wa.me/${whatsappNumber.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-medium text-brand underline"
                >
                  Message us on WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => setOutOfZone(false)}
                className="mt-2 block text-xs text-ink-muted underline"
              >
                Try a different pincode
              </button>
            </div>
          ) : (
            <>
              {error && (
                <p className="rounded-card bg-accent/10 p-2 text-sm text-ink">{error}</p>
              )}
              <div>
                <label htmlFor="line1" className="mb-1 block text-sm font-medium text-ink">
                  Address
                </label>
                <input
                  id="line1"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  placeholder="House no, street, area"
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div>
                <label htmlFor="line2" className="mb-1 block text-sm font-medium text-ink">
                  Apartment / floor (optional)
                </label>
                <input
                  id="line2"
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div>
                <label htmlFor="landmark" className="mb-1 block text-sm font-medium text-ink">
                  Landmark (optional)
                </label>
                <input
                  id="landmark"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="city" className="mb-1 block text-sm font-medium text-ink">
                    City
                  </label>
                  <input
                    id="city"
                    value="Bangalore"
                    disabled
                    className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink-muted"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="pincode" className="mb-1 block text-sm font-medium text-ink">
                    Pincode
                  </label>
                  <input
                    id="pincode"
                    inputMode="numeric"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    placeholder="560032"
                    className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                  />
                </div>
              </div>
              <Button type="button" onClick={saveAddress} disabled={saving} className="w-full">
                {saving ? "Saving…" : "Save address"}
              </Button>
              {addresses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="w-full text-center text-sm text-ink-muted underline"
                >
                  Use an existing address instead
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 8: Manual verification**

Against local Supabase with a real authenticated test session (reuse the temp-user technique earlier Week 2 tasks used — export local anon/URL env vars, sign in a test user via the Supabase client in a quick script or via the browser), confirm: a valid Bangalore pincode (`560032`) saves and appears in the address list; a non-Bangalore pincode (`400001`) blocks the save and shows the WhatsApp link instead; the WhatsApp link's `href` is built from `NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER`, not a hardcoded number.

- [ ] **Step 9: Commit**

```bash
git add lib/validation tests/pincode.test.ts components/checkout/AddressStep.tsx .env.local.example
git commit -m "feat: add address capture with Bangalore-only pincode gate"
```

---

### Task 4: Checkout orchestration (auth → address → review)

**Files:**
- Create: `components/checkout/ReviewStep.tsx`
- Create: `app/(shop)/checkout/page.tsx`

**Interfaces:**
- Consumes: `PhoneAuthStep` (Task 2), `AddressStep` (Task 3), `getCartDetails`/`useCart` (Task 1), `Button`/`Card`/`PriceTag` (Week 1).
- Produces: nothing further — this is the plan's final task.

- [ ] **Step 1: Write `components/checkout/ReviewStep.tsx`**

Payment is explicitly Week 4 — this step ends in a clearly-labeled, honest non-functional state, matching the pattern Week 2's `VariantPicker` used for cart before Week 3 built it for real.

```tsx
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
  const subtotal = available.reduce((sum, l) => sum + l.price * l.qty, 0);

  return (
    <div className="space-y-4">
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
```

- [ ] **Step 2: Write `app/(shop)/checkout/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useCart } from "@/lib/cart/context";
import { getCartDetails, type CartDetailLine } from "@/lib/cart/actions";
import { PhoneAuthStep } from "@/components/checkout/PhoneAuthStep";
import { AddressStep } from "@/components/checkout/AddressStep";
import { ReviewStep } from "@/components/checkout/ReviewStep";

type Stage = "loading" | "auth" | "address" | "review";

export default function CheckoutPage() {
  const { lines } = useCart();
  const [cartDetails, setCartDetails] = useState<CartDetailLine[] | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [addressSummary, setAddressSummary] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    getCartDetails(lines).then(setCartDetails);
  }, [lines]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setCustomerId(data.user.id);
        setStage("address");
      } else {
        setStage("auth");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (cartDetails !== null && cartDetails.filter((l) => l.available).length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-center">
        <p className="text-ink-muted">Your bag is empty.</p>
        <Link href="/" className="mt-3 inline-block font-medium text-brand">
          Continue shopping
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Checkout</h1>

      {stage === "loading" && <p className="text-sm text-ink-muted">Loading…</p>}

      {stage === "auth" && (
        <PhoneAuthStep
          onVerified={async () => {
            const { data } = await supabase.auth.getUser();
            if (data.user) {
              setCustomerId(data.user.id);
              setStage("address");
            }
          }}
        />
      )}

      {stage === "address" && customerId && (
        <AddressStep
          customerId={customerId}
          onAddressChosen={async (addressId) => {
            const { data } = await supabase
              .from("addresses")
              .select("line1, line2, pincode")
              .eq("id", addressId)
              .single();
            if (data) {
              setAddressSummary(
                `${data.line1}${data.line2 ? `, ${data.line2}` : ""} — ${data.pincode}`,
              );
              setStage("review");
            }
          }}
        />
      )}

      {stage === "review" && cartDetails && addressSummary && (
        <ReviewStep lines={cartDetails} addressSummary={addressSummary} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/checkout`.

- [ ] **Step 4: Manual verification — full flow, cart to review**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Starting from an empty cart: add a real product to the bag from its PDP, go to `/cart`, click "Proceed to checkout." Confirm it lands on the auth step (no session). Complete whatever OTP verification Task 2's manual testing established works locally. Confirm it advances to the address step, complete or select an address, confirm it advances to review showing the correct cart total and address, with a disabled "Pay ₹X" button and the "Payment launches in Week 4" note. Reload the page mid-flow — confirm an already-authenticated session skips straight to the address step rather than re-prompting for OTP.

```bash
kill %1
```

- [ ] **Step 5: Deploy and verify the live pipeline still holds**

```bash
npm run cf:deploy
curl -s -o /dev/null -w "%{http_code}\n" https://fashion-forward.fashion-forward.workers.dev/cart
curl -s -o /dev/null -w "%{http_code}\n" https://fashion-forward.fashion-forward.workers.dev/checkout
```

Expected: both `200`.

- [ ] **Step 6: Commit**

```bash
git add components/checkout/ReviewStep.tsx "app/(shop)/checkout"
git commit -m "feat: add checkout flow orchestrating auth, address, and order review"
```

---

## Week 3 exit criteria

Before starting Week 4 (spec §11: Razorpay integration, COD, order state machine, webhooks, stock decrements), confirm all of the following are true:

- [ ] `npm run build` succeeds locally with zero errors
- [ ] Adding an item to the bag on any PDP updates the header's bag count and persists across a page reload
- [ ] `/cart` never displays a price, title, or image sourced from `localStorage` — every field traces to a live `getCartDetails` call (spot-check: edit `localStorage.ff_cart`'s stored qty in devtools, reload `/cart`, confirm the displayed price/stock reflects the real current DB state, not anything stale)
- [ ] The checkout flow reaches a review screen showing the correct cart total and a real saved address, with payment explicitly, honestly non-functional
- [ ] A non-Bangalore pincode is rejected at the address step with a WhatsApp contact link, not silently accepted
- [ ] `npx vitest run tests/pincode.test.ts` passes
- [ ] No hex colour or raw Tailwind palette class appears anywhere under `components/` or `app/` outside `globals.css`
- [ ] The live Cloudflare Workers URL serves `/cart` and `/checkout` with `200`
- [ ] `.env.local`'s new `NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER` value (if you set a real one for testing) is confirmed still gitignored and was never committed

**Explicitly out of scope for Week 3** (confirm these are NOT attempted): real Razorpay/COD payment, order creation, stock decrements, order confirmation, WhatsApp order-notification messages (different from OTP — those are Week 5's Meta Cloud API notifications), Twilio/WhatsApp production configuration (human, dashboard-only, tracked as an open item). All are Week 4+ per spec §11.

**Known open item for the human, not resolvable by any task in this plan:** phone OTP delivery needs a Twilio account with a WhatsApp sender configured in the Supabase Auth dashboard (Authentication → Providers → Phone → set SMS provider to Twilio, enable the WhatsApp channel) before OTP actually reaches a real phone in production. Nothing in this plan can complete that step.
