import "server-only";

import { PhotonImage, SamplingFilter, resize } from "photon-runtime";

const TARGET_WIDTHS = [400, 800, 1600] as const;

export type WebpVariants = {
  width400: Uint8Array;
  width800: Uint8Array;
  width1600: Uint8Array;
};

/**
 * Resizes one uploaded image into three WebP variants (400/800/1600px
 * wide), preserving aspect ratio. Never upscales -- if the source is
 * narrower than a target width, that variant reuses the source's own
 * width instead of stretching it.
 *
 * Imported through the local `photon-runtime` package rather than
 * `@cf-wasm/photon` directly: that package's own export conditions list
 * `node` ahead of `workerd`, so the Worker build picks the Node build and
 * dies on `new WebAssembly.Module()`. `photon-runtime` re-exports the same
 * library through an export map we control, so each runtime gets the build
 * that works there. See vendor/photon-runtime/README.md.
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
