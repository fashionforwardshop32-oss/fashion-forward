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

function ReloadNotice({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-2xl p-8 text-center">
      <p className="text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="mt-3 inline-block font-medium text-brand"
      >
        Reload
      </button>
    </main>
  );
}

export default function CheckoutPage() {
  const { lines } = useCart();
  const [cartDetails, setCartDetails] = useState<CartDetailLine[] | null>(null);
  const [cartLoadError, setCartLoadError] = useState(false);
  const [stage, setStage] = useState<Stage>("loading");
  const [sessionError, setSessionError] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [addressSummary, setAddressSummary] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const supabase = createClient();

  // Cart pricing fetch -- same bug class Task 1's getCartDetails().then(setCartDetails)
  // hit with no error handling (a failed call left /cart stuck on "Loading…" forever).
  // Same fix here: cancelled-guard + .catch() -> cartLoadError state -> full-page error UI.
  useEffect(() => {
    let cancelled = false;
    setCartLoadError(false);
    getCartDetails(lines)
      .then((result) => {
        if (!cancelled) setCartDetails(result);
      })
      .catch(() => {
        if (!cancelled) setCartLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lines]);

  // Initial session check. A failure here would otherwise leave `stage` stuck at
  // "loading" forever -- same bug shape, fixed the same way (error state + reload UI).
  // Uses async/try-catch rather than a bare .then() chain because the Supabase query
  // builder's .then() isn't a full Promise (Task 3 hit this as a real build failure).
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        // supabase-js resolves getUser() with an AuthSessionMissingError in its
        // `error` field for the ordinary "no one is logged in yet" case -- that
        // is not a fetch failure, it's the ordinary anonymous-visitor case,
        // so it must fall through to the auth stage rather than the error UI.
        // Only a genuine thrown exception (network down, etc.) counts as a
        // failure worth showing a reload prompt for.
        const { data } = await supabase.auth.getUser();
        if (cancelled) return;
        if (data.user) {
          setCustomerId(data.user.id);
          setStage("address");
        } else {
          setStage("auth");
        }
      } catch {
        if (!cancelled) setSessionError(true);
      }
    }

    loadSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (cartLoadError) {
    return <ReloadNotice message="Couldn't load your bag. Please try reloading." />;
  }

  if (sessionError) {
    return <ReloadNotice message="Couldn't check your session. Please try reloading." />;
  }

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

      {stageError && (
        <div className="mb-4 rounded-card border border-ink/10 bg-surface p-4 text-center">
          <p className="text-sm text-ink-muted">{stageError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 inline-block text-sm font-medium text-brand underline"
          >
            Reload
          </button>
        </div>
      )}

      {stage === "auth" && (
        <PhoneAuthStep
          onVerified={async () => {
            setStageError(null);
            try {
              const { data, error } = await supabase.auth.getUser();
              if (error || !data.user) {
                setStageError("Couldn't confirm your verified session. Please try reloading.");
                return;
              }
              setCustomerId(data.user.id);
              setStage("address");
            } catch {
              setStageError("Couldn't confirm your verified session. Please try reloading.");
            }
          }}
        />
      )}

      {stage === "address" && customerId && (
        <AddressStep
          customerId={customerId}
          onAddressChosen={async (addressId) => {
            setStageError(null);
            try {
              const { data, error } = await supabase
                .from("addresses")
                .select("line1, line2, pincode")
                .eq("id", addressId)
                .single();
              if (error || !data) {
                setStageError("Couldn't load that address. Please try reloading.");
                return;
              }
              setAddressSummary(
                `${data.line1}${data.line2 ? `, ${data.line2}` : ""} — ${data.pincode}`,
              );
              setStage("review");
            } catch {
              setStageError("Couldn't load that address. Please try reloading.");
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
