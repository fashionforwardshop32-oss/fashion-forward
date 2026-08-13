# photon-runtime

A four-line local package that exists purely to control export-condition order.

`@cf-wasm/photon` ships three builds. Only the `workerd` one runs on Cloudflare
Workers: the `node` build calls `new WebAssembly.Module(inlineBytes)` at import
time and workerd rejects that with `CompileError: WebAssembly.Module(): Wasm
code generation disallowed by embedder`.

Importing the bare `@cf-wasm/photon` specifier does not pick the right one.
OpenNext bundles the server with esbuild using `platform: "node"` plus the
`workerd` condition, so *both* conditions are active — and which one wins is
decided by the order of the keys in the dependency's own `exports` map, where
`node` is listed first. The Worker therefore gets the Node build and 500s at
runtime.

This package re-exports the same library through an `exports` map we own, with
`workerd` ahead of `node`. Resolution then lands correctly in both places:

- `next dev` / `next start`: Node resolves it at runtime (the package is listed
  in `serverExternalPackages`, so webpack leaves the import alone) and matches
  `node` -> the Node build.
- `opennextjs-cloudflare build`: esbuild matches `workerd` -> the workerd build,
  whose `.wasm` import wrangler bundles as a real WebAssembly module.

Import `photon-runtime` from application code; never `@cf-wasm/photon` directly.

## Editing this directory requires `npm install`

`.npmrc` sets `install-links=true`, which makes npm install this `file:`
dependency as a real **copy** in `node_modules/photon-runtime/`, not a symlink.

- **Re-run `npm install` after editing anything in this directory**, or builds
  keep using the stale copy — silently, with no error and no warning.
- A fresh clone must run `npm install` with `.npmrc` present. Installing with
  `.npmrc` missing or ignored produces a symlink and the Worker 500s at
  runtime.

## This fix is one interlocking mechanism — no automated test covers it

Getting the workerd build of photon onto the Worker depends on **four separate
pieces working together**. Breaking any one of them breaks the pipeline:

1. **`.npmrc`** — `install-links=true`, so `node_modules/photon-runtime` is a
   real directory. Next.js only treats a package as external when it resolves
   inside `node_modules`; a symlink resolves back to `vendor/` and webpack
   bundles it.
2. **`next.config.ts` → `serverExternalPackages: ["photon-runtime"]`** — keeps
   webpack from inlining the Node build into the server bundle.
3. **`next.config.ts` → `outputFileTracingIncludes`** — copies
   `@cf-wasm/photon/dist/**` into the build output, so OpenNext's bundler can
   resolve the workerd build and its `.wasm` from there.
4. **This package's `package.json` `exports` ordering** — `workerd` listed
   ahead of `node`, which is the entire reason this package exists.

Delete `.npmrc`, drop either `next.config.ts` entry, or upgrade to a version of
Next.js / `@opennextjs/cloudflare` / `@cf-wasm/photon` that resolves export
conditions differently, and **every local signal still passes**: `next dev`,
`next build`, `tsc --noEmit`, `eslint` (the `no-restricted-imports` rule only
catches a direct `@cf-wasm/photon` import), and even `npm run cf:deploy`
succeeding. The failure shows up only as a runtime 500 on the live Worker.

`npm run cf:preview` is **not** sufficient to catch this either — local workerd
does not enforce the real CPU and memory limits.

### Required after any version bump

After bumping `next`, `@opennextjs/cloudflare` or `@cf-wasm/photon`, someone
must **manually verify a real image resize still works against a
live-deployed Worker** — deploy, upload a photo through `/admin/products/new`,
and confirm the generated WebP URLs return `200 image/webp` — before trusting
the image pipeline. See [`docs/deploy-checklist.md`](../../docs/deploy-checklist.md).

There is deliberately no automated detection for this; building one is out of
scope. Treat this section as the check.
