import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() (not getClaims()) — contacts Supabase Auth to revalidate the
  // session token rather than trusting a locally-decoded JWT. Slightly
  // slower, but this only runs on /admin/* routes (see middleware.ts's
  // matcher), not every request site-wide, so the cost is negligible.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const isLoginPage = request.nextUrl.pathname === "/admin/login";
  const isAllowedAdmin = !!user?.email && adminEmails.includes(user.email.toLowerCase());

  if (!isAllowedAdmin && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    return NextResponse.redirect(url);
  }

  if (isAllowedAdmin && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/products";
    return NextResponse.redirect(url);
  }

  return response;
}
