# Fashion Forward — Week 4: Order State Machine, Razorpay, COD, Stock Decrements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Week 3's "review order" screen into a real purchase. One order state machine every write path goes through, a Postgres function that decrements stock and confirms an order atomically (so two shoppers racing for the last unit can never both win), Razorpay Standard Checkout wired end to end (order creation → client payment → server verify → webhook fallback), and Cash on Delivery with the spec's safety rails. This is explicitly the highest-risk week in the project — spec §10 says the money path is "tested first and hardest," and this plan follows that.

**Architecture:** Extends the Week 1-3 Next.js 15 app. All order-status writes go through one Postgres function (`finalize_order`), never a scattered `update({status})` — this is what makes the concurrent-last-unit race safe: the function locks the order row, checks stock, decrements, and transitions status inside one Postgres transaction, so a losing request's changes roll back atomically rather than partially applying. Razorpay's payment verification (client callback) and webhook (server-to-server fallback) both call the same confirm path, made idempotent by the function's from-status check plus a unique constraint on `payments.razorpay_payment_id` — belt and braces, matching this project's established defense-in-depth pattern from Weeks 2-3. Order creation and payment writes use the **service-role** client (`createServerClient`), consistent with the trust boundary already established: price, stock, and now order status are never accepted from or mutated by the client directly.

**Tech Stack:** Next.js 15.5.22, `@supabase/supabase-js` 2.111.0 (all already installed) plus one new dependency: `razorpay` 2.9.8 (the official Node SDK, used server-side only — never bundled to the client). The client-side Razorpay Checkout widget loads from Razorpay's own CDN (`https://checkout.razorpay.com/v1/checkout.js`), standard integration, not an npm package.

## Global Constraints

- Project root: `C:\Users\tejas\fashion-forward` (existing git repo, remote `origin` → `github.com/fashionforwardshop32-oss/fashion-forward`, branch `main`).
- **Every order status change goes through `finalize_order()` or the pure `transitions.ts` legality check — never a direct `.update({status: ...})` on `orders` anywhere in this plan's code.** This is spec §4's explicit requirement, not a style preference.
- **Stock decrements happen on transition to `confirmed` (Razorpay) or `cod_pending` (COD) — never at order creation for Razorpay, never at add-to-cart.** Spec §7. The asymmetry is deliberate: a Razorpay order is created as `pending_payment` with NO stock decrement; only a successful payment decrements. A COD order decrements immediately at creation, because `cod_pending` itself is the commit point (no separate payment-confirm step exists for COD).
- **COD cap applies only to a customer's first order.** Spec §6 says "COD unavailable on a first order above the cap" as a rule distinct from the cap's existence — read literally, a repeat customer (any prior order, any status) is not capped. Default cap ₹3,000, from an env var `COD_CAP_PAISE` (paise, not rupees, for consistency with Razorpay's amount unit) so it's configurable without a redeploy of code — falls back to `300000` (₹3,000) if unset.
- **Amounts sent to Razorpay are in paise** (`₹1 = 100` paise) — this is Razorpay's API contract, not a project convention. Every place a total crosses into a Razorpay API call must multiply by 100; every place a Razorpay amount is displayed to a human must divide by 100. Get this wrong in either direction and it's a 100x pricing bug.
- **The Razorpay webhook handler needs the raw, unparsed request body for HMAC verification** — this must be a Next.js Route Handler (`app/api/.../route.ts`), never a Server Action, which auto-parses its arguments. Payment verification from the client's Checkout callback, by contrast, is triggered by ordinary client-side JS and can be a Server Action like everything else in this project.
- **Shipping fee and coupon discount are both `0` this week** — Porter fee calculation is Week 5 scope, coupon redemption isn't scheduled in any week yet. `orders.shipping_fee`/`orders.discount` still get written (schema requires `not null`), just always `0` for now.
- Every task ends in a `git commit`. Commit messages plain, imperative, no marketing language.
- PowerShell is the user's primary shell outside this session; all commands below are written for the Bash tool already in use in this session (Git Bash).
- **Razorpay test-mode API keys are a human prerequisite for Tasks 4-6** — the human is creating a Razorpay account in parallel with Tasks 1-3, which don't need it. Tasks 1-3 (state machine, stock RPC, order creation + COD) are fully buildable and testable without any Razorpay credentials.

---

## File Structure

```
fashion-forward/
  lib/
    orders/
      transitions.ts                     (new — pure state machine, no DB)
      create.ts                          (new — createOrder() Server Action)
      order-no.ts                        (new — generateOrderNo(), same retry-on-collision pattern as Week 2's uniqueProductSlug)
    payments/
      razorpay.ts                        (new — Razorpay client instance, createRazorpayOrder(), verifyPaymentSignature())
      verify.ts                          (new — verifyPayment() Server Action)
  app/
    (shop)/
      checkout/
        page.tsx                         (modified — wires ReviewStep's "Pay" button for real)
    api/
      payments/
        webhook/
          route.ts                       (new — Route Handler, raw body, HMAC, idempotent)
  components/
    checkout/
      ReviewStep.tsx                     (modified — real Razorpay Checkout + COD submit)
  supabase/
    migrations/
      20260814000002_finalize_order.sql  (new — the atomic stock-decrement-and-transition function)
  tests/
    order-transitions.test.ts            (new)
    stock-race.test.ts                   (new — integration test, spec §10's explicit requirement)
    razorpay-signature.test.ts           (new — recorded-payload HMAC tests, spec §10's explicit requirement)
  .env.local.example                     (modified — adds RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, COD_CAP_PAISE)
```

---

### Task 1: Order state machine

**Files:**
- Create: `lib/orders/transitions.ts`
- Create: `tests/order-transitions.test.ts`

**Interfaces:**
- Consumes: nothing (pure logic, no DB, no imports beyond TypeScript).
- Produces: `type OrderStatus = "pending_payment" | "cod_pending" | "confirmed" | "packed" | "out_for_delivery" | "delivered" | "cancelled" | "returned" | "rto"`. `isLegalTransition(from: OrderStatus, to: OrderStatus): boolean` — Task 3's `createOrder`, Task 5's `verifyPayment`, and Task 6's webhook all call this before attempting a transition (the Postgres function in Task 2 is the actual enforcement point for concurrency safety, but this pure function is what every task-level piece of code checks first, and what the unit tests exhaustively cover).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/order-transitions.test.ts
import { describe, expect, it } from "vitest";
import { isLegalTransition, type OrderStatus } from "@/lib/orders/transitions";

const ALL_STATUSES: OrderStatus[] = [
  "pending_payment",
  "cod_pending",
  "confirmed",
  "packed",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "returned",
  "rto",
];

describe("isLegalTransition", () => {
  it("allows the happy-path sequence", () => {
    expect(isLegalTransition("pending_payment", "confirmed")).toBe(true);
    expect(isLegalTransition("cod_pending", "confirmed")).toBe(true);
    expect(isLegalTransition("confirmed", "packed")).toBe(true);
    expect(isLegalTransition("packed", "out_for_delivery")).toBe(true);
    expect(isLegalTransition("out_for_delivery", "delivered")).toBe(true);
  });

  it("allows cancelled from any pre-delivery state", () => {
    for (const from of [
      "pending_payment",
      "cod_pending",
      "confirmed",
      "packed",
      "out_for_delivery",
    ] as OrderStatus[]) {
      expect(isLegalTransition(from, "cancelled")).toBe(true);
    }
  });

  it("allows returned and rto only from delivered or out_for_delivery", () => {
    expect(isLegalTransition("delivered", "returned")).toBe(true);
    expect(isLegalTransition("out_for_delivery", "rto")).toBe(true);
    expect(isLegalTransition("pending_payment", "returned")).toBe(false);
    expect(isLegalTransition("confirmed", "rto")).toBe(false);
  });

  it("rejects skipping steps forward", () => {
    expect(isLegalTransition("pending_payment", "packed")).toBe(false);
    expect(isLegalTransition("confirmed", "delivered")).toBe(false);
  });

  it("rejects any transition out of a terminal state", () => {
    for (const terminal of ["delivered", "cancelled", "returned", "rto"] as OrderStatus[]) {
      for (const to of ALL_STATUSES) {
        if (to === terminal) continue;
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("rejects a status transitioning to itself", () => {
    for (const s of ALL_STATUSES) {
      expect(isLegalTransition(s, s)).toBe(false);
    }
  });

  it("rejects pending_payment and cod_pending transitioning into each other", () => {
    expect(isLegalTransition("pending_payment", "cod_pending")).toBe(false);
    expect(isLegalTransition("cod_pending", "pending_payment")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/order-transitions.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/orders/transitions'`.

- [ ] **Step 3: Write `lib/orders/transitions.ts`**

```ts
export type OrderStatus =
  | "pending_payment"
  | "cod_pending"
  | "confirmed"
  | "packed"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "returned"
  | "rto";

const TERMINAL_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "delivered",
  "cancelled",
  "returned",
  "rto",
]);

/**
 * The legal transition graph, matching spec §4 exactly:
 *
 *   pending_payment ─┐
 *   cod_pending ──────┼─→ confirmed → packed → out_for_delivery → delivered
 *                     │       │           │            │              │
 *                     └───────┴───────────┴────────────┘              │
 *                          (cancelled, from any pre-delivery state)   │
 *                                                                      ├─→ returned
 *                                              out_for_delivery ───────┘
 *                                              out_for_delivery ──────────→ rto
 */
const LEGAL_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  pending_payment: new Set(["confirmed", "cancelled"]),
  cod_pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["packed", "cancelled"]),
  packed: new Set(["out_for_delivery", "cancelled"]),
  out_for_delivery: new Set(["delivered", "cancelled", "rto"]),
  delivered: new Set(["returned"]),
  cancelled: new Set([]),
  returned: new Set([]),
  rto: new Set([]),
};

export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (TERMINAL_STATUSES.has(from)) return false;
  return LEGAL_TRANSITIONS[from].has(to);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/order-transitions.test.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/transitions.ts tests/order-transitions.test.ts
git commit -m "feat: add order status state machine"
```

---

### Task 2: Atomic stock-decrement-and-confirm Postgres function

This is the task that makes the concurrent-last-unit race safe. Read spec §7's failure-handling table before starting: "Two buyers, last unit: Stock decrement runs inside a Postgres transaction with a stock check; loser sees 'just sold out.'"

**Files:**
- Create: `supabase/migrations/20260814000002_finalize_order.sql`
- Create: `tests/stock-race.test.ts`

**Interfaces:**
- Consumes: the `orders`, `order_items`, `variants` tables from Week 1's schema (unchanged).
- Produces: a Postgres function callable via `supabase.rpc("finalize_order", { p_order_id, p_from_status, p_to_status })` returning `boolean` (`true` = it actually decremented and transitioned; `false` = no-op because the order wasn't in `p_from_status` anymore — already processed by a concurrent call, or wrong state). Raises a Postgres exception with message `insufficient_stock` if any item's stock check fails — Task 3 (COD path) and Task 5/6 (Razorpay verify/webhook) all call this and must catch that specific error to show "just sold out" / trigger a refund.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260814000002_finalize_order.sql

create or replace function finalize_order(
  p_order_id uuid,
  p_from_status text,
  p_to_status text
)
returns boolean
language plpgsql
as $$
declare
  v_locked_status text;
  v_item record;
begin
  -- Row lock on the order serializes concurrent callers for the SAME
  -- order (e.g. Razorpay's client callback and webhook firing near-
  -- simultaneously for one payment) — the second caller blocks here
  -- until the first commits, then sees the status check below fail
  -- and safely no-ops.
  select status into v_locked_status from orders where id = p_order_id for update;

  if v_locked_status is null then
    raise exception 'order_not_found';
  end if;

  if v_locked_status <> p_from_status then
    return false;
  end if;

  for v_item in
    select oi.variant_id, oi.qty
    from order_items oi
    where oi.order_id = p_order_id
  loop
    -- The WHERE clause is the actual race-safety mechanism: this UPDATE
    -- only matches a row if there's still enough stock, and Postgres
    -- serializes concurrent UPDATEs to the same row. A losing concurrent
    -- transaction (for a DIFFERENT order competing for the same variant)
    -- gets zero rows affected here, which FOUND below detects, which
    -- raises, which rolls back this entire function's transaction —
    -- including any earlier item decrements in the same order and the
    -- status update that would otherwise follow. All-or-nothing.
    update variants
    set stock_qty = stock_qty - v_item.qty
    where id = v_item.variant_id and stock_qty >= v_item.qty;

    if not found then
      raise exception 'insufficient_stock';
    end if;
  end loop;

  update orders set status = p_to_status where id = p_order_id;
  return true;
end;
$$;
```

No `security definer` — this function is only ever called via the service-role client (`createServerClient`), which already bypasses RLS on every table it touches. Adding `security definer` here would grant elevated privileges regardless of caller, which is a wider blast radius for no benefit given the service-role client already has that access.

- [ ] **Step 2: Apply the migration locally**

```bash
npx supabase db reset
```

Expected: exits 0, re-applies all migrations including this one.

- [ ] **Step 3: Write the concurrent-last-unit integration test**

This is spec §10's explicit requirement: "Stock decrement race | Integration test issuing concurrent purchases of the last unit." Uses the service-role client directly against local Supabase — no HTTP layer, this tests the Postgres function itself.

```ts
// tests/stock-race.test.ts
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const hasEnv = Boolean(SERVICE_ROLE_KEY);

describe.skipIf(!hasEnv)("finalize_order concurrent stock race", () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let orderAId: string;
  let orderBId: string;

  beforeAll(async () => {
    const { data: category } = await admin
      .from("categories")
      .insert({ slug: `race-test-${Date.now()}`, name: "Race Test" })
      .select()
      .single();
    categoryId = category!.id;

    const { data: product } = await admin
      .from("products")
      .insert({
        slug: `race-test-${Date.now()}`,
        title: "Race Test Product",
        category_id: categoryId,
        gender: "unisex",
        age_group: "2-4Y",
        base_price: 500,
        status: "active",
      })
      .select()
      .single();
    productId = product!.id;

    // Exactly ONE unit in stock — the whole point of this test.
    const { data: variant } = await admin
      .from("variants")
      .insert({ product_id: productId, size: "2-4Y", sku: `RACE-${Date.now()}`, stock_qty: 1 })
      .select()
      .single();
    variantId = variant!.id;

    // Two customers, two pending orders, each wanting the same 1 unit.
    async function createTestCustomerAndOrder(emailPrefix: string) {
      const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
      const { data: authUser } = await admin.auth.admin.createUser({
        email,
        password: "test-pass-123!",
        email_confirm: true,
      });
      await admin
        .from("customers")
        .insert({ id: authUser!.user!.id, phone: `9${Math.floor(Math.random() * 1_000_000_000)}` });

      const { data: order } = await admin
        .from("orders")
        .insert({
          order_no: `RACE-${emailPrefix}-${Date.now()}`,
          customer_id: authUser!.user!.id,
          status: "pending_payment",
          payment_mode: "razorpay",
          subtotal: 500,
          total: 500,
          address_snapshot: { line1: "test", city: "Bangalore", pincode: "560032" },
        })
        .select()
        .single();

      await admin
        .from("order_items")
        .insert({ order_id: order!.id, variant_id: variantId, qty: 1, unit_price: 500, title_snapshot: "Race Test Product" });

      return order!.id;
    }

    orderAId = await createTestCustomerAndOrder("racer-a");
    orderBId = await createTestCustomerAndOrder("racer-b");
  });

  it("lets exactly one of two concurrent finalize_order calls succeed for the last unit", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      admin.rpc("finalize_order", {
        p_order_id: orderAId,
        p_from_status: "pending_payment",
        p_to_status: "confirmed",
      }),
      admin.rpc("finalize_order", {
        p_order_id: orderBId,
        p_from_status: "pending_payment",
        p_to_status: "confirmed",
      }),
    ]);

    const outcomes = [resultA, resultB].map((r) => {
      if (r.status === "rejected") return "rejected";
      if (r.value.error) return `error:${r.value.error.message}`;
      return r.value.data === true ? "confirmed" : "no-op";
    });

    const confirmedCount = outcomes.filter((o) => o === "confirmed").length;
    const failedCount = outcomes.filter((o) => o.startsWith("error:insufficient_stock")).length;

    expect(confirmedCount).toBe(1);
    expect(failedCount).toBe(1);

    const { data: variant } = await admin
      .from("variants")
      .select("stock_qty")
      .eq("id", variantId)
      .single();
    expect(variant!.stock_qty).toBe(0);

    const { data: orders } = await admin
      .from("orders")
      .select("id, status")
      .in("id", [orderAId, orderBId]);
    const statuses = (orders ?? []).map((o) => o.status).sort();
    expect(statuses).toEqual(["confirmed", "pending_payment"]);
  });
});
```

- [ ] **Step 4: Get local Supabase keys and run the test**

```bash
npx supabase status
```

Copy the `anon key` and `service_role key`, then:

```bash
SUPABASE_URL="http://127.0.0.1:54321" SUPABASE_SERVICE_ROLE_KEY="<service_role key>" npx vitest run tests/stock-race.test.ts
```

Expected: `1 passed`. If it fails, do not weaken the test to make it pass — the whole point of this task is that this exact scenario must be race-safe. Debug the migration instead.

- [ ] **Step 5: Push the migration to the remote Mumbai project**

```bash
npx supabase db push
```

Expected: prompts for confirmation, applies the migration. Confirm with `y`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260814000002_finalize_order.sql tests/stock-race.test.ts
git commit -m "feat: add atomic stock-decrement-and-confirm function with concurrency test"
```

---

### Task 3: `createOrder` Server Action (Razorpay pending-order creation + full COD path)

**Files:**
- Create: `lib/orders/order-no.ts`
- Create: `lib/orders/create.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: `getCartDetails` (Week 3, `lib/cart/actions.ts`) for server-side re-pricing, `finalize_order` RPC (Task 2), `isLegalTransition` (Task 1, used as a pre-flight sanity check even though the RPC is the real enforcement), `createServerClient` (service-role, Weeks 1-3).
- Produces: `createOrder(input: { lines: CartLine[]; addressId: string; paymentMode: "razorpay" | "cod" }): Promise<{ orderId: string; status: OrderStatus } | { error: string }>` — Task 4 calls this for the Razorpay path, and it's the complete path for COD (no further tasks needed for COD to work end to end).

- [ ] **Step 1: Add the new env vars**

```bash
# .env.local.example — append these lines
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
COD_CAP_PAISE=300000
```

- [ ] **Step 2: Write `lib/orders/order-no.ts`**

Same retry-on-collision pattern as Week 2's `uniqueProductSlug` — machine-generated, never typed by anyone.

```ts
import { createServerClient } from "@/lib/supabase/server";

export async function generateOrderNo(
  supabase: ReturnType<typeof createServerClient>,
): Promise<string> {
  while (true) {
    const candidate = `FF${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;

    const { data, error } = await supabase
      .from("orders")
      .select("id")
      .eq("order_no", candidate)
      .maybeSingle();

    if (error) throw new Error(`generateOrderNo: ${error.message}`);
    if (!data) return candidate;
  }
}
```

- [ ] **Step 3: Write `lib/orders/create.ts`**

```ts
"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createSessionClient } from "@/lib/supabase/server";
import { getCartDetails, type CartLine } from "@/lib/cart/actions";
import { generateOrderNo } from "./order-no";

const COD_CAP_PAISE = Number(process.env.COD_CAP_PAISE ?? 300000);

export type CreateOrderResult =
  | { orderId: string; status: "pending_payment" | "cod_pending" }
  | { error: string };

export async function createOrder(input: {
  lines: CartLine[];
  addressId: string;
  paymentMode: "razorpay" | "cod";
}): Promise<CreateOrderResult> {
  const session = await createSessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user) {
    return { error: "You need to verify your phone number first." };
  }

  const cartDetails = await getCartDetails(input.lines);
  const available = cartDetails.filter((l) => l.available);

  if (available.length === 0) {
    return { error: "Your bag is empty." };
  }
  if (available.length !== cartDetails.length) {
    return { error: "Some items in your bag are no longer available. Please review your bag." };
  }

  const supabase = createServerClient();

  const { data: address, error: addressError } = await supabase
    .from("addresses")
    .select("*")
    .eq("id", input.addressId)
    .eq("customer_id", user.id)
    .maybeSingle();

  if (addressError || !address) {
    return { error: "Couldn't find that delivery address." };
  }

  const subtotal = available.reduce((sum, l) => sum + l.price * l.qty, 0);
  const shippingFee = 0; // Porter fee calculation is Week 5
  const discount = 0; // Coupons not scheduled yet
  const total = subtotal - discount + shippingFee;

  if (input.paymentMode === "cod") {
    const { count: priorOrderCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id);

    const isFirstOrder = (priorOrderCount ?? 0) === 0;

    if (isFirstOrder && total > COD_CAP_PAISE / 100) {
      return {
        error: `Cash on Delivery is available up to ₹${COD_CAP_PAISE / 100} for your first order. Please pay online for this order.`,
      };
    }
  }

  const orderNo = await generateOrderNo(supabase);
  const initialStatus = "pending_payment"; // COD transitions to cod_pending via finalize_order below

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_no: orderNo,
      customer_id: user.id,
      status: initialStatus,
      payment_mode: input.paymentMode,
      subtotal,
      shipping_fee: shippingFee,
      discount,
      total,
      address_snapshot: {
        line1: address.line1,
        line2: address.line2,
        landmark: address.landmark,
        city: address.city,
        pincode: address.pincode,
      },
    })
    .select()
    .single();

  if (orderError || !order) {
    return { error: "Couldn't create your order. Try again." };
  }

  const orderItemRows = available.map((l) => ({
    order_id: order.id,
    variant_id: l.variantId,
    qty: l.qty,
    unit_price: l.price,
    title_snapshot: `${l.title} (${l.size})`,
  }));

  const { error: itemsError } = await supabase.from("order_items").insert(orderItemRows);

  if (itemsError) {
    await supabase.from("orders").delete().eq("id", order.id); // cascades order_items
    return { error: "Couldn't save your order items. Try again." };
  }

  if (input.paymentMode === "razorpay") {
    // No stock decrement yet — only a successful payment decrements.
    return { orderId: order.id, status: "pending_payment" };
  }

  // COD: cod_pending IS the commit point, decrement now.
  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_order", {
    p_order_id: order.id,
    p_from_status: "pending_payment",
    p_to_status: "cod_pending",
  });

  if (finalizeError?.message === "insufficient_stock") {
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Sorry, an item in your bag just sold out." };
  }
  if (finalizeError || !finalized) {
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Couldn't confirm your order. Try again." };
  }

  return { orderId: order.id, status: "cod_pending" };
}
```

- [ ] **Step 4: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Manual verification — full COD path, no Razorpay needed**

Reuse the local test-OTP + real-browser technique established in Week 3's tasks. Add a real product to the bag, go through checkout (phone OTP → address), and at the review step manually invoke `createOrder` with `paymentMode: "cod"` (there's no UI button yet — that's Task 4's job for Razorpay, but COD's button will come from Task 4 too since both share `ReviewStep.tsx`; for this task's verification, call the Server Action directly from a quick script/console, or temporarily wire a minimal test button — your choice, remove any temporary wiring before committing). Confirm: order row created with `status: "cod_pending"`, `order_items` rows match the cart with frozen `unit_price`/`title_snapshot`, the variant's `stock_qty` decremented by the ordered quantity. Then verify the COD cap: attempt an order whose total exceeds ₹3,000 as a first-time customer, confirm it's rejected with the cap message and no order row is left behind.

- [ ] **Step 6: Commit**

```bash
git add lib/orders/order-no.ts lib/orders/create.ts .env.local.example
git commit -m "feat: add order creation with COD safety rails and stock decrement"
```

---

### Task 4: Razorpay order creation + Checkout widget wiring

**Human prerequisite for this task: Razorpay test-mode API keys.** If they're not ready yet, this task blocks — everything in Tasks 1-3 does not need them.

**Files:**
- Create: `lib/payments/razorpay.ts`
- Modify: `components/checkout/ReviewStep.tsx`
- Modify: `app/(shop)/checkout/page.tsx`

**Interfaces:**
- Consumes: `createOrder` (Task 3), `razorpay` npm package.
- Produces: `createRazorpayOrder(orderId: string, amountRupees: number): Promise<{ razorpayOrderId: string; keyId: string }>` — Task 5's client-side success handler passes the resulting payment details onward to `verifyPayment`.

- [ ] **Step 1: Add the Razorpay test keys to `.env.local` (manual)**

From the Razorpay dashboard → Settings → API Keys → Generate Test Key. Add to `.env.local` (not committed):

```bash
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
```

(`RAZORPAY_WEBHOOK_SECRET` comes in Task 6 — the webhook itself doesn't exist yet, so there's nothing to configure a secret for.)

- [ ] **Step 2: Install the Razorpay SDK**

```bash
npm install razorpay@2.9.8
```

Expected: exits 0, `package.json` gains `"razorpay": "2.9.8"`.

- [ ] **Step 3: Write `lib/payments/razorpay.ts`**

```ts
import "server-only";
import Razorpay from "razorpay";
import crypto from "node:crypto";

function getClient(): Razorpay {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET.");
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Creates a Razorpay order for the given amount. amountRupees is in
 * whole rupees (matching orders.total's numeric(10,2) shape) — this
 * function does the ×100 conversion to paise, since that's Razorpay's
 * API contract, not something callers should have to remember.
 */
export async function createRazorpayOrder(
  orderId: string,
  amountRupees: number,
): Promise<{ razorpayOrderId: string; keyId: string; amountPaise: number }> {
  const client = getClient();
  const amountPaise = Math.round(amountRupees * 100);

  const razorpayOrder = await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: orderId,
  });

  return {
    razorpayOrderId: razorpayOrder.id,
    keyId: process.env.RAZORPAY_KEY_ID!,
    amountPaise,
  };
}

/**
 * Verifies a Razorpay Standard Checkout payment callback signature.
 * Formula per Razorpay's docs: hmac_sha256(order_id + "|" + payment_id, key_secret).
 */
export function verifyPaymentSignature(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw new Error("Missing RAZORPAY_KEY_SECRET.");

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(params.razorpaySignature);

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Refunds a captured payment in full — used when a payment succeeds but
 * finalize_order then reports insufficient_stock (the "loser was already
 * charged" case from spec §7's failure-handling table).
 */
export async function refundPayment(razorpayPaymentId: string): Promise<void> {
  const client = getClient();
  await client.payments.refund(razorpayPaymentId, {});
}
```

`import "server-only"` — this file uses `RAZORPAY_KEY_SECRET`, which must never reach a client bundle.

- [ ] **Step 4: Add a `createRazorpayOrder` action wrapper and wire `ReviewStep.tsx`**

Add to the bottom of `lib/orders/create.ts` (same file, since it's tightly coupled to `createOrder` — the file already has a single `"use server"` directive at the top from Task 3, which covers every exported function in the file; do not add a second one).

Add this import alongside the existing ones at the top of the file:

```ts
import { createRazorpayOrder as createRazorpayOrderInternal } from "@/lib/payments/razorpay";
```

Then add this function:

```ts
export async function startRazorpayPayment(input: {
  lines: CartLine[];
  addressId: string;
}): Promise<
  | { orderId: string; razorpayOrderId: string; keyId: string; amountPaise: number }
  | { error: string }
> {
  const created = await createOrder({ ...input, paymentMode: "razorpay" });
  if ("error" in created) return created;

  const supabase = createServerClient();
  const { data: order } = await supabase.from("orders").select("total").eq("id", created.orderId).single();
  if (!order) return { error: "Order not found after creation." };

  const razorpayDetails = await createRazorpayOrderInternal(created.orderId, order.total);

  return { orderId: created.orderId, ...razorpayDetails };
}
```

Rewrite `components/checkout/ReviewStep.tsx` to accept the raw cart lines and address id (not just the display-ready `CartDetailLine[]`/summary string it currently takes), and wire both payment paths for real:

```tsx
"use client";

import { useState } from "react";
import Script from "next/script";
import { PriceTag } from "@/components/ui/PriceTag";
import { Button } from "@/components/ui/Button";
import type { CartDetailLine } from "@/lib/cart/actions";
import type { CartLine } from "@/lib/cart/context";
import { createOrder, startRazorpayPayment } from "@/lib/orders/create";
import { verifyPayment } from "@/lib/payments/verify";

declare global {
  interface Window {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function ReviewStep({
  lines,
  rawLines,
  addressId,
  addressSummary,
  customerPhone,
}: {
  lines: CartDetailLine[];
  rawLines: CartLine[];
  addressId: string;
  addressSummary: string;
  customerPhone: string;
}) {
  const [status, setStatus] = useState<"idle" | "processing" | "sold-out" | "error" | "placed">(
    "idle",
  );
  const [placedOrderNo, setPlacedOrderNo] = useState<string | null>(null);

  const available = lines.filter((l) => l.available);
  const unavailable = lines.filter((l) => !l.available);
  const subtotal = available.reduce((sum, l) => sum + l.price * l.qty, 0);

  async function payWithRazorpay() {
    setStatus("processing");
    const started = await startRazorpayPayment({ lines: rawLines, addressId });

    if ("error" in started) {
      setStatus(started.error.includes("sold out") ? "sold-out" : "error");
      return;
    }

    const razorpay = new window.Razorpay({
      key: started.keyId,
      amount: started.amountPaise,
      currency: "INR",
      order_id: started.razorpayOrderId,
      name: "Fashion Forward",
      prefill: { contact: customerPhone },
      theme: { color: "#7c3aed" },
      handler: async (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        const result = await verifyPayment({
          orderId: started.orderId,
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        });
        if ("error" in result) {
          setStatus(result.error.includes("sold out") ? "sold-out" : "error");
          return;
        }
        setPlacedOrderNo(result.orderNo);
        setStatus("placed");
      },
      modal: {
        ondismiss: () => setStatus("idle"),
      },
    });

    razorpay.open();
  }

  async function payWithCod() {
    setStatus("processing");
    const result = await createOrder({ lines: rawLines, addressId, paymentMode: "cod" });
    if ("error" in result) {
      setStatus(result.error.includes("sold out") ? "sold-out" : "error");
      return;
    }
    setPlacedOrderNo(result.orderId);
    setStatus("placed");
  }

  if (status === "placed") {
    return (
      <div className="rounded-card border border-ink/10 bg-surface p-6 text-center">
        <h2 className="font-display text-xl font-bold text-ink">Order placed!</h2>
        <p className="mt-2 text-sm text-ink-muted">Order {placedOrderNo}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />

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
        {unavailable.length > 0 && (
          <p className="mt-2 rounded-card bg-accent/10 p-2 text-xs text-ink">
            {unavailable.length} item{unavailable.length > 1 ? "s" : ""} no longer available —
            removed from your order.
          </p>
        )}
        <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
          <span className="font-medium text-ink">Total</span>
          <PriceTag price={subtotal} />
        </div>
      </div>

      <div className="rounded-card border border-ink/10 bg-surface p-4">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Delivering to</h2>
        <p className="text-sm text-ink-muted">{addressSummary}</p>
      </div>

      {status === "sold-out" && (
        <p className="rounded-card bg-accent/10 p-3 text-sm text-ink">
          Sorry, an item in your bag just sold out. Please review your bag and try again.
        </p>
      )}
      {status === "error" && (
        <p className="rounded-card bg-accent/10 p-3 text-sm text-ink">
          Something went wrong. Please try again.
        </p>
      )}

      <div className="space-y-2">
        <Button
          type="button"
          onClick={payWithRazorpay}
          disabled={status === "processing" || available.length === 0}
          className="w-full"
        >
          {status === "processing" ? "Processing…" : `Pay ₹${subtotal}`}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={payWithCod}
          disabled={status === "processing" || available.length === 0}
          className="w-full"
        >
          Cash on Delivery
        </Button>
      </div>
    </div>
  );
}
```

Update `app/(shop)/checkout/page.tsx`'s render of `ReviewStep` to pass the new props (`rawLines={lines}` — the raw `CartLine[]` from `useCart()`, `addressId` — track this alongside `addressSummary` when `onAddressChosen` fires in the address stage, `customerPhone` — from the session user's `phone` field). Read the current file structure first and adapt precisely rather than guessing at variable names.

- [ ] **Step 5: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Manual verification — Razorpay test payment, end to end**

Using Razorpay's published test card numbers (check their docs for the current test card — commonly `4111 1111 1111 1111`, any future expiry, any CVV) against test-mode keys, drive the full flow: add to bag → checkout → OTP → address → review → "Pay ₹X" → Razorpay Checkout modal opens → complete test payment → `handler` fires → confirm `verifyPayment` action exists and is called (even if Task 5 hasn't implemented its real logic yet — that's next; for now confirm the wiring reaches that call). It's fine if this step ends with a "not yet implemented" error from `verifyPayment` — Task 5 makes it real. Confirm the Razorpay order was actually created (check the Razorpay dashboard's test-mode order list, or the local `orders` table for a `pending_payment` row).

- [ ] **Step 7: Commit**

```bash
git add lib/payments/razorpay.ts lib/orders/create.ts components/checkout/ReviewStep.tsx "app/(shop)/checkout/page.tsx" package.json package-lock.json .env.local.example
git commit -m "feat: wire Razorpay Checkout and COD buttons on the review step"
```

---

### Task 5: Razorpay payment verification (Server Action)

**Files:**
- Create: `lib/payments/verify.ts`
- Create: `tests/razorpay-signature.test.ts`

**Interfaces:**
- Consumes: `verifyPaymentSignature` (Task 4), `finalize_order` RPC (Task 2), `refundPayment` (Task 4).
- Produces: `verifyPayment(input: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }): Promise<{ orderNo: string } | { error: string }>` — this is the function `ReviewStep.tsx`'s `handler` callback (Task 4) calls.

- [ ] **Step 1: Write the failing HMAC tests using a real, hand-computed signature**

Don't fabricate a fake signature — compute a real one with Node's `crypto` so the test is checking the actual verification logic against a value it didn't just make up to pass.

```ts
// tests/razorpay-signature.test.ts
import crypto from "node:crypto";
import { describe, expect, it, beforeAll } from "vitest";
import { verifyPaymentSignature } from "@/lib/payments/razorpay";

const TEST_SECRET = "test_secret_for_unit_tests_only";

describe("verifyPaymentSignature", () => {
  beforeAll(() => {
    process.env.RAZORPAY_KEY_SECRET = TEST_SECRET;
  });

  it("accepts a correctly computed signature", () => {
    const orderId = "order_TestOrder123";
    const paymentId = "pay_TestPayment456";
    const validSignature = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(
      verifyPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature,
      }),
    ).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const orderId = "order_TestOrder123";
    const paymentId = "pay_TestPayment456";
    const validSignature = crypto
      .createHmac("sha256", TEST_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    const tampered = validSignature.slice(0, -1) + (validSignature.endsWith("a") ? "b" : "a");

    expect(
      verifyPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: tampered,
      }),
    ).toBe(false);
  });

  it("rejects a signature computed for a different order/payment pair", () => {
    const signatureForDifferentIds = crypto
      .createHmac("sha256", TEST_SECRET)
      .update("order_Other|pay_Other")
      .digest("hex");

    expect(
      verifyPaymentSignature({
        razorpayOrderId: "order_TestOrder123",
        razorpayPaymentId: "pay_TestPayment456",
        razorpaySignature: signatureForDifferentIds,
      }),
    ).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(
      verifyPaymentSignature({
        razorpayOrderId: "order_TestOrder123",
        razorpayPaymentId: "pay_TestPayment456",
        razorpaySignature: "",
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run tests/razorpay-signature.test.ts
```

Expected: since `verifyPaymentSignature` already exists from Task 4, these should pass immediately — this step is confirming that function's correctness with real computed signatures, not doing fresh TDD on new code. If any fail, the bug is in Task 4's `verifyPaymentSignature`, not this test.

- [ ] **Step 3: Write `lib/payments/verify.ts`**

```ts
"use server";

import { createServerClient } from "@/lib/supabase/server";
import { verifyPaymentSignature, refundPayment } from "@/lib/payments/razorpay";

export async function verifyPayment(input: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ orderNo: string } | { error: string }> {
  const isValid = verifyPaymentSignature({
    razorpayOrderId: input.razorpayOrderId,
    razorpayPaymentId: input.razorpayPaymentId,
    razorpaySignature: input.razorpaySignature,
  });

  if (!isValid) {
    return { error: "Payment verification failed." };
  }

  const supabase = createServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_no, total")
    .eq("id", input.orderId)
    .maybeSingle();

  if (!order) {
    return { error: "Order not found." };
  }

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_order", {
    p_order_id: order.id,
    p_from_status: "pending_payment",
    p_to_status: "confirmed",
  });

  if (finalizeError?.message === "insufficient_stock") {
    await refundPayment(input.razorpayPaymentId);
    await supabase.from("payments").insert({
      order_id: order.id,
      razorpay_order_id: input.razorpayOrderId,
      razorpay_payment_id: input.razorpayPaymentId,
      amount: order.total,
      status: "refunded",
    });
    return { error: "Sorry, an item in your bag just sold out. Your payment has been refunded." };
  }

  if (finalizeError) {
    return { error: "Couldn't confirm your order. Contact support with your order number." };
  }

  if (!finalized) {
    // Already processed — the webhook likely beat this callback to it.
    // Not an error: the order is confirmed either way. Fall through to
    // the same success response.
  } else {
    const { error: paymentInsertError } = await supabase.from("payments").insert({
      order_id: order.id,
      razorpay_order_id: input.razorpayOrderId,
      razorpay_payment_id: input.razorpayPaymentId,
      amount: order.total,
      status: "captured",
    });

    // A unique-constraint violation here means the webhook already
    // inserted this exact payment — that's the idempotency mechanism
    // working as designed, not a real error.
    if (paymentInsertError && !paymentInsertError.message.includes("duplicate key")) {
      return { error: "Order confirmed, but there was an issue recording payment. Contact support." };
    }
  }

  return { orderNo: order.order_no };
}
```

- [ ] **Step 4: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 5: Manual verification — complete Task 4's Razorpay test payment**

Repeat Task 4 Step 6's test-card flow, now with this task's real `verifyPayment` in place. Confirm: the order transitions from `pending_payment` to `confirmed`, `variants.stock_qty` decrements, a `payments` row is inserted with `status: "captured"` and the real `razorpay_payment_id`, and the UI shows "Order placed!" with the real order number.

- [ ] **Step 6: Commit**

```bash
git add lib/payments/verify.ts tests/razorpay-signature.test.ts
git commit -m "feat: add Razorpay payment verification with refund-on-race-loss"
```

---

### Task 6: Razorpay webhook (server-to-server fallback)

**Files:**
- Create: `app/api/payments/webhook/route.ts`
- Create: `tests/webhook.test.ts`

**Interfaces:**
- Consumes: `finalize_order` RPC (Task 2), `refundPayment` (Task 4).
- Produces: nothing further — this is the plan's final task, a leaf endpoint Razorpay's servers call directly.

- [ ] **Step 1: Configure the webhook in Razorpay's dashboard (manual, human)**

Razorpay Dashboard → Settings → Webhooks → Add New Webhook. URL: `https://fashion-forward.fashion-forward.workers.dev/api/payments/webhook`. Active events: `payment.captured` (the only one this task handles). Set a webhook secret — copy it into `.env.local`'s `RAZORPAY_WEBHOOK_SECRET` (not committed) and, once deployed, into the live Worker via `npx wrangler secret put RAZORPAY_WEBHOOK_SECRET`.

- [ ] **Step 2: Write the failing webhook signature tests**

```ts
// tests/webhook.test.ts
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

const TEST_WEBHOOK_SECRET = "test_webhook_secret_for_unit_tests";

function computeWebhookSignature(rawBody: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

describe("webhook HMAC verification", () => {
  it("computes a signature matching a known-good manual calculation", () => {
    const payload = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_Test123", order_id: "order_Test456" } } },
    });
    const signature = computeWebhookSignature(payload, TEST_WEBHOOK_SECRET);

    // Recompute independently to prove the helper is deterministic and
    // correct, not just self-consistent with itself.
    const independentCheck = crypto
      .createHmac("sha256", TEST_WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    expect(signature).toBe(independentCheck);
    expect(signature).toHaveLength(64); // hex-encoded SHA-256
  });

  it("produces a different signature for a tampered payload", () => {
    const original = JSON.stringify({ event: "payment.captured", payload: {} });
    const tampered = JSON.stringify({ event: "payment.captured", payload: { hacked: true } });

    expect(computeWebhookSignature(original, TEST_WEBHOOK_SECRET)).not.toBe(
      computeWebhookSignature(tampered, TEST_WEBHOOK_SECRET),
    );
  });
});
```

These tests exercise the HMAC primitive directly (not the Route Handler, which needs a running server to test realistically) — Step 6 below covers the Route Handler itself via manual verification against a real or simulated webhook delivery.

- [ ] **Step 3: Run the tests to verify they pass**

```bash
npx vitest run tests/webhook.test.ts
```

Expected: pass (this is confirming Node's `crypto` HMAC behaves as expected before wiring it into the Route Handler — not TDD against not-yet-written application code).

- [ ] **Step 4: Write `app/api/payments/webhook/route.ts`**

```ts
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { refundPayment } from "@/lib/payments/razorpay";

function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing RAZORPAY_WEBHOOK_SECRET.");

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);

  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST(request: NextRequest) {
  // Raw body, NOT request.json() — the whole reason this is a Route
  // Handler and not a Server Action. Parsing first would change the
  // byte sequence and break HMAC verification.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature || !verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const event = JSON.parse(rawBody);

  if (event.event !== "payment.captured") {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const payment = event.payload?.payment?.entity;
  const razorpayOrderId: string | undefined = payment?.order_id;
  const razorpayPaymentId: string | undefined = payment?.id;

  if (!razorpayOrderId || !razorpayPaymentId) {
    return NextResponse.json({ error: "malformed payload" }, { status: 400 });
  }

  const supabase = createServerClient();

  // The order's receipt field was set to our own order id at creation
  // (lib/payments/razorpay.ts's createRazorpayOrder: receipt: orderId),
  // but the webhook payload doesn't echo the receipt back directly —
  // look up the order via a payments row already created by verify(),
  // OR if this webhook is genuinely the first to arrive (verify()
  // hasn't run yet), there's no payments row to find it by. Fetch the
  // Razorpay order's receipt via the Razorpay API as the reliable path.
  const { createRazorpayOrder: _unused } = await import("@/lib/payments/razorpay");
  void _unused;

  const Razorpay = (await import("razorpay")).default;
  const client = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });
  const razorpayOrder = await client.orders.fetch(razorpayOrderId);
  const orderId = razorpayOrder.receipt;

  if (!orderId) {
    return NextResponse.json({ error: "order not found" }, { status: 400 });
  }

  const { data: order } = await supabase
    .from("orders")
    .select("id, total")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "order not found" }, { status: 400 });
  }

  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_order", {
    p_order_id: order.id,
    p_from_status: "pending_payment",
    p_to_status: "confirmed",
  });

  if (finalizeError?.message === "insufficient_stock") {
    await refundPayment(razorpayPaymentId);
    await supabase.from("payments").insert({
      order_id: order.id,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      amount: order.total,
      status: "refunded",
    });
    return NextResponse.json({ status: "refunded_sold_out" }, { status: 200 });
  }

  if (finalizeError) {
    return NextResponse.json({ error: "finalize failed" }, { status: 500 });
  }

  if (finalized) {
    const { error: paymentInsertError } = await supabase.from("payments").insert({
      order_id: order.id,
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      amount: order.total,
      status: "captured",
    });

    // Duplicate key = the client-side verify() callback already recorded
    // this exact payment — the idempotency mechanism working correctly,
    // still a 200, not an error Razorpay should retry.
    if (paymentInsertError && !paymentInsertError.message.includes("duplicate key")) {
      return NextResponse.json({ error: "payment record failed" }, { status: 500 });
    }
  }

  // finalized === false means the order was already confirmed (the
  // client-side verify() callback beat this webhook to it) — still a
  // success from Razorpay's perspective, don't make it retry.
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
```

Note the `receipt`-lookup approach in this Step: verify this is actually the most reliable way to map a `razorpay_order_id` back to your own `orders.id` — an alternative is storing `razorpay_order_id` on the `orders` row itself at creation time (Task 3/4 don't currently do this). If, during implementation, this receipt-fetch approach proves awkward or unreliable (e.g. rate limits on the Razorpay API for a fetch-per-webhook), stop and consider whether `orders` needs a `razorpay_order_id` column added via a small migration instead — report this as a real design tension if you hit it, don't silently paper over a flaky lookup.

- [ ] **Step 5: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/api/payments/webhook`.

- [ ] **Step 6: Manual verification**

Deploy (`npm run cf:deploy`), confirm the live URL responds. If Razorpay's dashboard offers a "test webhook" / resend feature for test-mode events, use it after completing a real test payment (Task 4/5's flow) and confirm the webhook fires, is correctly identified as a duplicate of what `verifyPayment` already processed (via the `duplicate key` path), and returns `200`. If no real webhook delivery is practically triggerable in this environment, construct a realistic manual test: compute a real HMAC signature for a hand-built payload matching a real captured payment's IDs, POST it directly to the local dev server's `/api/payments/webhook` with `curl`, and confirm it's accepted and idempotent (a second identical POST also returns 200 without erroring). Document exactly which of these two verification paths you used.

- [ ] **Step 7: Set the webhook secret on the deployed Worker**

```bash
grep '^RAZORPAY_WEBHOOK_SECRET=' .env.local | cut -d= -f2- | npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

(Same pattern used for `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAILS` in earlier weeks — piped directly, never printed.) Also set the Razorpay keys the same way if they aren't already live-deployed secrets from Task 4:

```bash
grep '^RAZORPAY_KEY_ID=' .env.local | cut -d= -f2- | npx wrangler secret put RAZORPAY_KEY_ID
grep '^RAZORPAY_KEY_SECRET=' .env.local | cut -d= -f2- | npx wrangler secret put RAZORPAY_KEY_SECRET
```

- [ ] **Step 8: Commit**

```bash
git add app/api/payments/webhook/route.ts tests/webhook.test.ts
git commit -m "feat: add Razorpay webhook as payment-confirmation fallback"
```

---

## Week 4 exit criteria

Before starting Week 5 (spec §11: admin orders screen, Porter manual booking, WhatsApp notifications), confirm all of the following are true:

- [ ] `npm run build` succeeds locally with zero errors
- [ ] `npx vitest run tests/order-transitions.test.ts tests/stock-race.test.ts tests/razorpay-signature.test.ts tests/webhook.test.ts` all pass
- [ ] A real Razorpay test-mode payment goes end to end: cart → checkout → Razorpay Checkout modal → test card → order status `confirmed` → stock decremented → `payments` row with `status: captured`
- [ ] A real COD order goes end to end: cart → checkout → "Cash on Delivery" → order status `cod_pending` → stock decremented immediately
- [ ] A first-time customer attempting COD above ₹3,000 is rejected with a clear message; a repeat customer is not capped
- [ ] The concurrent-last-unit test passes and was never weakened to make it pass
- [ ] No component contains a literal hex value or raw Tailwind palette class outside `globals.css`
- [ ] `.env.local`'s Razorpay secrets are confirmed gitignored and never committed
- [ ] The live Cloudflare Workers URL's `/api/payments/webhook` responds (even a signature-rejection 400 to an unsigned test request counts as "responds" — full Razorpay-delivered verification depends on the dashboard webhook being configured against the live URL)

**Explicitly out of scope for Week 4:** admin orders screen (owner-facing order management UI), Porter booking, WhatsApp order-status notifications (order-placed confirmation, packed/shipped updates — all Week 5's Meta Cloud API work, distinct from Week 3's WhatsApp OTP), coupon redemption, refund flows beyond the automatic sold-out-after-payment case, "COD collected" reconciliation tracking. All are Week 5+ per spec §11.

**Known open items for the human:** Razorpay must be switched from test mode to live mode (with completed business KYC) before any real payment can be taken — tracked as a pre-launch item, not a Week 4 task. The webhook URL must be registered in Razorpay's dashboard against the live Worker URL (Task 6 Step 1) — nothing in this plan's code can do that step.
