// Node build: compiles the inlined .wasm bytes with `new WebAssembly.Module()`,
// which plain Node allows and `.wasm` module imports would not.
export * from "@cf-wasm/photon/node";
