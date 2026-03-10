import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [nodePolyfills({ include: ["buffer"] })],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: [
      "@aztec/bb.js",
      "@noir-lang/acvm_js",
      "@noir-lang/noirc_abi",
    ],
  },
  build: {
    target: "esnext",
  },
});
