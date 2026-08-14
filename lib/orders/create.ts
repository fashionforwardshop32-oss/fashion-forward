"use server";

import { createServerClient } from "@/lib/supabase/server";
import { createSessionClient } from "@/lib/supabase/server";
import { getCartDetails } from "@/lib/cart/actions";
import type { CartLine } from "@/lib/cart/context";
import { generateOrderNo } from "./order-no";

const COD_CAP_PAISE = Number(process.env.COD_CAP_PAISE ?? 300000);

// See supabase/migrations/20260814000002_finalize_order.sql's "SCOPE — READ
// BEFORE ADDING A CALLER" header: finalize_order is documented as valid only
// for pending_payment -> confirmed (Razorpay) and cod_pending -> confirmed
// (COD order placement). It is NOT valid for pending_payment -> cod_pending
// -- lib/orders/transitions.ts's LEGAL_TRANSITIONS table agrees, explicitly
// listing pending_payment and cod_pending as mutually exclusive (neither can
// transition into the other). So a COD order is inserted directly with
// status "cod_pending" (a fresh row, not a transition -- isLegalTransition
// governs transitions between existing rows, not the initial value of a new
// one), then finalize_order moves it cod_pending -> confirmed, which is both
// the migration's documented COD case and the decrement/commit point.
export type CreateOrderResult =
  | { orderId: string; status: "pending_payment" | "confirmed" }
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

  // Razorpay orders start (and, in this task, stay) pending_payment -- Task
  // 4/5/6 transition them to confirmed on actual payment. COD orders start
  // cod_pending and are moved to confirmed a few lines down in the same
  // request, via finalize_order, which is what actually decrements stock.
  const initialStatus = input.paymentMode === "cod" ? "cod_pending" : "pending_payment";

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

  // COD: cod_pending -> confirmed is finalize_order's documented COD case
  // (see the SCOPE comment in the migration) and is the commit point that
  // decrements stock.
  const { data: finalized, error: finalizeError } = await supabase.rpc("finalize_order", {
    p_order_id: order.id,
    p_from_status: "cod_pending",
    p_to_status: "confirmed",
  });

  if (finalizeError?.message === "insufficient_stock") {
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Sorry, an item in your bag just sold out." };
  }
  if (finalizeError || !finalized) {
    await supabase.from("orders").delete().eq("id", order.id);
    return { error: "Couldn't confirm your order. Try again." };
  }

  return { orderId: order.id, status: "confirmed" };
}
