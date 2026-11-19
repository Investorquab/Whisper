import react from "@vitejs/plugin-react";
import { HttpsProxyAgent } from "https-proxy-agent";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";

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

// Two pages: the static landing at "/" (index.html) and the wallet app (app.html) for its routes.
// Vercel does the same with rewrites (vercel.json); this plugin mirrors them for dev and preview.
const APP_ROUTE = /^\/(app|to|setup|check)(\/|$|\?)/;
const rewriteAppRoutes: Connect.NextHandleFunction = (req, _res, next) => {
  if (req.url && APP_ROUTE.test(req.url)) req.url = "/app.html";
  next();
};
const appRoutes: Plugin = {
  name: "whisper-app-routes",
  configureServer: (server) => void server.middlewares.use(rewriteAppRoutes),
  configurePreviewServer: (server) => void server.middlewares.use(rewriteAppRoutes),
};

export default defineConfig({
  plugins: [react(), appRoutes],
  server: { proxy: handleProxy },
  preview: { proxy: handleProxy },
  build: {
    target: "es2022",
    sourcemap: true,
    // public/assets holds the landing page's design kit, so the app's own bundles go to /_app.
    assetsDir: "_app",
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL("index.html", import.meta.url)),
        app: fileURLToPath(new URL("app.html", import.meta.url)),
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"] },
} as never);
