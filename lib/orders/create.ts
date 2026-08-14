"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createSessionClient } from "@/lib/supabase/server";
import { getCartDetails } from "@/lib/cart/actions";
import type { CartLine } from "@/lib/cart/context";
import { generateOrderNo } from "./order-no";

// A non-numeric or non-positive COD_CAP_PAISE (a typo'd deploy config, an
// accidentally-blank value, etc.) must not silently disable the cap. `??`
// alone only catches `undefined`/`null` -- a garbage string like "abc"
// still passes `??` and turns into `Number("abc") === NaN`, and
// `total > NaN` is always false, so every order would pass the cap check
// with no error and no signal anything was wrong. Validate the parsed
// value is actually usable and fall back to the documented default
// otherwise.
const parsedCap = Number(process.env.COD_CAP_PAISE);
const COD_CAP_PAISE = Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : 300000;

// COD orders are inserted at "pending_payment" (same initial value as the
// Razorpay path -- no special-casing needed at insert time) and immediately
// moved to "cod_pending" via finalize_order in the same request. This is
// the order's real, externally-observable commit point for COD: stock
// decrements here, and this is the row shape the storefront, the owner's
// order list, and Week 5's admin "Confirm" action all expect to see. The
// order only reaches "confirmed" later, via a separate owner action -- see
// spec §7's COD flow and this migration's own SCOPE comment (updated in
// 20260814000003_finalize_order_scope_comment.sql), which documents
// pending_payment -> cod_pending as a third valid pair, precisely for this
// call, alongside the two payment-confirming pairs used elsewhere.
//
// This does not conflict with lib/orders/transitions.ts's LEGAL_TRANSITIONS
// table treating pending_payment and cod_pending as mutually exclusive --
// that rule is about externally-observable transitions (an admin or the
// storefront never seeing a COD order flip between these two states after
// the fact). The intent here is for "pending_payment" to be a sub-second,
// purely-internal value for a COD order, immediately moved to cod_pending a
// few lines below in the same request. isLegalTransition is a pre-flight
// advisory check for genuinely external transitions; finalize_order's
// from/to pair, not that table, is what actually gates this call.
//
// Correction to an earlier version of this comment: it previously claimed
// this row is "never read back by any other code path." That overstated
// it -- the `orders` insert genuinely commits before finalize_order runs,
// and the row is real and RLS-readable by anything with access for
// whatever window elapses between the two calls. The accurate claim is
// narrower: no consumer reads `orders` mid-checkout today, so nothing
// currently observes a COD order sitting at pending_payment -- but the row
// is real, and if the request dies in that window (before finalize_order
// ever runs), the order is genuinely stranded at pending_payment with
// payment_mode "cod" forever: no Razorpay verify/webhook will ever touch
// it (it isn't a Razorpay order), and it silently disqualifies that
// customer from the first-order COD cap exemption on every future attempt
// (the cap check below counts "any prior order, any status"). Closing this
// for real needs either an idempotency key on order creation or a
// periodic sweep to reconcile/cancel stranded pending_payment COD orders
// -- Week 5-level reconciliation work, out of scope for this function.
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

  // getCartDetails clamps qty to the variant's current stock, which can
  // land on 0 without flipping `available` to false -- that happens when a
  // variant sells out to exactly zero between the cart page and this call.
  // A qty-0 line would violate order_items' `check (qty > 0)` constraint if
  // it reached the insert below, surfacing as a generic "Couldn't save your
  // order items" error with no indication anything sold out. Catch it here,
  // before any row is written, with the same message already shown for
  // genuinely unavailable lines.
  if (available.some((l) => l.qty < 1)) {
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
    // Any prior order, in any status, counts as "not first" -- an old
    // cancelled/pending_payment order still means this customer isn't new.
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

  // Both payment modes start at pending_payment. Razorpay orders stay there
  // (Task 4/5/6 transition them to confirmed on actual payment). COD orders
  // are moved to cod_pending a few lines down in the same request, via
  // finalize_order -- that call is what actually decrements stock.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_no: orderNo,
      customer_id: user.id,
      status: "pending_payment",
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

  // COD: pending_payment -> cod_pending is the commit point that decrements
  // stock. This is the order's real resting state until Week 5's admin
  // "Confirm" action later moves it to confirmed.
  //
  // Known gap, not fully closable from this function alone: if the request
  // dies *before this call ever runs* (between the orders insert above
  // committing and this line executing), the order is stranded at
  // pending_payment with payment_mode "cod" -- see the long comment on
  // CreateOrderResult above for what that means and what actually closes it
  // (idempotency key on creation, or a periodic sweeper; Week 5 work).
  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_order", {
    p_order_id: order.id,
    p_from_status: "pending_payment",
    p_to_status: "cod_pending",
  });

  if (finalizeError?.message === "insufficient_stock") {
    // finalize_order raises before touching anything on insufficient stock
    // (Task 2's race test proves the whole call rolls back) -- nothing
    // committed, so deleting the order here is always safe.
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Sorry, an item in your bag just sold out." };
  }
  if (finalizeError || !finalized) {
    // Any other error (or a false/null result with no error) is ambiguous:
    // finalize_order may have actually committed in Postgres -- decremented
    // stock and set status to cod_pending -- with only the HTTP response
    // back to this request lost (network blip, timeout, request
    // cancellation). Blindly deleting the order here would leave that
    // decrement standing with no order left to account for it (silent
    // inventory loss), and any client-side retry would decrement a second
    // time. Re-read the order's actual committed status before deciding.
    const { data: recheck, error: recheckError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", order.id)
      .single();

    if (!recheckError && recheck?.status === "cod_pending") {
      // The RPC did succeed -- the error was in getting the response back,
      // not in the operation itself.
      return { orderId: order.id, status: "cod_pending" };
    }

    // Either the RPC genuinely never committed, or the recheck itself also
    // failed (a doubly-unlikely case this task can't fully close either --
    // same class of gap as the stranded-order comment above, and the same
    // real fix: reconciliation tooling, not another retry here). Deleting
    // is the safer default in both remaining cases: an order stuck showing
    // the customer a dead end forever is worse than a rare false cleanup.
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Couldn't confirm your order. Try again." };
  }

  return { orderId: order.id, status: "cod_pending" };
}
