"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createSessionClient } from "@/lib/supabase/server";
import { getCartDetails } from "@/lib/cart/actions";
import type { CartLine } from "@/lib/cart/context";
import { generateOrderNo } from "./order-no";

const COD_CAP_PAISE = Number(process.env.COD_CAP_PAISE ?? 300000);

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
// the fact). Here, "pending_payment" is a sub-second, purely-internal value
// that exists only inside this one function call and is never read back by
// any other code path -- by the time this function returns, or any other
// request could observe the row, it is already at cod_pending. isLegalTransition
// is a pre-flight advisory check for genuinely external transitions;
// finalize_order's from/to pair, not that table, is what actually gates this.
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
