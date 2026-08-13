"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { isBangalorePincode } from "@/lib/validation/pincode";

type Address = {
  id: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  is_default: boolean;
};

export function AddressStep({
  customerId,
  onAddressChosen,
}: {
  customerId: string;
  onAddressChosen: (addressId: string) => void;
}) {
  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [landmark, setLandmark] = useState("");
  const [pincode, setPincode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outOfZone, setOutOfZone] = useState(false);
  const [saving, setSaving] = useState(false);

  const supabase = createClient();
  const whatsappNumber = process.env.NEXT_PUBLIC_WHATSAPP_CONTACT_NUMBER ?? "";

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);

    async function loadAddresses() {
      try {
        const { data, error: fetchError } = await supabase
          .from("addresses")
          .select("id, line1, line2, landmark, pincode, is_default")
          .eq("customer_id", customerId)
          .order("is_default", { ascending: false });
        if (cancelled) return;
        if (fetchError) {
          setLoadError(true);
          return;
        }
        setAddresses(data ?? []);
        if (data && data.length > 0) {
          setSelectedId(data[0]!.id);
        } else {
          setShowForm(true);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    }

    loadAddresses();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  async function saveAddress() {
    setError(null);
    setOutOfZone(false);

    if (line1.trim().length < 5) {
      setError("Enter your full address.");
      return;
    }
    if (!/^\d{6}$/.test(pincode.trim())) {
      setError("Enter a valid 6-digit pincode.");
      return;
    }
    if (!isBangalorePincode(pincode)) {
      setOutOfZone(true);
      return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("addresses")
      .insert({
        customer_id: customerId,
        line1: line1.trim(),
        line2: line2.trim() || null,
        landmark: landmark.trim() || null,
        city: "Bangalore",
        pincode: pincode.trim(),
        is_default: (addresses ?? []).length === 0,
      })
      .select("id")
      .single();
    setSaving(false);

    if (insertError || !data) {
      setError("Couldn't save that address. Try again.");
      return;
    }

    onAddressChosen(data.id);
  }

  if (loadError) {
    return (
      <div className="rounded-card border border-ink/10 bg-surface p-4 text-center">
        <p className="text-sm text-ink-muted">Couldn&apos;t load your addresses. Please try reloading.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-block text-sm font-medium text-brand underline"
        >
          Reload
        </button>
      </div>
    );
  }

  if (addresses === null) {
    return <p className="text-sm text-ink-muted">Loading addresses…</p>;
  }

  return (
    <div className="rounded-card border border-ink/10 bg-surface p-4">
      <h2 className="mb-3 font-display text-lg font-bold text-ink">Delivery address</h2>

      {addresses.length > 0 && !showForm && (
        <div className="space-y-2">
          {addresses.map((a) => (
            <label
              key={a.id}
              className={`block cursor-pointer rounded-card border p-3 text-sm ${
                selectedId === a.id ? "border-brand bg-tint" : "border-ink/15"
              }`}
            >
              <input
                type="radio"
                name="address"
                className="mr-2"
                checked={selectedId === a.id}
                onChange={() => setSelectedId(a.id)}
              />
              {a.line1}
              {a.line2 ? `, ${a.line2}` : ""} — {a.pincode}
            </label>
          ))}
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              className="flex-1"
              disabled={!selectedId}
              onClick={() => selectedId && onAddressChosen(selectedId)}
            >
              Deliver here
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowForm(true)}>
              + New address
            </Button>
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-3">
          {outOfZone ? (
            <div className="rounded-card bg-accent/10 p-3 text-sm text-ink">
              <p className="font-medium">We don&apos;t deliver to this pincode yet.</p>
              <p className="mt-1 text-ink-muted">
                Fashion Forward currently ships within Bangalore only.
              </p>
              {whatsappNumber && (
                <a
                  href={`https://wa.me/${whatsappNumber.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block font-medium text-brand underline"
                >
                  Message us on WhatsApp
                </a>
              )}
              <button
                type="button"
                onClick={() => setOutOfZone(false)}
                className="mt-2 block text-xs text-ink-muted underline"
              >
                Try a different pincode
              </button>
            </div>
          ) : (
            <>
              {error && (
                <p className="rounded-card bg-accent/10 p-2 text-sm text-ink">{error}</p>
              )}
              <div>
                <label htmlFor="line1" className="mb-1 block text-sm font-medium text-ink">
                  Address
                </label>
                <input
                  id="line1"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  placeholder="House no, street, area"
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div>
                <label htmlFor="line2" className="mb-1 block text-sm font-medium text-ink">
                  Apartment / floor (optional)
                </label>
                <input
                  id="line2"
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div>
                <label htmlFor="landmark" className="mb-1 block text-sm font-medium text-ink">
                  Landmark (optional)
                </label>
                <input
                  id="landmark"
                  value={landmark}
                  onChange={(e) => setLandmark(e.target.value)}
                  className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label htmlFor="city" className="mb-1 block text-sm font-medium text-ink">
                    City
                  </label>
                  <input
                    id="city"
                    value="Bangalore"
                    disabled
                    className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink-muted"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="pincode" className="mb-1 block text-sm font-medium text-ink">
                    Pincode
                  </label>
                  <input
                    id="pincode"
                    inputMode="numeric"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    placeholder="560032"
                    className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
                  />
                </div>
              </div>
              <Button type="button" onClick={saveAddress} disabled={saving} className="w-full">
                {saving ? "Saving…" : "Save address"}
              </Button>
              {addresses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="w-full text-center text-sm text-ink-muted underline"
                >
                  Use an existing address instead
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
