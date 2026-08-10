import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

/** Seeds an active product + one variant, so order_items can reference something real. */
async function seedVariant() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      slug: `test-product-${suffix}`,
      title: "Test Product",
      gender: "unisex",
      age_group: "2-4Y",
      base_price: 500,
      status: "active",
    })
    .select()
    .single();
  if (productError || !product) throw productError ?? new Error("no product returned");

  const { data: variant, error: variantError } = await admin
    .from("variants")
    .insert({ product_id: product.id, size: "M", sku: `TEST-SKU-${suffix}`, stock_qty: 5 })
    .select()
    .single();
  if (variantError || !variant) throw variantError ?? new Error("no variant returned");

  return variant;
}

async function seedOrder(customerId: string) {
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      order_no: `TEST-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      customer_id: customerId,
      payment_mode: "cod",
      subtotal: 500,
      total: 500,
      address_snapshot: { line1: "test", city: "Bangalore", pincode: "560032" },
    })
    .select()
    .single();
  if (error || !order) throw error ?? new Error("no order returned");
  return order;
}

/**
 * A table is service-role-only when a signed-in client either gets a hard
 * permission error or sees zero rows -- never the seeded row.
 */
async function expectNoClientAccess(
  client: SupabaseClient,
  table: string,
  seededId: string
) {
  const { data, error } = await client.from(table).select();
  expect(error !== null || (data ?? []).length === 0).toBe(true);
  expect(data ?? []).toHaveLength(0);

  const { data: targeted, error: targetedError } = await client
    .from(table)
    .select()
    .eq("id", seededId);
  expect(targetedError !== null || (targeted ?? []).length === 0).toBe(true);
  expect(targeted ?? []).toHaveLength(0);
}

describe("orders row level security", () => {
  it("blocks a customer from reading another customer's order, items and addresses", async () => {
    const owner = await createTestCustomer("owner");
    const stranger = await createTestCustomer("stranger");

    const order = await seedOrder(owner.userId);
    const variant = await seedVariant();

    const { data: orderItem, error: itemError } = await admin
      .from("order_items")
      .insert({
        order_id: order.id,
        variant_id: variant.id,
        qty: 1,
        unit_price: 500,
        title_snapshot: "Test Product",
      })
      .select()
      .single();
    if (itemError || !orderItem) throw itemError ?? new Error("no order item returned");

    const { data: address, error: addressError } = await admin
      .from("addresses")
      .insert({
        customer_id: owner.userId,
        line1: "12 Test Street",
        city: "Bangalore",
        pincode: "560032",
      })
      .select()
      .single();
    if (addressError || !address) throw addressError ?? new Error("no address returned");

    const { data: asOwner, error: ownerError } = await owner.client
      .from("orders")
      .select()
      .eq("id", order.id);
    expect(ownerError).toBeNull();
    expect(asOwner).toHaveLength(1);

    const { data: itemsAsOwner, error: ownerItemsError } = await owner.client
      .from("order_items")
      .select()
      .eq("id", orderItem.id);
    expect(ownerItemsError).toBeNull();
    expect(itemsAsOwner).toHaveLength(1);

    const { data: addressAsOwner, error: ownerAddressError } = await owner.client
      .from("addresses")
      .select()
      .eq("id", address.id);
    expect(ownerAddressError).toBeNull();
    expect(addressAsOwner).toHaveLength(1);

    const { data: asStranger, error: strangerError } = await stranger.client
      .from("orders")
      .select()
      .eq("id", order.id);
    expect(strangerError).toBeNull();
    expect(asStranger).toHaveLength(0);

    const { data: itemsAsStranger, error: strangerItemsError } = await stranger.client
      .from("order_items")
      .select()
      .eq("id", orderItem.id);
    expect(strangerItemsError).toBeNull();
    expect(itemsAsStranger).toHaveLength(0);

    const { data: addressAsStranger, error: strangerAddressError } = await stranger.client
      .from("addresses")
      .select()
      .eq("id", address.id);
    expect(strangerAddressError).toBeNull();
    expect(addressAsStranger).toHaveLength(0);
  });
});

describe("service-role-only tables", () => {
  it("blocks an authenticated client from reading payments", async () => {
    const customer = await createTestCustomer("payments-reader");
    const order = await seedOrder(customer.userId);

    const { data: payment, error } = await admin
      .from("payments")
      .insert({
        order_id: order.id,
        razorpay_order_id: `order_${Date.now()}`,
        razorpay_payment_id: `pay_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        amount: 500,
        status: "captured",
      })
      .select()
      .single();
    if (error || !payment) throw error ?? new Error("no payment returned");

    // The payment belongs to this customer's own order -- still unreadable,
    // because payments has zero client policies and zero client grants.
    await expectNoClientAccess(customer.client, "payments", payment.id);
  });

  it("blocks an authenticated client from reading coupons", async () => {
    const customer = await createTestCustomer("coupons-reader");

    const { data: coupon, error } = await admin
      .from("coupons")
      .insert({
        code: `TEST${Date.now()}${Math.floor(Math.random() * 1000)}`,
        type: "percent",
        value: 10,
        min_cart: 999,
      })
      .select()
      .single();
    if (error || !coupon) throw error ?? new Error("no coupon returned");

    await expectNoClientAccess(customer.client, "coupons", coupon.id);
  });
});

describe("customers column-level update grant", () => {
  it("allows updating name but rejects updating phone", async () => {
    const customer = await createTestCustomer("column-grant");

    const { error: nameError } = await customer.client
      .from("customers")
      .update({ name: "Updated Name" })
      .eq("id", customer.userId);
    expect(nameError).toBeNull();

    const { data: afterName } = await admin
      .from("customers")
      .select("name, phone")
      .eq("id", customer.userId)
      .single();
    expect(afterName?.name).toBe("Updated Name");

    const originalPhone = afterName?.phone;

    const { error: phoneError } = await customer.client
      .from("customers")
      .update({ phone: "9000000001" })
      .eq("id", customer.userId);
    expect(phoneError).not.toBeNull();

    const { data: afterPhone } = await admin
      .from("customers")
      .select("phone")
      .eq("id", customer.userId)
      .single();
    expect(afterPhone?.phone).toBe(originalPhone);
  });
});
