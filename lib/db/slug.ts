import { createServerClient } from "@/lib/supabase/server";

// Combining diacritical marks (U+0300-U+036F), expressed via fromCharCode
// rather than a \uXXXX regex literal to avoid escape-sequence mangling in
// this toolchain's editor pipeline. Equivalent to /[̀-ͯ]/g.
const COMBINING_MARKS_REGEX = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g",
);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(COMBINING_MARKS_REGEX, "") // strip accents
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
