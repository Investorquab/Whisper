import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
  },
  {
    // Standalone <script> for sites without a bundler. Only the button code, no crypto.
    entry: { "whisper-button": "src/button-script.ts" },
    format: ["iife"],
    globalName: "WhisperButton",
    minify: true,
    target: "es2019",
    outExtension: () => ({ js: ".js" }),
  },
]);
