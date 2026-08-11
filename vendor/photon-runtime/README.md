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
