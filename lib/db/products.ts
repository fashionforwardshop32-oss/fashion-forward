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
