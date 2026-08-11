import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next@15.5.22 still ships eslintrc-style configs only (no flat
// export in its package.json), so the compat shim is required.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      // Bundles the Supabase CLI writes when the local stack starts.
      "supabase/.temp/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Importing the library directly resolves its Node build on Cloudflare,
      // which throws "Wasm code generation disallowed by embedder" at runtime --
      // a failure that only shows up on the deployed Worker, never locally.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@cf-wasm/photon", "@cf-wasm/photon/*"],
              message:
                "Import 'photon-runtime' instead -- see vendor/photon-runtime/README.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // The shim is the one place that may reference the real package: picking
    // between its builds is the whole reason it exists.
    files: ["vendor/photon-runtime/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default config;
