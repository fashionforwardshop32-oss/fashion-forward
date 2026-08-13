"use server";

import { createServerClient, createSessionClient } from "@/lib/supabase/server";

/**
 * Creates the customers row for the just-verified auth session, if one
 * doesn't already exist. Uses the service-role client because Week 1's
 * RLS deliberately gives `authenticated` no INSERT policy on `customers`
 * (see supabase/migrations/20260803000002_rls.sql) — customer-row
 * creation is meant to go through server-side code, not a direct client
 * insert, and this is that code.
 */
export async function ensureCustomerRecord(): Promise<{ id: string; phone: string } | null> {
  const session = await createSessionClient();
  const {
    data: { user },
  } = await session.auth.getUser();

  if (!user?.phone) return null;

  const service = createServerClient();

  const { data: existing } = await service
    .from("customers")
    .select("id, phone")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await service
    .from("customers")
    .insert({ id: user.id, phone: user.phone })
    .select("id, phone")
    .single();

  if (error || !created) {
    return null;
  }

  return created;
}
