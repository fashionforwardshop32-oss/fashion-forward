import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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

  if (!user?.email || !adminEmails().includes(user.email.toLowerCase())) {
    redirect("/admin/login");
  }

  return user;
}
