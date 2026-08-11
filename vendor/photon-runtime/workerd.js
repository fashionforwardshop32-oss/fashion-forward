// Cloudflare Workers build: imports the .wasm as a module, which wrangler
// bundles alongside the Worker. workerd forbids compiling WASM from bytes at
// runtime, so this is the only build that can run there.
export * from "@cf-wasm/photon/workerd";
