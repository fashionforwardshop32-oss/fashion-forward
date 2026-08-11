import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the photon WASM library out of the webpack server bundle. Webpack
  // would inline the "node" build, which calls `new WebAssembly.Module(bytes)`
  // at import time -- workerd forbids runtime WASM compilation ("Wasm code
  // generation disallowed by embedder"). Left external, the import survives
  // into the built output and is resolved per environment: by Node under
  // `next dev`/`next start`, and by OpenNext's esbuild pass (workerd
  // condition) when building the Worker. See vendor/photon-runtime/README.md.
  serverExternalPackages: ["photon-runtime"],

  // File tracing follows the "node" condition, so it only copies photon's Node
  // build into the build output. OpenNext's bundler resolves the "workerd" one
  // from that same output, so the workerd build and its `.wasm` have to be
  // copied along too or the Worker build fails to resolve them.
  outputFileTracingIncludes: {
    "**": ["./node_modules/@cf-wasm/photon/dist/**"],
  },
};

export default nextConfig;
