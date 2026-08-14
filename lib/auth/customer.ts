"use server";

import { createServerClient, createSessionClient } from "@/lib/supabase/server";

/**
 * Creates the customers row for the current auth session, if one doesn't
 * already exist. Uses the service-role client because Week 1's RLS
 * deliberately gives `authenticated` no INSERT policy on `customers`
 * (see supabase/migrations/20260803000002_rls.sql) — customer-row
 * creation is meant to go through server-side code, not a direct client
 * insert, and this is that code.
 *
 * Called from two places, which is why this is a single atomic upsert
 * rather than the check-then-insert it used to be:
 *   1. PhoneAuthStep, right after a fresh verifyOtp succeeds.
 *   2. checkout/page.tsx's returning-session branch, which must confirm
 *      a row exists before entering the address stage — `addresses`
 *      has a NOT NULL FK to `customers.id`, and a session that somehow
 *      never got its row (a past transient failure here) could never
 *      self-heal from the client, since `authenticated` has no INSERT
 *      policy on `customers` by design.
 * Two call sites can fire close together (two tabs, or a reload mid-flow),
 * so check-then-insert would race into a duplicate-key error; `upsert`
 * with `onConflict: "id"` collapses that into one statement.
 *
 * `phone` is safe to write on the conflict path: both call sites read it
 * from the same source — the verified auth session's own `user.phone` —
 * so the "update" half of the upsert can only ever rewrite the column
 * with the value it already holds for that id. It cannot be used to
 * point an existing customers row at a different number, because `id`
 * and `phone` both come from the same `auth.users` row.
 */
export async function ensureCustomerRecord(): Promise<{ id: string; phone: string } | null> {
  const session = await createSessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user?.phone) return null;

  const service = createServerClient();

  const { data: customer, error } = await service
    .from("customers")
    .upsert({ id: user.id, phone: user.phone }, { onConflict: "id" })
    .select("id, phone")
    .single();

  if (error || !customer) {
    return null;
  }

  return customer;
}
