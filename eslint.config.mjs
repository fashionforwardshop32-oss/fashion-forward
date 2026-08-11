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
];

export default config;
