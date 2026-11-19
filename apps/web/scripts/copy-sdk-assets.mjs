// Serves the SDK's drop-in "Message the creator" script from the app origin (/whisper-button.js)
// and the Night Market demo page (/demo/), so the integration can be tried on the deployed app.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const from = new URL("../../../packages/sdk/dist/whisper-button.js", import.meta.url);
if (!existsSync(from)) throw new Error("Build @whisper/sdk first (pnpm --filter @whisper/sdk build)");
mkdirSync(new URL("../public/demo/", import.meta.url), { recursive: true });
copyFileSync(from, new URL("../public/whisper-button.js", import.meta.url));
copyFileSync(new URL("../../../examples/creator-demo/index.html", import.meta.url), new URL("../public/demo/index.html", import.meta.url));
console.log("copied whisper-button.js and demo/ into public/");
