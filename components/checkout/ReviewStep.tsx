"use client";

import { useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { PriceTag } from "@/components/ui/PriceTag";
import { Button } from "@/components/ui/Button";
import type { CartDetailLine } from "@/lib/cart/actions";
import type { CartLine } from "@/lib/cart/context";
import { createOrder, startRazorpayPayment } from "@/lib/orders/create";
import { verifyPayment } from "@/lib/payments/verify";

declare global {
  interface Window {
    // Optional, not just "not yet assigned a value" -- checkout.js is a
    // third-party script loaded over the network, and code here must be
    // able to ask "has it actually loaded yet?" and get a real answer
    // rather than a type-checker's false assurance that it always has.
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/**
 * createOrder/startRazorpayPayment/verifyPayment all return a fixed
 * English message, not a stable error code -- Task 3's stock/cap
 * rejections and this task's own pre-check "unavailable" rejection use
 * different wording for what is, from the shopper's point of view, the
 * same real-world event: an item in their bag is no longer buyable right
 * now. Widened from a single "sold out" substring to also catch "no
 * longer available" so the pre-check case (the one that matters most --
 * an item selling out between page render and button click) routes to
 * the same clear message instead of falling through to a generic
 * "Something went wrong."
 *
 * A substring match on user-facing copy is not durable -- a future copy
 * edit silently breaks routing again with no type error to catch it.
 * The more durable fix is a discriminated `code` field on createOrder's
 * (and startRazorpayPayment's/verifyPayment's) return type, but that
 * ripples into the already-shipped COD path from Task 3 too, which is
 * wider than this fix round's scope (Task 4's payment-processing error
 * path). Centralizing the check here at least means there's one place to
 * fix, not three, when that follow-up happens.
 */
function isUnavailableError(message: string): boolean {
  return message.includes("sold out") || message.includes("no longer available");
}

/**
 * Razorpay Checkout's `theme.color` wants a literal color string, and this
 * project's rule is no literal hex/palette values in components — only
 * semantic tokens. Reading `--color-brand` off the root element at call
 * time (instead of hardcoding the hex it happens to resolve to today)
 * keeps the widget honoring the same token globals.css defines, so a
 * future rebrand doesn't leave this one spot silently stale.
 */
function getBrandColor(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const value = getComputedStyle(document.documentElement).getPropertyValue("--color-brand").trim();
  return value || undefined;
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
  // createOrder rejects the WHOLE order if any line is unavailable (it
  // doesn't silently drop the bad lines and charge for the rest) — so
  // unlike a plain informational notice, this has to actually gate the
  // buttons below. Letting the shopper click "Pay" here would just end in
  // createOrder's generic "Some items in your bag are no longer available"
  // error after a Razorpay order (and possibly a real charge attempt) was
  // already started, which is a worse experience than blocking up front
  // with a clear next step.
  const unavailable = lines.filter((l) => !l.available);
  const blockedByUnavailable = unavailable.length > 0;
  const subtotal = available.reduce((sum, l) => sum + l.price * l.qty, 0);

  async function payWithRazorpay() {
    setStatus("processing");

    // checkout.js loads asynchronously (next/script strategy="afterInteractive"
    // still isn't a hard guarantee it's finished by the time this runs -- a
    // slow network can still lose the race). Check BEFORE creating anything:
    // failing here costs nothing. Failing after startRazorpayPayment has
    // already inserted a DB order row and a live Razorpay order strands both.
    if (!window.Razorpay) {
      setStatus("error");
      return;
    }

    let started: Awaited<ReturnType<typeof startRazorpayPayment>>;
    try {
      started = await startRazorpayPayment({ lines: rawLines, addressId });
    } catch {
      // Network blip, server error, etc. -- without this catch the
      // rejection was unhandled and `status` stayed "processing" forever:
      // both buttons permanently disabled, no recovery short of a reload.
      setStatus("error");
      return;
    }

    if ("error" in started) {
      setStatus(isUnavailableError(started.error) ? "sold-out" : "error");
      return;
    }

    try {
      const razorpay = new window.Razorpay({
        key: started.keyId,
        amount: started.amountPaise,
        currency: "INR",
        order_id: started.razorpayOrderId,
        name: "Fashion Forward",
        prefill: { contact: customerPhone },
        theme: { color: getBrandColor() },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          // Razorpay's SDK does not await (or even look at) this callback's
          // returned promise -- an uncaught throw here is a silent
          // unhandled rejection, quite possibly AFTER a real payment was
          // just captured. This needs its own try/catch; nothing further
          // up the call stack will ever see a failure from inside here.
          try {
            const result = await verifyPayment({
              orderId: started.orderId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            if ("error" in result) {
              setStatus(isUnavailableError(result.error) ? "sold-out" : "error");
              return;
            }
            setPlacedOrderNo(result.orderNo);
            setStatus("placed");
          } catch {
            setStatus("error");
          }
        },
        modal: {
          ondismiss: () => setStatus("idle"),
        },
      });

      razorpay.open();
    } catch {
      // Covers both `new window.Razorpay(...)` throwing (e.g. malformed
      // options) and `.open()` throwing -- either way the shopper needs a
      // real error state, not a permanently-disabled "Processing…" button.
      setStatus("error");
    }
  }

  async function payWithCod() {
    setStatus("processing");
    try {
      const result = await createOrder({ lines: rawLines, addressId, paymentMode: "cod" });
      if ("error" in result) {
        setStatus(isUnavailableError(result.error) ? "sold-out" : "error");
        return;
      }
      setPlacedOrderNo(result.orderId);
      setStatus("placed");
    } catch {
      setStatus("error");
    }
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
      {/*
        afterInteractive (not lazyOnload): lazyOnload defers loading until
        after window "load", which a shopper clicking "Pay" quickly can
        beat -- window.Razorpay wouldn't exist yet. The explicit
        `if (!window.Razorpay)` guard in payWithRazorpay is the real
        safety net (it can still lose the race on a slow connection even
        with afterInteractive), but starting the load earlier makes that
        guard actually rare instead of routine.
      */}
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />

      {blockedByUnavailable && (
        <div className="rounded-card bg-accent/10 p-4">
          <p className="text-sm font-medium text-ink">
            {unavailable.length === 1
              ? "1 item in your bag is no longer available."
              : `${unavailable.length} items in your bag are no longer available.`}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            They sold out or were taken off the store since you added them. Orders can&apos;t
            include unavailable items, so please remove{" "}
            {unavailable.length === 1 ? "it" : "them"} from your bag before checking out.
          </p>
          <Link
            href="/cart"
            className="mt-2 inline-block text-sm font-medium text-brand underline"
          >
            Edit your bag
          </Link>
        </div>
      )}

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
          disabled={status === "processing" || available.length === 0 || blockedByUnavailable}
          className="w-full"
        >
          {status === "processing" ? "Processing…" : `Pay ₹${subtotal}`}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={payWithCod}
          disabled={status === "processing" || available.length === 0 || blockedByUnavailable}
          className="w-full"
        >
          Cash on Delivery
        </Button>
      </div>
    </div>
  );
}
