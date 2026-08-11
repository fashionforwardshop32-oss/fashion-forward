import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Service-role Supabase client. Bypasses row level security -- server code only. */
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set the latter with `npx wrangler secret put` for the deployed Worker."
    );
  }
  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Session-aware client: knows who's logged in via cookies. Used to check
 * "is this request from a logged-in admin" -- never for data access, since
 * it's still bound by RLS (anon/authenticated policies only). For data
 * access use `createServerClient()` above (the service-role client), which
 * has no relation to this function despite the similar-sounding name --
 * that name comes from Week 1 and is kept for import compatibility.
 */
export async function createSessionClient() {
  const cookieStore = await cookies();

  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component with no response to write to --
            // safe to ignore because middleware.ts refreshes the session.
          }
        },
      },
    },
  );
}
