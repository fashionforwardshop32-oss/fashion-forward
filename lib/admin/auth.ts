import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Same allowlist test middleware applies (lib/supabase/middleware.ts).
 * Exported so the login action can reject a non-allowlisted sign-in up
 * front instead of handing out a session that middleware then bounces.
 */
export function isAllowedAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.toLowerCase());
}

/**
 * Call at the top of every admin Server Action and Server Component.
 * Redirects to /admin/login if the caller isn't a logged-in, allowlisted
 * admin. Belt-and-braces alongside middleware.ts — middleware can be
 * bypassed by direct Server Action calls in some edge cases, so this is
 * the second, authoritative check.
 */
export async function requireAdmin() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAllowedAdminEmail(user.email)) {
    redirect("/admin/login");
  }

  return user;
}
