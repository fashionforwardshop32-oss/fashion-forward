# Fashion Forward — Week 2: Catalog, PDP, Admin Product CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a working "add a product, see it live" loop — admin auth, upload-time image pipeline, product create/edit — and give shoppers a real catalog: category pages with filters and a product detail page, replacing Week 1's placeholder home page with real data.

**Architecture:** Extends the single Next.js 15 App Router app from Week 1. Introduces the `(shop)` and `(admin)` route groups from the spec's file tree (`docs/superpowers/specs/2026-08-03-fashion-forward-ecommerce-design.md` §3). Admin writes go through the Supabase **service role** client (`lib/supabase/server.ts` from Week 1), bypassing RLS by design — no new RLS policies are needed for admin paths. Storefront reads use the **anon** client against the public-read RLS policies Week 1 already created. Product images are resized to three WebP sizes at upload time inside a Next.js Server Action running on Cloudflare Workers — no runtime image optimizer, per spec §3.

**Tech Stack:** Next.js 15.5.22, TypeScript 5.9.3 (all pinned in Week 1) plus two new dependencies this week: `@supabase/ssr` 0.12.4 (cookie-based sessions for admin login) and `@cf-wasm/photon` 0.4.0 (WASM image resize + WebP encode, runs on both Node and Cloudflare Workers via its package's own conditional exports).

## Global Constraints

- Project root: `C:\Users\tejas\fashion-forward` (existing git repo, remote `origin` → `github.com/fashionforwardshop32-oss/fashion-forward`, branch `main`).
- No component may contain a literal hex value or a raw Tailwind palette class — only the semantic tokens from Week 1 (`bg-brand`, `bg-accent`, `bg-highlight`, `bg-surface`, `bg-tint`, `text-ink`, `text-ink-muted`, `rounded-card`, `font-display`, `font-body`) plus the `on-brand`/`on-accent` tokens added in Week 1's final review. If a new token is genuinely needed, add it to `app/globals.css`'s `@theme` block — never inline a hex value in a component.
- Admin-side database writes use the Supabase **service role** key server-side (`lib/supabase/server.ts`); this bypasses RLS by construction. No task in this plan adds or modifies RLS policies.
- Storefront reads use the **anon** key (`lib/supabase/client.ts` pattern from Week 1, extended this week — see Task 1) against the existing public-read policies (`public read categories`, `public read active products`, `public read variants of active products`, `public read images of active products`) from Week 1's `20260803000002_rls.sql`.
- Env var names are already fixed by Week 1's `.env.local.example` — use `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` exactly. Do not introduce Supabase's newer `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` naming even though some current Supabase docs/examples use it — staying consistent with what Week 1 already shipped matters more than matching the latest doc naming.
- Every task ends in a `git commit`. Commit messages are plain, imperative, no marketing language.
- PowerShell is the user's primary shell outside this session; all commands below are written for the Bash tool already in use in this session (Git Bash).
- Stock lives on `variants.stock_qty`, never on `products` (Week 1 schema, unchanged this week).
- Out-of-stock sizes are shown **greyed, never hidden** — spec §5 purchase flow, binding on Task 6 (PDP).
- The admin owner is low-tech, phone-first (spec §6) — every admin form in this plan favours the fewest, simplest inputs over configurability. SKUs and slugs are machine-generated, never typed by the owner.

---

## File Structure

```
fashion-forward/
  middleware.ts                          (new — gates /admin/*)
  app/
    (shop)/
      page.tsx                           (moved from app/page.tsx — home, real content)
      c/
        [category]/
          page.tsx                       (category listing + client-side filters)
      p/
        [slug]/
          page.tsx                       (PDP)
    admin/                                (real path segment, NOT a (admin) route group — a
                                            route group contributes no URL segment, so
                                            (admin)/login would resolve to /login, not
                                            /admin/login, breaking the middleware matcher.
                                            Caught during Task 1's implementation.)
      layout.tsx                         (admin shell — nav, no auth logic itself)
      login/
        page.tsx                         (NOT gated by middleware)
        actions.ts                       (signInAdmin server action)
      products/
        page.tsx                         (admin product list)
        actions.ts                       (toggleProductStatus server action)
        new/
          page.tsx                       (add product form)
          actions.ts                     (createProduct server action)
        [id]/
          edit/
            page.tsx                     (edit product form)
            actions.ts                   (updateProduct, updateVariantStock server actions)
  lib/
    supabase/
      client.ts                          (MODIFIED — browser client via @supabase/ssr)
      server.ts                          (MODIFIED — adds a session-aware server client alongside the existing service-role one)
      middleware.ts                      (new — updateSession() used by root middleware.ts)
    admin/
      auth.ts                            (new — requireAdmin(), isAdminEmail())
    images/
      photon.ts                          (new — generateWebpVariants())
      upload.ts                          (new — uploadProductImages())
    db/
      categories.ts                      (new — listCategories())
      products.ts                        (new — listActiveProductsByCategory(), getProductBySlug(), listNewArrivals())
      slug.ts                            (new — slugify(), uniqueProductSlug())
  components/
    product/
      ProductCard.tsx                    (new — grid tile, used by category page + home)
      VariantPicker.tsx                  (new — size chips, greys out-of-stock)
      SizeChart.tsx                      (new — static age-to-measurement table)
    admin/
      ProductForm.tsx                    (new — shared create/edit form UI, client component)
  supabase/
    migrations/
      20260811000001_storage.sql         (new — product-images bucket + public read policy)
  tests/
    slug.test.ts                         (new — unit tests for slug.ts)
```

---

### Task 1: Admin auth (Supabase SSR session + middleware gate + login page)

**Files:**
- Create: `lib/supabase/middleware.ts`
- Create: `middleware.ts`
- Create: `lib/admin/auth.ts`
- Modify: `lib/supabase/client.ts` (switch from plain `@supabase/supabase-js` to `@supabase/ssr`'s `createBrowserClient`)
- Modify: `lib/supabase/server.ts` (add a new `createSessionClient()` alongside the existing service-role `createServerClient()` — keep the existing export name if Week 1 named it differently; verify first)
- Create: `app/admin/login/page.tsx`
- Create: `app/admin/login/actions.ts`
- Modify: `package.json` (add `@supabase/ssr`)
- Create: `.env.local` entry (manual, see Step 1)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars (Week 1); `Button`, `Card` from `components/ui/` (Week 1).
- Produces: `requireAdmin()` — an async function every admin Server Action and Server Component in later tasks calls first; throws/redirects if the caller isn't an authenticated, allowlisted admin. `createSessionClient()` — a cookie-aware Supabase client for use in Server Components/Actions that need to know who's logged in (distinct from the existing service-role client, which has no session concept).

- [ ] **Step 1: Add an admin email allowlist env var (manual)**

Open `.env.local` (already gitignored) and add one line:

```bash
ADMIN_EMAILS=owner@example.com
```

Use the real email you'll log in with (create a Supabase Auth user for it in Step 9 below). Comma-separate if there's more than one owner/staff login. Also add the empty key to `.env.local.example` so the shape is documented:

```bash
# .env.local.example — append this line
ADMIN_EMAILS=
```

- [ ] **Step 2: Install `@supabase/ssr`**

```bash
npm install @supabase/ssr@0.12.4
```

Expected: exits 0, `package.json` `dependencies` gains `"@supabase/ssr": "0.12.4"`.

- [ ] **Step 3: Read the existing `lib/supabase/client.ts` and `lib/supabase/server.ts` before touching them**

Run: `cat lib/supabase/client.ts lib/supabase/server.ts`

Note the exact current export names (e.g. `createClient` vs `createBrowserClient` vs something else) — Week 1's final-review fix wave wrote these, and you need to preserve or deliberately rename them without breaking whatever already imports them. Search for existing importers first:

```bash
grep -rn "from '@/lib/supabase/client'" app components lib 2>/dev/null
grep -rn "from '@/lib/supabase/server'" app components lib 2>/dev/null
```

If nothing imports them yet (likely, since Week 1 only created the files without wiring them into pages), you're free to change the exports. Proceed with Step 4 assuming a clean slate, but adjust names to match what you actually find.

- [ ] **Step 4: Rewrite `lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 5: Rewrite `lib/supabase/server.ts`**

Keep the existing service-role client (Week 1) and add a new session-aware one. If Week 1's file already exports a service-role client under a different name, keep that name — this example assumes it was called `createServerClient`:

```ts
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import "server-only";

/**
 * Service-role client: bypasses RLS. Never expose to the browser.
 * Used by admin Server Actions to read/write products, variants, images.
 */
export function createServerClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Session-aware client: knows who's logged in via cookies. Used to check
 * "is this request from a logged-in admin" — never for data access, since
 * it's still bound by RLS (anon/authenticated policies only).
 */
export async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(
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
            // Called from a Server Component with no response to write to —
            // safe to ignore because middleware.ts refreshes the session.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 6: Write `lib/supabase/middleware.ts`**

```ts
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
```

- [ ] **Step 7: Write root `middleware.ts`**

```ts
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
```

- [ ] **Step 8: Write `lib/admin/auth.ts`**

```ts
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
```

- [ ] **Step 9: Create the admin's Supabase Auth user (manual, one-time)**

This is the real login credential — create it via the Supabase dashboard, not the app (there's no signup flow, deliberately — only the owner should have a login):

1. Go to the Supabase dashboard → Authentication → Users → **Add user**.
2. Email: the same address you put in `ADMIN_EMAILS` (Step 1).
3. Password: set one, save it in a password manager, share with the client separately from this codebase.
4. Confirm the user without requiring email verification (there's a toggle for this in the dashboard's "Add user" form).

- [ ] **Step 10: Write `app/admin/login/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";

export async function signInAdmin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/admin/login?error=missing");
  }

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/admin/login?error=invalid");
  }

  redirect("/admin/products");
}
```

- [ ] **Step 11: Write `app/admin/login/page.tsx`**

```tsx
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { signInAdmin } from "./actions";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm items-center justify-center p-6">
      <Card className="w-full p-6">
        <h1 className="font-display text-2xl font-bold text-ink">Fashion Forward — Admin</h1>
        <p className="mt-1 text-sm text-ink-muted">Owner login only.</p>

        {error === "invalid" && (
          <p className="mt-4 rounded-card bg-accent/10 p-3 text-sm text-ink">
            Wrong email or password. Try again.
          </p>
        )}
        {error === "missing" && (
          <p className="mt-4 rounded-card bg-accent/10 p-3 text-sm text-ink">
            Enter both email and password.
          </p>
        )}

        <form action={signInAdmin} className="mt-5 space-y-3">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
            />
          </div>
          <Button type="submit" className="w-full">
            Log in
          </Button>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 12: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/admin/login`.

- [ ] **Step 13: Verify the login flow locally**

```bash
npm run dev -- --port 3100 &
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/admin/login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/admin/products
kill %1
```

Expected: first curl (`/admin/login`) → `200`. Second curl (`/admin/products`, no session cookie) → `307` (redirect to login) — `curl` without `-L` shows the redirect status directly, which is what proves the gate works. `/admin/products` itself doesn't need to exist yet (it's Task 4) for this redirect check to pass, since middleware runs before the route is resolved.

- [ ] **Step 14: Commit**

```bash
git add lib/supabase lib/admin middleware.ts "app/admin/login" package.json package-lock.json .env.local.example
git commit -m "feat: add admin auth via Supabase SSR sessions and middleware gate"
```

`.env.local` itself is never committed — confirm with `git status`.

---

### Task 2: Image pipeline (WASM resize + WebP, Supabase Storage)

This is the highest-risk task in this plan — a WASM image library that must work identically under `next dev` (Node.js) and the deployed Cloudflare Worker (workerd runtime). Prove it in isolation before wiring it into the admin form.

**Files:**
- Create: `supabase/migrations/20260811000001_storage.sql`
- Create: `lib/images/photon.ts`
- Create: `lib/images/upload.ts`
- Create: `app/api/_smoke/resize/route.ts` (temporary smoke-test route, deleted at the end of this task)
- Modify: `package.json` (add `@cf-wasm/photon`)

**Interfaces:**
- Consumes: `createServerClient()` from `lib/supabase/server.ts` (Task 1).
- Produces: `generateWebpVariants(bytes: Uint8Array): Promise<{ width400: Uint8Array; width800: Uint8Array; width1600: Uint8Array }>` and `uploadProductImages(files: File[], productId: string): Promise<{ url_400: string; url_800: string; url_1600: string; position: number }[]>` — Task 3's `createProduct` action calls this directly.

- [ ] **Step 1: Write the storage bucket migration**

```sql
-- supabase/migrations/20260811000001_storage.sql

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public read product images"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'product-images');

-- No insert/update/delete policy for anon/authenticated: only the
-- service role (which bypasses RLS) writes to this bucket, from admin
-- Server Actions. Matches the products/variants pattern from Week 1.
```

- [ ] **Step 2: Apply the migration locally and push to remote**

```bash
npx supabase db reset
npx supabase db push
```

Expected: both exit 0. Confirm the bucket exists:

```bash
npx supabase db execute --local --sql "select id, public from storage.buckets where id = 'product-images';"
```

Expected: one row, `public = true`. (If `db execute` isn't a valid flag on your installed CLI version — Task 4 of Week 1's plan hit this — use `npx supabase db query --local` instead, or the older `--local --sql` alternative that worked then.)

- [ ] **Step 3: Install `@cf-wasm/photon`**

```bash
npm install @cf-wasm/photon@0.4.0
```

Expected: exits 0, `package.json` `dependencies` gains `"@cf-wasm/photon": "0.4.0"`.

- [ ] **Step 4: Write `lib/images/photon.ts`**

```ts
import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon";

const TARGET_WIDTHS = [400, 800, 1600] as const;

export type WebpVariants = {
  width400: Uint8Array;
  width800: Uint8Array;
  width1600: Uint8Array;
};

/**
 * Resizes one uploaded image into three WebP variants (400/800/1600px
 * wide), preserving aspect ratio. Never upscales — if the source is
 * narrower than a target width, that variant reuses the source's own
 * width instead of stretching it.
 *
 * Imported from the bare "@cf-wasm/photon" specifier (not "/workerd" or
 * "/node") so the package's own conditional exports resolve to the
 * right build automatically: Node's build under `next dev`/`next build`,
 * and the workerd build when OpenNext bundles for Cloudflare.
 */
export async function generateWebpVariants(bytes: Uint8Array): Promise<WebpVariants> {
  const input = PhotonImage.new_from_byteslice(bytes);
  const sourceWidth = input.get_width();
  const sourceHeight = input.get_height();

  const variants: Uint8Array[] = [];

  try {
    for (const targetWidth of TARGET_WIDTHS) {
      const width = Math.min(targetWidth, sourceWidth);
      const height = Math.round(sourceHeight * (width / sourceWidth));

      const resized = resize(input, width, height, SamplingFilter.Lanczos3);
      try {
        variants.push(resized.get_bytes_webp());
      } finally {
        resized.free();
      }
    }
  } finally {
    input.free();
  }

  const [width400, width800, width1600] = variants;
  if (!width400 || !width800 || !width1600) {
    throw new Error("generateWebpVariants: expected exactly 3 variants");
  }
  return { width400, width800, width1600 };
}
```

- [ ] **Step 5: Write a temporary smoke-test route**

```ts
// app/api/_smoke/resize/route.ts
// Temporary — deleted in Step 8 of this task once the pipeline is proven.
import { generateWebpVariants } from "@/lib/images/photon";

export async function GET() {
  // A small, stable, real JPEG — reused only to prove the resize+WebP
  // round-trip works, not fetched from any product data.
  const sourceUrl = "https://images.pexels.com/photos/1005638/pexels-photo-1005638.jpeg?w=300";
  const bytes = new Uint8Array(await fetch(sourceUrl).then((r) => r.arrayBuffer()));

  const { width400 } = await generateWebpVariants(bytes);

  return new Response(width400, {
    headers: { "Content-Type": "image/webp" },
  });
}
```

- [ ] **Step 6: Verify it works under `next dev` (Node.js runtime)**

```bash
npm run dev -- --port 3100 &
sleep 3
curl -s -o /tmp/smoke.webp -w "%{http_code} %{content_type}\n" http://localhost:3100/api/_smoke/resize
file /tmp/smoke.webp
kill %1
```

Expected: `200 image/webp`, and `file /tmp/smoke.webp` reports `RIFF ... Web/P image`. If this fails with a WASM loading error, the Node build of `@cf-wasm/photon` isn't resolving correctly — stop and report `STATUS: NEEDS_CONTEXT` with the exact error rather than guessing at a fix.

- [ ] **Step 7: Verify it works on the deployed Cloudflare Worker (workerd runtime)**

```bash
npm run cf:deploy
curl -s -o /tmp/smoke-cf.webp -w "%{http_code} %{content_type}\n" https://fashion-forward.fashion-forward.workers.dev/api/_smoke/resize
file /tmp/smoke-cf.webp
```

Expected: same `200 image/webp` and valid WebP output. This is the step that actually proves the risk this task exists to retire — Node working locally is not evidence the Workers build works. If this step fails while Step 6 passed, the gap is specifically in how OpenNext bundles the `.wasm` file for Workers; report `STATUS: NEEDS_CONTEXT` with the deploy log and the curl output rather than guessing.

- [ ] **Step 8: Delete the smoke-test route**

```bash
rm -rf app/api/_smoke
```

- [ ] **Step 9: Write `lib/images/upload.ts`**

```ts
import { createServerClient } from "@/lib/supabase/server";
import { generateWebpVariants } from "./photon";

export type UploadedProductImage = {
  url_400: string;
  url_800: string;
  url_1600: string;
  position: number;
};

/**
 * Resizes each uploaded file into 3 WebP variants and uploads all of
 * them to the `product-images` Storage bucket under
 * `{productId}/{position}-{size}.webp`. Returns rows ready to insert
 * into `product_images` (url_400/url_800/url_1600/position) — it does
 * NOT insert them; the caller decides alt text and does the insert
 * alongside the rest of the product creation transaction.
 */
export async function uploadProductImages(
  files: File[],
  productId: string,
): Promise<UploadedProductImage[]> {
  const supabase = createServerClient();
  const results: UploadedProductImage[] = [];

  for (let position = 0; position < files.length; position++) {
    const file = files[position];
    if (!file) continue;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const variants = await generateWebpVariants(bytes);

    const sizes: Array<[keyof typeof variants, string]> = [
      ["width400", "400"],
      ["width800", "800"],
      ["width1600", "1600"],
    ];

    const urls: Record<string, string> = {};

    for (const [key, size] of sizes) {
      const path = `${productId}/${position}-${size}.webp`;
      const { error } = await supabase.storage
        .from("product-images")
        .upload(path, variants[key], { contentType: "image/webp", upsert: true });

      if (error) {
        throw new Error(`Failed to upload ${path}: ${error.message}`);
      }

      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      urls[size] = data.publicUrl;
    }

    results.push({
      url_400: urls["400"]!,
      url_800: urls["800"]!,
      url_1600: urls["1600"]!,
      position,
    });
  }

  return results;
}
```

- [ ] **Step 10: Verify the build still succeeds**

```bash
npm run build
```

Expected: exits 0. `app/api/_smoke` should not appear in the route list (confirms Step 8's deletion took).

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/20260811000001_storage.sql lib/images package.json package-lock.json
git commit -m "feat: add upload-time image resize pipeline (WebP, 3 sizes)"
```

---

### Task 3: Admin — Add Product

**Files:**
- Create: `lib/db/slug.ts`
- Create: `tests/slug.test.ts`
- Create: `components/admin/ProductForm.tsx`
- Create: `app/admin/products/new/page.tsx`
- Create: `app/admin/products/new/actions.ts`
- Create: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `requireAdmin()` (Task 1), `uploadProductImages()` (Task 2), `createServerClient()` (Task 1), `Button`/`Card`/`Badge` (Week 1).
- Produces: `slugify(input: string): string` and `uniqueProductSlug(supabase, title: string): Promise<string>` — Task 4's edit form and Task 5's product queries don't need these directly, but the pattern (auto-slug, never owner-typed) is referenced there.

- [ ] **Step 1: Write the failing test for `slugify`**

```ts
// tests/slug.test.ts
import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/db/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Floral Cotton Frock")).toBe("floral-cotton-frock");
  });

  it("strips punctuation", () => {
    expect(slugify("Kid's Dino Print Tee!")).toBe("kids-dino-print-tee");
  });

  it("collapses repeated whitespace and hyphens", () => {
    expect(slugify("  Denim   Dungaree -- Set  ")).toBe("denim-dungaree-set");
  });

  it("handles an all-punctuation input without crashing", () => {
    expect(slugify("!!!")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/slug.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/db/slug'` or similar.

- [ ] **Step 3: Write `lib/db/slug.ts`**

```ts
import { createServerClient } from "@/lib/supabase/server";

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/'/g, "") // "kid's" -> "kids", not "kid-s"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Appends a short numeric suffix on collision so the owner never has to
 * think about slugs. Checked against the `products` table via the
 * service-role client (bypasses RLS, which is fine — slug uniqueness
 * isn't sensitive data).
 */
export async function uniqueProductSlug(
  supabase: ReturnType<typeof createServerClient>,
  title: string,
): Promise<string> {
  const base = slugify(title) || "product";
  let candidate = base;
  let attempt = 1;

  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) throw new Error(`uniqueProductSlug: ${error.message}`);
    if (!data) return candidate;

    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/slug.test.ts
```

Expected: `4 passed`.

- [ ] **Step 5: Write `app/admin/layout.tsx`**

```tsx
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-tint">
      <header className="border-b border-ink/10 bg-surface px-4 py-3">
        <span className="font-display text-lg font-bold text-brand">Fashion Forward Admin</span>
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Write `components/admin/ProductForm.tsx`**

Shared between create (Task 3) and edit (Task 4). Six visible fields plus the gender control the schema requires (spec §6's "six fields" is approximate — `products.gender` is `not null` in the Week 1 schema and must be collected somewhere; a compact segmented control keeps it a one-tap decision, not a form-filling burden).

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export type ProductFormValues = {
  title: string;
  categoryId: string;
  gender: "boy" | "girl" | "unisex";
  ageGroup: string;
  basePrice: string;
  publishNow: boolean;
  sizes: { size: string; stockQty: string }[];
};

type Category = { id: string; name: string };

const GENDERS: ProductFormValues["gender"][] = ["boy", "girl", "unisex"];

export function ProductForm({
  categories,
  defaultValues,
  submitLabel,
}: {
  categories: Category[];
  defaultValues?: Partial<ProductFormValues>;
  submitLabel: string;
}) {
  const [gender, setGender] = useState<ProductFormValues["gender"]>(
    defaultValues?.gender ?? "unisex",
  );
  const [sizes, setSizes] = useState<{ size: string; stockQty: string }[]>(
    defaultValues?.sizes ?? [{ size: "", stockQty: "0" }],
  );

  function addSizeRow() {
    setSizes((prev) => [...prev, { size: "", stockQty: "0" }]);
  }

  function removeSizeRow(index: number) {
    setSizes((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSizeRow(index: number, key: "size" | "stockQty", value: string) {
    setSizes((prev) => prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  return (
    <Card className="max-w-xl space-y-5 p-5">
      <input type="hidden" name="gender" value={gender} />
      <input type="hidden" name="sizesJson" value={JSON.stringify(sizes)} />

      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium text-ink">
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={defaultValues?.title}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="categoryId" className="mb-1 block text-sm font-medium text-ink">
          Category
        </label>
        <select
          id="categoryId"
          name="categoryId"
          required
          defaultValue={defaultValues?.categoryId}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        >
          <option value="" disabled>
            Choose a category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Gender</span>
        <div className="flex gap-2">
          {GENDERS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGender(g)}
              className={`rounded-card px-4 py-2 text-sm font-medium capitalize ${
                gender === g ? "bg-brand text-on-brand" : "bg-tint text-brand-ink"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="ageGroup" className="mb-1 block text-sm font-medium text-ink">
          Age range
        </label>
        <input
          id="ageGroup"
          name="ageGroup"
          required
          placeholder="e.g. 2-4Y"
          defaultValue={defaultValues?.ageGroup}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="basePrice" className="mb-1 block text-sm font-medium text-ink">
          Price (₹)
        </label>
        <input
          id="basePrice"
          name="basePrice"
          type="number"
          min="0"
          step="1"
          required
          defaultValue={defaultValues?.basePrice}
          className="w-full rounded-card border border-ink/15 px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="photos" className="mb-1 block text-sm font-medium text-ink">
          Photos
        </label>
        <input
          id="photos"
          name="photos"
          type="file"
          accept="image/*"
          multiple
          className="w-full text-sm text-ink"
        />
        <p className="mt-1 text-xs text-ink-muted">First photo becomes the cover image.</p>
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-ink">Sizes &amp; stock</span>
        <div className="space-y-2">
          {sizes.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                placeholder="Size, e.g. 2-3Y"
                value={row.size}
                onChange={(e) => updateSizeRow(i, "size", e.target.value)}
                className="flex-1 rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
              />
              <input
                type="number"
                min="0"
                placeholder="Stock"
                value={row.stockQty}
                onChange={(e) => updateSizeRow(i, "stockQty", e.target.value)}
                className="w-24 rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
              />
              {sizes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeSizeRow(i)}
                  className="text-sm text-accent"
                  aria-label="Remove size"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={addSizeRow} className="mt-2 text-sm font-medium text-brand">
          + Add another size
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="publishNow"
          defaultChecked={defaultValues?.publishNow ?? true}
        />
        Publish immediately (unchecked = save as draft)
      </label>

      <Button type="submit" className="w-full">
        {submitLabel}
      </Button>
    </Card>
  );
}
```

- [ ] **Step 7: Write `app/admin/products/new/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { uniqueProductSlug } from "@/lib/db/slug";
import { uploadProductImages } from "@/lib/images/upload";

export async function createProduct(formData: FormData) {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const gender = String(formData.get("gender") ?? "unisex");
  const ageGroup = String(formData.get("ageGroup") ?? "").trim();
  const basePrice = Number(formData.get("basePrice"));
  const publishNow = formData.get("publishNow") === "on";
  const sizes = JSON.parse(String(formData.get("sizesJson") ?? "[]")) as {
    size: string;
    stockQty: string;
  }[];
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  if (!title || !categoryId || !ageGroup || !Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error("createProduct: missing or invalid required fields");
  }

  const validSizes = sizes
    .map((s) => ({ size: s.size.trim(), stockQty: Number(s.stockQty) }))
    .filter((s) => s.size.length > 0 && Number.isFinite(s.stockQty) && s.stockQty >= 0);

  if (validSizes.length === 0) {
    throw new Error("createProduct: at least one valid size with stock is required");
  }

  const supabase = createServerClient();
  const slug = await uniqueProductSlug(supabase, title);

  const { data: product, error: productError } = await supabase
    .from("products")
    .insert({
      title,
      slug,
      category_id: categoryId,
      gender,
      age_group: ageGroup,
      base_price: basePrice,
      status: publishNow ? "active" : "draft",
    })
    .select()
    .single();

  if (productError || !product) {
    throw new Error(`createProduct: ${productError?.message ?? "no product returned"}`);
  }

  const variantRows = validSizes.map((s) => ({
    product_id: product.id,
    size: s.size,
    sku: `${slug}-${s.size}`.toUpperCase().replace(/[^A-Z0-9-]/g, ""),
    stock_qty: s.stockQty,
  }));

  const { error: variantError } = await supabase.from("variants").insert(variantRows);
  if (variantError) {
    throw new Error(`createProduct: variant insert failed: ${variantError.message}`);
  }

  if (photos.length > 0) {
    const uploaded = await uploadProductImages(photos, product.id);
    const imageRows = uploaded.map((img) => ({
      product_id: product.id,
      url_400: img.url_400,
      url_800: img.url_800,
      url_1600: img.url_1600,
      position: img.position,
    }));
    const { error: imageError } = await supabase.from("product_images").insert(imageRows);
    if (imageError) {
      throw new Error(`createProduct: image row insert failed: ${imageError.message}`);
    }
  }

  redirect("/admin/products");
}
```

- [ ] **Step 8: Write `app/admin/products/new/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "./actions";

export default async function NewProductPage() {
  await requireAdmin();

  const supabase = createServerClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .order("name");

  return (
    <main>
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Add product</h1>
      <form action={createProduct}>
        <ProductForm categories={categories ?? []} submitLabel="Create product" />
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Add at least one category so the form isn't empty (manual, one-time)**

```bash
npx supabase db query --local "insert into categories (slug, name) values ('boys', 'Boys'), ('girls', 'Girls'), ('unisex', 'Unisex') on conflict (slug) do nothing;"
```

Then repeat against remote so the deployed admin has categories to pick from:

```bash
npx supabase db query "insert into categories (slug, name) values ('boys', 'Boys'), ('girls', 'Girls'), ('unisex', 'Unisex') on conflict (slug) do nothing;" --linked
```

(If your installed CLI's flag for running arbitrary SQL against the linked remote differs — check `npx supabase db --help` — use whatever the current CLI actually calls it; the intent is: run this INSERT once against both local and the remote Mumbai project.)

- [ ] **Step 10: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/admin/products/new`.

- [ ] **Step 11: Manual verification — create a real product end to end**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Open `http://localhost:3100/admin/login`, log in with the credentials from Task 1 Step 9, go to `/admin/products/new`, fill in a real test product (title, category, gender, age range, price, one size with stock, one photo), submit. Confirm:
- Redirected to `/admin/products` (route can 404 until Task 4 — that's fine, confirms the redirect fired).
- `npx supabase db query --local "select title, slug, status from products order by created_at desc limit 1;"` shows the new row.
- `npx supabase db query --local "select size, sku, stock_qty from variants order by created_at desc limit 1;"` shows the matching variant.
- The Storage bucket has the uploaded files: check via the Supabase dashboard's Storage browser, or `npx supabase db query --local "select name from storage.objects where bucket_id = 'product-images' order by created_at desc limit 3;"`.

```bash
kill %1
```

- [ ] **Step 12: Commit**

```bash
git add lib/db/slug.ts tests/slug.test.ts components/admin/ProductForm.tsx "app/admin/products/new" "app/admin/layout.tsx"
git commit -m "feat: add admin create-product form and server action"
```

---

### Task 4: Admin — Products list + Edit

**Files:**
- Create: `app/admin/products/page.tsx`
- Create: `app/admin/products/actions.ts`
- Create: `app/admin/products/[id]/edit/page.tsx`
- Create: `app/admin/products/[id]/edit/actions.ts`

**Interfaces:**
- Consumes: `ProductForm` (Task 3), `requireAdmin()` (Task 1), `Badge` (Week 1).
- Produces: nothing further tasks in this plan depend on — this is a leaf task.

- [ ] **Step 1: Write `app/admin/products/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function toggleProductStatus(productId: string, currentStatus: string) {
  await requireAdmin();

  const nextStatus = currentStatus === "active" ? "archived" : "active";
  const supabase = createServerClient();
  const { error } = await supabase
    .from("products")
    .update({ status: nextStatus })
    .eq("id", productId);

  if (error) throw new Error(`toggleProductStatus: ${error.message}`);

  revalidatePath("/admin/products");
}
```

- [ ] **Step 2: Write `app/admin/products/page.tsx`**

```tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { toggleProductStatus } from "./actions";

export default async function AdminProductsPage() {
  await requireAdmin();

  const supabase = createServerClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, title, base_price, status")
    .order("created_at", { ascending: false });

  return (
    <main>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-ink">Products</h1>
        <Link href="/admin/products/new" className="text-sm font-semibold text-brand">
          + Add product
        </Link>
      </div>

      <div className="space-y-2">
        {(products ?? []).map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-card border border-ink/10 bg-surface p-3"
          >
            <div>
              <Link href={`/admin/products/${p.id}/edit`} className="font-medium text-ink">
                {p.title}
              </Link>
              <div className="text-sm text-ink-muted">₹{p.base_price}</div>
            </div>
            <div className="flex items-center gap-3">
              <Badge tone={p.status === "active" ? "brand" : "accent"}>{p.status}</Badge>
              <form
                action={async () => {
                  "use server";
                  await toggleProductStatus(p.id, p.status);
                }}
              >
                <button type="submit" className="text-sm font-medium text-brand">
                  {p.status === "active" ? "Archive" : "Activate"}
                </button>
              </form>
            </div>
          </div>
        ))}
        {(!products || products.length === 0) && (
          <p className="text-sm text-ink-muted">No products yet.</p>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Write `app/admin/products/[id]/edit/actions.ts`**

```ts
"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";

export async function updateProduct(productId: string, formData: FormData) {
  await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "");
  const gender = String(formData.get("gender") ?? "unisex");
  const ageGroup = String(formData.get("ageGroup") ?? "").trim();
  const basePrice = Number(formData.get("basePrice"));
  const publishNow = formData.get("publishNow") === "on";
  const sizes = JSON.parse(String(formData.get("sizesJson") ?? "[]")) as {
    size: string;
    stockQty: string;
  }[];

  if (!title || !categoryId || !ageGroup || !Number.isFinite(basePrice) || basePrice < 0) {
    throw new Error("updateProduct: missing or invalid required fields");
  }

  const supabase = createServerClient();

  const { error: productError } = await supabase
    .from("products")
    .update({
      title,
      category_id: categoryId,
      gender,
      age_group: ageGroup,
      base_price: basePrice,
      status: publishNow ? "active" : "draft",
    })
    .eq("id", productId);

  if (productError) {
    throw new Error(`updateProduct: ${productError.message}`);
  }

  // Stock is per-variant and variants are identified by size, which the
  // owner can't rename mid-edit in this form (add/remove only) — update
  // stock_qty for sizes that already exist, insert any newly-added ones.
  for (const row of sizes) {
    const size = row.size.trim();
    const stockQty = Number(row.stockQty);
    if (!size || !Number.isFinite(stockQty) || stockQty < 0) continue;

    const { data: existing } = await supabase
      .from("variants")
      .select("id")
      .eq("product_id", productId)
      .eq("size", size)
      .maybeSingle();

    if (existing) {
      await supabase.from("variants").update({ stock_qty: stockQty }).eq("id", existing.id);
    } else {
      const sku = `${productId}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 40);
      await supabase.from("variants").insert({ product_id: productId, size, sku, stock_qty: stockQty });
    }
  }

  redirect("/admin/products");
}
```

- [ ] **Step 4: Write `app/admin/products/[id]/edit/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { createServerClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "./actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = createServerClient();
  const [{ data: product }, { data: categories }, { data: variants }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).maybeSingle(),
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("variants").select("size, stock_qty").eq("product_id", id).order("size"),
  ]);

  if (!product) notFound();

  const updateProductWithId = updateProduct.bind(null, id);

  return (
    <main>
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">Edit product</h1>
      <form action={updateProductWithId}>
        <ProductForm
          categories={categories ?? []}
          submitLabel="Save changes"
          defaultValues={{
            title: product.title,
            categoryId: product.category_id ?? "",
            gender: product.gender,
            ageGroup: product.age_group,
            basePrice: String(product.base_price),
            publishNow: product.status === "active",
            sizes: (variants ?? []).map((v) => ({ size: v.size, stockQty: String(v.stock_qty) })),
          }}
        />
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/admin/products`, `/admin/products/[id]/edit`.

- [ ] **Step 6: Manual verification**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Log in, go to `/admin/products` — confirm the test product from Task 3 appears. Click it, change the price, change a size's stock, save. Confirm the change persisted: `npx supabase db query --local "select base_price from products where id = '<id>';"`. Click "Archive" from the list, confirm the badge flips and `status` changes to `archived` in the DB.

```bash
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add "app/admin/products"
git commit -m "feat: add admin product list, status toggle, and edit form"
```

---

### Task 5: Storefront — DB queries + category page with filters

**Files:**
- Create: `lib/db/categories.ts`
- Create: `lib/db/products.ts`
- Create: `components/product/ProductCard.tsx`
- Create: `app/(shop)/c/[category]/page.tsx`
- Create: `app/(shop)/c/[category]/CategoryFilters.tsx`

**Interfaces:**
- Consumes: `createClient()` from `lib/supabase/client.ts` and a new server-side read helper (see Step 1) — storefront reads are anon-key, RLS-gated, no admin dependency.
- Produces: `ProductCard` — consumed by Task 7 (home page). `listActiveProductsByCategory(categorySlug: string): Promise<ProductListItem[]>` and the `ProductListItem` type — consumed by Task 6 (PDP, for "you might also like"-style category context — optional there, but the type is shared) and Task 7.

- [ ] **Step 1: Write `lib/db/categories.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

/**
 * Storefront reads don't need cookies/session — a plain anon-key client
 * is enough and works identically in Server Components and Route
 * Handlers. Distinct from lib/supabase/client.ts (browser) and
 * lib/supabase/server.ts's createSessionClient() (admin session-aware).
 */
function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export type Category = { id: string; slug: string; name: string };

export async function listCategories(): Promise<Category[]> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, name")
    .order("name");

  if (error) throw new Error(`listCategories: ${error.message}`);
  return data ?? [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`getCategoryBySlug: ${error.message}`);
  return data;
}
```

- [ ] **Step 2: Write `lib/db/products.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

function createReadClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export type ProductListItem = {
  id: string;
  slug: string;
  title: string;
  gender: "boy" | "girl" | "unisex";
  age_group: string;
  base_price: number;
  cover_image_url: string | null;
  sizes: string[];
};

// Supabase's nested-select shape for the query in listActiveProductsByCategory.
type ProductRow = {
  id: string;
  slug: string;
  title: string;
  gender: "boy" | "girl" | "unisex";
  age_group: string;
  base_price: number;
  product_images: { url_400: string; position: number }[];
  variants: { size: string }[];
};

function toListItem(row: ProductRow): ProductListItem {
  const cover = [...row.product_images].sort((a, b) => a.position - b.position)[0];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    gender: row.gender,
    age_group: row.age_group,
    base_price: row.base_price,
    cover_image_url: cover?.url_400 ?? null,
    sizes: row.variants.map((v) => v.size),
  };
}

export async function listActiveProductsByCategory(categorySlug: string): Promise<ProductListItem[]> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, title, gender, age_group, base_price, product_images(url_400, position), variants(size), categories!inner(slug)",
    )
    .eq("status", "active")
    .eq("categories.slug", categorySlug)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listActiveProductsByCategory: ${error.message}`);
  return ((data ?? []) as unknown as ProductRow[]).map(toListItem);
}

export async function listNewArrivals(limit: number): Promise<ProductListItem[]> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, slug, title, gender, age_group, base_price, product_images(url_400, position), variants(size)")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`listNewArrivals: ${error.message}`);
  return ((data ?? []) as unknown as ProductRow[]).map(toListItem);
}

export type ProductDetail = ProductListItem & {
  description: string | null;
  images: { url_400: string; url_800: string; url_1600: string; alt: string | null; position: number }[];
  variants: { id: string; size: string; stock_qty: number }[];
};

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const supabase = createReadClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, title, description, gender, age_group, base_price, product_images(url_400, url_800, url_1600, alt, position), variants(id, size, stock_qty)",
    )
    .eq("status", "active")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`getProductBySlug: ${error.message}`);
  if (!data) return null;

  const images = [...data.product_images].sort((a, b) => a.position - b.position);

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    description: data.description,
    gender: data.gender,
    age_group: data.age_group,
    base_price: data.base_price,
    cover_image_url: images[0]?.url_400 ?? null,
    images,
    variants: data.variants,
    sizes: data.variants.map((v) => v.size),
  };
}
```

- [ ] **Step 3: Write `components/product/ProductCard.tsx`**

```tsx
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { PriceTag } from "@/components/ui/PriceTag";
import type { ProductListItem } from "@/lib/db/products";

export function ProductCard({ product }: { product: ProductListItem }) {
  return (
    <Link href={`/p/${product.slug}`}>
      <Card className="overflow-hidden transition-transform hover:-translate-y-0.5">
        <div className="aspect-[4/5] bg-tint">
          {product.cover_image_url ? (
            <img
              src={product.cover_image_url}
              alt={product.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="space-y-1 p-3">
          <p className="text-sm font-medium text-ink">{product.title}</p>
          <p className="text-xs text-ink-muted">{product.age_group}</p>
          <PriceTag price={product.base_price} />
        </div>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 4: Write `app/(shop)/c/[category]/CategoryFilters.tsx`**

Client-side filtering per spec §5 ("At ~150 SKUs no search infrastructure is needed") — the full category product list is fetched once server-side (Step 5) and filtered in the browser, no re-fetch per filter change.

```tsx
"use client";

import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product/ProductCard";
import type { ProductListItem } from "@/lib/db/products";

export function CategoryFilters({ products }: { products: ProductListItem[] }) {
  const [gender, setGender] = useState<"all" | "boy" | "girl" | "unisex">("all");
  const [size, setSize] = useState<string>("all");
  const [maxPrice, setMaxPrice] = useState<number>(
    Math.max(0, ...products.map((p) => p.base_price)),
  );

  const allSizes = useMemo(
    () => Array.from(new Set(products.flatMap((p) => p.sizes))).sort(),
    [products],
  );
  const priceCeiling = useMemo(
    () => Math.max(0, ...products.map((p) => p.base_price)),
    [products],
  );

  const filtered = products.filter((p) => {
    if (gender !== "all" && p.gender !== gender) return false;
    if (size !== "all" && !p.sizes.includes(size)) return false;
    if (p.base_price > maxPrice) return false;
    return true;
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-3">
        <select
          value={gender}
          onChange={(e) => setGender(e.target.value as typeof gender)}
          className="rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
        >
          <option value="all">All genders</option>
          <option value="boy">Boys</option>
          <option value="girl">Girls</option>
          <option value="unisex">Unisex</option>
        </select>

        <select
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="rounded-card border border-ink/15 px-3 py-2 text-sm text-ink"
        >
          <option value="all">All sizes</option>
          {allSizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-ink">
          Up to ₹{maxPrice}
          <input
            type="range"
            min={0}
            max={priceCeiling}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-ink-muted">No products match those filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `app/(shop)/c/[category]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getCategoryBySlug } from "@/lib/db/categories";
import { listActiveProductsByCategory } from "@/lib/db/products";
import { CategoryFilters } from "./CategoryFilters";

export const revalidate = 300; // ISR, per spec §5's route table

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categorySlug } = await params;

  const category = await getCategoryBySlug(categorySlug);
  if (!category) notFound();

  const products = await listActiveProductsByCategory(categorySlug);

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 font-display text-2xl font-bold text-ink">{category.name}</h1>
      <CategoryFilters products={products} />
    </main>
  );
}
```

- [ ] **Step 6: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/c/[category]`.

- [ ] **Step 7: Manual verification**

```bash
npm run dev -- --port 3100 &
sleep 3
curl -s http://localhost:3100/c/boys | grep -o "Boys" | head -1
kill %1
```

Expected: prints `Boys` (confirms the category page renders with real category data — assumes Task 3 Step 9's category seed ran). If you created a test product under the "Boys" category in Task 3's manual verification, also open `http://localhost:3100/c/boys` in a browser and confirm it appears with working gender/size/price filters.

- [ ] **Step 8: Commit**

```bash
git add lib/db/categories.ts lib/db/products.ts components/product/ProductCard.tsx "app/(shop)/c"
git commit -m "feat: add category listing page with client-side filters"
```

---

### Task 6: Storefront — Product detail page (PDP)

**Files:**
- Create: `components/product/VariantPicker.tsx`
- Create: `components/product/SizeChart.tsx`
- Create: `app/(shop)/p/[slug]/page.tsx`

**Interfaces:**
- Consumes: `getProductBySlug()` (Task 5), `Badge`/`PriceTag`/`Button` (Week 1).
- Produces: nothing further tasks in this plan depend on — this is a leaf task.

- [ ] **Step 1: Write `components/product/SizeChart.tsx`**

Static for now — spec §5 calls this "a first-class feature," but real per-product measurements don't exist until Week 6's data entry. This generic reference table ships now; a per-product "runs small / true to size" note is explicitly deferred (see this plan's exit criteria).

```tsx
const ROWS = [
  { age: "0-1Y", height: "50-76 cm", chest: "44-47 cm" },
  { age: "1-2Y", height: "77-86 cm", chest: "48-50 cm" },
  { age: "2-3Y", height: "87-96 cm", chest: "51-53 cm" },
  { age: "3-4Y", height: "97-104 cm", chest: "54-56 cm" },
  { age: "4-5Y", height: "105-110 cm", chest: "57-59 cm" },
  { age: "5-6Y", height: "111-116 cm", chest: "60-62 cm" },
  { age: "6-7Y", height: "117-122 cm", chest: "63-65 cm" },
  { age: "7-8Y", height: "123-128 cm", chest: "66-68 cm" },
  { age: "8-9Y", height: "129-134 cm", chest: "69-71 cm" },
];

export function SizeChart() {
  return (
    <details className="rounded-card border border-ink/10 bg-surface p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">Size chart</summary>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="text-ink-muted">
            <th className="py-1">Age</th>
            <th className="py-1">Height</th>
            <th className="py-1">Chest</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.age} className="border-t border-ink/10">
              <td className="py-1 text-ink">{row.age}</td>
              <td className="py-1 text-ink">{row.height}</td>
              <td className="py-1 text-ink">{row.chest}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">General reference — runs true to size unless noted.</p>
    </details>
  );
}
```

- [ ] **Step 2: Write `components/product/VariantPicker.tsx`**

Out-of-stock sizes are shown greyed, never hidden — spec §5, binding.

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type Variant = { id: string; size: string; stock_qty: number };

export function VariantPicker({ variants }: { variants: Variant[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    variants.find((v) => v.stock_qty > 0)?.id ?? null,
  );

  const selected = variants.find((v) => v.id === selectedId);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {variants.map((v) => {
          const outOfStock = v.stock_qty === 0;
          const isSelected = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              disabled={outOfStock}
              onClick={() => setSelectedId(v.id)}
              aria-pressed={isSelected}
              className={`rounded-card border px-4 py-2 text-sm font-medium ${
                outOfStock
                  ? "cursor-not-allowed border-ink/10 text-ink-muted line-through"
                  : isSelected
                    ? "border-brand bg-brand text-on-brand"
                    : "border-ink/15 text-ink"
              }`}
            >
              {v.size}
            </button>
          );
        })}
      </div>

      <Button type="button" disabled={!selected} className="w-full">
        {selected ? "Add to bag" : "Select a size"}
      </Button>
      <p className="mt-2 text-center text-xs text-ink-muted">
        Cart launches in Week 3 — sizes and stock shown here are live.
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write `app/(shop)/p/[slug]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { getProductBySlug } from "@/lib/db/products";
import { Badge } from "@/components/ui/Badge";
import { PriceTag } from "@/components/ui/PriceTag";
import { VariantPicker } from "@/components/product/VariantPicker";
import { SizeChart } from "@/components/product/SizeChart";

export const revalidate = 300;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  const totalStock = product.variants.reduce((sum, v) => sum + v.stock_qty, 0);

  return (
    <main className="mx-auto max-w-4xl p-4">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          {product.images.length > 0 ? (
            product.images.map((img) => (
              <img
                key={img.position}
                src={img.url_800}
                srcSet={`${img.url_400} 400w, ${img.url_800} 800w, ${img.url_1600} 1600w`}
                sizes="(max-width: 640px) 100vw, 50vw"
                alt={img.alt ?? product.title}
                className="w-full rounded-card bg-tint object-cover"
              />
            ))
          ) : (
            <div className="aspect-square rounded-card bg-tint" />
          )}
        </div>

        <div>
          {totalStock === 0 && (
            <Badge tone="accent" className="mb-2">
              Sold out
            </Badge>
          )}
          <h1 className="font-display text-2xl font-bold text-ink">{product.title}</h1>
          <p className="mt-1 text-sm text-ink-muted">{product.age_group}</p>
          <div className="mt-3">
            <PriceTag price={product.base_price} />
          </div>

          {product.description && <p className="mt-4 text-sm text-ink">{product.description}</p>}

          <div className="mt-5">
            <VariantPicker variants={product.variants} />
          </div>

          <div className="mt-5">
            <SizeChart />
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify `Badge` accepts a `className` prop**

Week 1's final review flagged `Badge` as missing `className` passthrough (deferred as a minor). Check:

```bash
grep -n "className" components/ui/Badge.tsx
```

If `Badge` doesn't accept/forward `className`, add it now (small, in-scope fix since this task's PDP is the first real consumer that needs it):

```tsx
// components/ui/Badge.tsx
type BadgeProps = {
  tone?: "accent" | "highlight" | "brand";
  className?: string;
  children: React.ReactNode;
};

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  accent: "bg-accent text-on-accent",
  highlight: "bg-highlight text-ink",
  brand: "bg-brand text-on-brand",
};

export function Badge({ tone = "accent", className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-body font-semibold ${toneClasses[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list includes `/p/[slug]`.

- [ ] **Step 6: Manual verification**

```bash
npm run dev -- --port 3100 &
sleep 3
```

Open `http://localhost:3100/p/<slug-of-your-test-product>` (get the slug via `npx supabase db query --local "select slug from products limit 1;"`). Confirm: photo(s) render, price shows, size chips render with the test size clickable, size chart expands on click, "Add to bag" is disabled until a size is picked.

```bash
kill %1
```

- [ ] **Step 7: Commit**

```bash
git add components/product/VariantPicker.tsx components/product/SizeChart.tsx "app/(shop)/p" components/ui/Badge.tsx
git commit -m "feat: add product detail page with variant picker and size chart"
```

---

### Task 7: Storefront — Home page real content

**Files:**
- Modify: `app/(shop)/page.tsx` (create — this is the Week 1 stub `app/page.tsx` moved into the new route group)
- Delete: `app/page.tsx` (Week 1 stub, superseded)

**Interfaces:**
- Consumes: `listCategories()` (Task 5), `listNewArrivals()` (Task 5), `ProductCard` (Task 5), `Button` (Week 1).
- Produces: nothing — final task in this plan.

- [ ] **Step 1: Move the stub out and write the real home page**

```bash
git mv app/page.tsx app/\(shop\)/page.tsx
```

Then replace its contents entirely:

```tsx
// app/(shop)/page.tsx
import Link from "next/link";
import { listCategories } from "@/lib/db/categories";
import { listNewArrivals } from "@/lib/db/products";
import { ProductCard } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";

export const revalidate = 300;

export default async function HomePage() {
  const [categories, newArrivals] = await Promise.all([listCategories(), listNewArrivals(8)]);

  return (
    <main>
      <section className="bg-tint px-4 py-12 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Fashion Forward</h1>
        <p className="mx-auto mt-2 max-w-md text-ink-muted">
          Kids' clothing in RT Nagar, Bangalore — now online, same-day delivery.
        </p>
        <Link href="/c/boys">
          <Button className="mt-5">Shop new arrivals</Button>
        </Link>
      </section>

      {categories.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">Shop by category</h2>
          <div className="flex flex-wrap gap-3">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                className="rounded-card bg-tint px-5 py-3 font-medium text-brand-ink"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {newArrivals.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-8">
          <h2 className="mb-4 font-display text-xl font-bold text-ink">New arrivals</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {newArrivals.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {categories.length === 0 && newArrivals.length === 0 && (
        <p className="p-8 text-center text-ink-muted">
          Products are on their way — check back soon.
        </p>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify the build succeeds**

```bash
npm run build
```

Expected: exits 0, route list shows `/` (now served from the `(shop)` group), `app/page.tsx` no longer exists.

- [ ] **Step 3: Deploy and verify the live site**

```bash
npm run cf:deploy
curl -s -o /dev/null -w "%{http_code}\n" https://fashion-forward.fashion-forward.workers.dev/
curl -s https://fashion-forward.fashion-forward.workers.dev/ | grep -o "Fashion Forward" | head -1
```

Expected: `200`, and `Fashion Forward` printed (confirms real content, not the Week 1 "Site under construction" stub).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: replace placeholder home page with real catalog content"
```

---

## Week 2 exit criteria

Before starting Week 3 (spec §11: cart, phone OTP auth, address capture, pincode gate, checkout UI), confirm all of the following are true:

- [ ] `npm run build` succeeds locally with zero errors
- [ ] `/admin/login` is reachable without a session; every other `/admin/*` route redirects there without one
- [ ] A real product created via `/admin/products/new` appears correctly on `/`, its category page, and its own PDP
- [ ] Product photos are served at three real WebP sizes (spot-check: the `product_images` row's three URLs all return `200` and `Content-Type: image/webp`)
- [ ] Category page filters (gender, size, price) narrow the visible grid without a page reload
- [ ] PDP shows out-of-stock sizes greyed, never hidden
- [ ] The live Cloudflare Workers URL serves `/`, `/c/[category]`, and `/p/[slug]` with real data, not the Week 1 stub
- [ ] `npx vitest run tests/slug.test.ts` passes
- [ ] No hex colour or raw Tailwind palette class appears anywhere under `components/` or `app/` outside `globals.css` (same grep as Week 1's exit criteria, now also covering `(shop)` and `(admin)`)
- [ ] `.env.local` (with `ADMIN_EMAILS` added this week) is confirmed still gitignored and was never committed

**Explicitly out of scope for Week 2** (confirm these are NOT attempted, to keep the plan's boundary honest): shopping cart persistence, phone OTP customer auth, checkout, payments, per-product size-chart notes ("runs small/true to size" — generic chart only this week), product `color`/`price_override` fields (schema supports them, UI doesn't expose them yet), coupons, order management. All are Week 3+ per spec §11.
