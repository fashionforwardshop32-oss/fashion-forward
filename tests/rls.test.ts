import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `npx supabase status` before running tests."
  );
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function createTestCustomer(emailPrefix: string) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  const password = "test-pass-123!";

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user returned");

  const { error: insertError } = await admin
    .from("customers")
    .insert({ id: data.user.id, phone: `9${Math.floor(Math.random() * 1_000_000_000)}` });
  if (insertError) throw insertError;

  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { userId: data.user.id, client };
}

describe("orders row level security", () => {
  it("blocks a customer from reading another customer's order", async () => {
    const owner = await createTestCustomer("owner");
    const stranger = await createTestCustomer("stranger");

    const { data: order, error: insertError } = await admin
      .from("orders")
      .insert({
        order_no: `TEST-${Date.now()}`,
        customer_id: owner.userId,
        payment_mode: "cod",
        subtotal: 500,
        total: 500,
        address_snapshot: { line1: "test", city: "Bangalore", pincode: "560032" },
      })
      .select()
      .single();
    if (insertError || !order) throw insertError ?? new Error("no order returned");

    const { data: asOwner, error: ownerError } = await owner.client
      .from("orders")
      .select()
      .eq("id", order.id);
    expect(ownerError).toBeNull();
    expect(asOwner).toHaveLength(1);

    const { data: asStranger, error: strangerError } = await stranger.client
      .from("orders")
      .select()
      .eq("id", order.id);
    expect(strangerError).toBeNull();
    expect(asStranger).toHaveLength(0);
  });
});
