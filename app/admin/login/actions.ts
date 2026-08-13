"use server";

import { redirect } from "next/navigation";
import { isAllowedAdminEmail } from "@/lib/admin/auth";
import { createSessionClient } from "@/lib/supabase/server";

export async function signInAdmin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/admin/login?error=missing");
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/admin/login?error=invalid");
  }

  // The password was correct, but middleware only lets ADMIN_EMAILS past
  // /admin/*. Without this check the session cookie is set, /admin/products
  // redirects straight back to /admin/login, and the user sees no reason why
  // -- an unexplained loop. Drop the session and say what happened instead.
  if (!isAllowedAdminEmail(data.user?.email)) {
    await supabase.auth.signOut();
    redirect("/admin/login?error=notallowed");
  }

  redirect("/admin/products");
}
