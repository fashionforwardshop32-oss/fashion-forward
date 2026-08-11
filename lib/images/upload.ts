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
 * into `product_images` (url_400/url_800/url_1600/position) -- it does
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
