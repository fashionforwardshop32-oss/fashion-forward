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
