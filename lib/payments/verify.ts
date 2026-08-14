"use server";

/**
 * Placeholder for Task 5. `ReviewStep.tsx`'s Razorpay `handler` callback
 * (Task 4) already calls this function with the real payment fields the
 * Razorpay Checkout widget hands back — this stub exists only so that
 * import resolves and the plumbing is provably reachable end to end.
 * Task 5 replaces this body with the real signature-verify +
 * finalize_order("confirmed") + refund-on-sold-out logic (see
 * docs/superpowers/plans/2026-08-14-week4-payments-orders.md, Task 5).
 */
export async function verifyPayment(input: {
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}): Promise<{ orderNo: string } | { error: string }> {
  void input;
  return { error: "Payment verification isn't implemented yet." };
}
