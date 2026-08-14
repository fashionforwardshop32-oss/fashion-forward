import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const hasEnv = Boolean(SERVICE_ROLE_KEY);

describe.skipIf(!hasEnv)("finalize_order concurrent stock race", () => {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let orderAId: string;
  let orderBId: string;

  beforeAll(async () => {
    const { data: category } = await admin
      .from("categories")
      .insert({ slug: `race-test-${Date.now()}`, name: "Race Test" })
      .select()
      .single();
    categoryId = category!.id;

    const { data: product } = await admin
      .from("products")
      .insert({
        slug: `race-test-${Date.now()}`,
        title: "Race Test Product",
        category_id: categoryId,
        gender: "unisex",
        age_group: "2-4Y",
        base_price: 500,
        status: "active",
      })
      .select()
      .single();
    productId = product!.id;

    // Exactly ONE unit in stock — the whole point of this test.
    const { data: variant } = await admin
      .from("variants")
      .insert({ product_id: productId, size: "2-4Y", sku: `RACE-${Date.now()}`, stock_qty: 1 })
      .select()
      .single();
    variantId = variant!.id;

    // Two customers, two pending orders, each wanting the same 1 unit.
    async function createTestCustomerAndOrder(emailPrefix: string) {
      const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
      const { data: authUser } = await admin.auth.admin.createUser({
        email,
        password: "test-pass-123!",
        email_confirm: true,
      });
      await admin
        .from("customers")
        .insert({ id: authUser!.user!.id, phone: `9${Math.floor(Math.random() * 1_000_000_000)}` });

      const { data: order } = await admin
        .from("orders")
        .insert({
          order_no: `RACE-${emailPrefix}-${Date.now()}`,
          customer_id: authUser!.user!.id,
          status: "pending_payment",
          payment_mode: "razorpay",
          subtotal: 500,
          total: 500,
          address_snapshot: { line1: "test", city: "Bangalore", pincode: "560032" },
        })
        .select()
        .single();

      await admin
        .from("order_items")
        .insert({ order_id: order!.id, variant_id: variantId, qty: 1, unit_price: 500, title_snapshot: "Race Test Product" });

      return order!.id;
    }

    orderAId = await createTestCustomerAndOrder("racer-a");
    orderBId = await createTestCustomerAndOrder("racer-b");
  });

  it("lets exactly one of two concurrent finalize_order calls succeed for the last unit", async () => {
    const [resultA, resultB] = await Promise.allSettled([
      admin.rpc("finalize_order", {
        p_order_id: orderAId,
        p_from_status: "pending_payment",
        p_to_status: "confirmed",
      }),
      admin.rpc("finalize_order", {
        p_order_id: orderBId,
        p_from_status: "pending_payment",
        p_to_status: "confirmed",
      }),
    ]);

    const outcomes = [resultA, resultB].map((r) => {
      if (r.status === "rejected") return "rejected";
      if (r.value.error) return `error:${r.value.error.message}`;
      return r.value.data === true ? "confirmed" : "no-op";
    });

    const confirmedCount = outcomes.filter((o) => o === "confirmed").length;
    const failedCount = outcomes.filter((o) => o.startsWith("error:insufficient_stock")).length;

    expect(confirmedCount).toBe(1);
    expect(failedCount).toBe(1);

    const { data: variant } = await admin
      .from("variants")
      .select("stock_qty")
      .eq("id", variantId)
      .single();
    expect(variant!.stock_qty).toBe(0);

    const { data: orders } = await admin
      .from("orders")
      .select("id, status")
      .in("id", [orderAId, orderBId]);
    const statuses = (orders ?? []).map((o) => o.status).sort();
    expect(statuses).toEqual(["confirmed", "pending_payment"]);
  });
});
