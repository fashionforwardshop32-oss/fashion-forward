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
