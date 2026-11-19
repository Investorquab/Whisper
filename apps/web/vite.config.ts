import react from "@vitejs/plugin-react";
import { HttpsProxyAgent } from "https-proxy-agent";
import { defineConfig } from "vite";

// Behind a corporate or sandbox proxy, route the dev proxy through it (no effect when HTTPS_PROXY is unset).
const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;

// QoreX's handle registry only answers browser requests from the QoreChain dashboard, so the app reads it
// through a same-origin path. Records are verified in the browser (owner + registry signatures).
const handleProxy = {
  "/api/handles": {
    target: "https://cadkdpvbuztgqexpwoxkikmxya0vtcvd.lambda-url.us-east-1.on.aws",
    changeOrigin: true,
    agent,
    rewrite: (path: string) => path.replace(/^\/api\/handles/, ""),
  },
  // QoreChain's REST API sends no CORS headers. Only the read-only post-quantum key routes are forwarded.
  "/api/qore/qorechain/pqc/v1": {
    target: "https://api-testnet.qore.host",
    changeOrigin: true,
    agent,
    rewrite: (path: string) => path.replace(/^\/api\/qore/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: handleProxy },
  preview: { proxy: handleProxy },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"] },
} as never);
