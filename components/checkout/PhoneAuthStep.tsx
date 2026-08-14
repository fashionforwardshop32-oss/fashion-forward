"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { ensureCustomerRecord } from "@/lib/auth/customer";

/**
 * Reduces whatever the user typed to the bare 10 digits of an Indian
 * mobile number, or null if it doesn't look like one at all. Handles the
 * shapes this one input realistically receives:
 *   - "9876543210"     -- bare 10-digit number (the intended case; the
 *                          "+91" is already shown as a fixed label next
 *                          to the input)
 *   - "919876543210"   -- "91" country code + the 10-digit number typed
 *                          anyway, out of habit from other forms (12
 *                          digits total)
 *   - "+919876543210"  -- same as above with a literal "+", which
 *                          `\D` stripping removes before we ever see it
 *
 * A genuine 10-digit number that happens to start with "91" (Indian
 * mobile numbers start with 6/7/8/9 and can be followed by any digit,
 * so "91XXXXXXXX" is a real, valid prefix) is indistinguishable from a
 * country-code-prefixed number -- but only at exactly 10 digits, which
 * is why the length check below, not a `startsWith`, is what decides
 * whether the leading "91" gets stripped. At 12 digits there's no
 * ambiguity: a real Indian mobile number is never 12 digits on its own,
 * so "91" + 10 more digits can only mean the country code was included.
 */
function normalizeIndianMobileDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

function toE164(input: string): string | null {
  const digits = normalizeIndianMobileDigits(input);
  return digits ? `+91${digits}` : null;
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
    const phone = toE164(phoneInput);
    if (!phone) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone,
        options: { channel: "whatsapp" },
      });
      if (otpError) {
        setError(otpError.message);
        return;
      }
      setStep("otp");
    } catch {
      setError("Couldn't send the code. Check your connection and try again.");
    } finally {
      // In `finally` rather than on each exit path: whatever happens, the
      // button must come back off "Sending…" — a stuck spinner with no error
      // message is the one outcome the user can't act on.
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setError(null);
    if (otp.trim().length < 4) {
      setError("Enter the code sent to your WhatsApp.");
      return;
    }
    const phone = toE164(phoneInput);
    if (!phone) {
      // Shouldn't happen -- sendOtp already validated phoneInput before
      // advancing to this step, and the phone field isn't editable here.
      // Guard anyway rather than assert, since the type is nullable.
      setError("Something went wrong with your number. Start over.");
      setStep("phone");
      return;
    }
    setLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: otp.trim(),
        type: "sms",
      });
      if (verifyError) {
        setError(verifyError.message);
        return;
      }
      // Unlike signInWithOtp/verifyOtp, which resolve with an `error` field,
      // ensureCustomerRecord is a Server Action — a network POST that *rejects*
      // on failure (network blip, or a missing service-role Worker secret).
      // Without this catch, that rejection skipped setLoading(false) and left
      // the button stuck on "Verifying…" forever, with the OTP already consumed
      // by the successful verifyOtp above — so not even a reload could retry it.
      const customer = await ensureCustomerRecord();
      if (!customer) {
        setError("Couldn't set up your account. Try again.");
        return;
      }
      onVerified();
    } catch {
      setError("Couldn't finish verifying. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-card border border-ink/10 bg-surface p-4">
      <h2 className="mb-1 font-display text-lg font-bold text-ink">Verify your number</h2>
      <p className="mb-4 text-sm text-ink-muted">
        We&apos;ll send a code on WhatsApp — no account, no password.
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
                // 13 chars covers the worst realistic case: "+91" plus the
                // 10-digit number (someone typing the country code out of
                // habit even though it's already shown as a label to the
                // left). The old maxLength={10} silently truncated that
                // input to 10 characters, which is what caused this bug --
                // see normalizeIndianMobileDigits above.
                maxLength={13}
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
            onClick={() => {
              // Abandoning this attempt: drop the half-typed code and any error
              // from it, so re-entering the flow doesn't show stale state from
              // a number the user has already moved on from.
              setOtp("");
              setError(null);
              setStep("phone");
            }}
            className="w-full text-center text-sm text-ink-muted underline"
          >
            Use a different number
          </button>
        </div>
      )}
    </div>
  );
}
