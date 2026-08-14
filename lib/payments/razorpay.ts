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
