/**
 * Drop-in script for sites without a bundler:
 *   <span data-whisper-to="0x…" data-whisper-app="https://whisper-qorex.vercel.app"></span>
 *   <script src="https://whisper-qorex.vercel.app/whisper-button.js" defer></script>
 * The script finds every [data-whisper-to] element and renders a "Message the creator" button.
 */
import { autoMountMessageButtons } from "./button.js";

function scriptOrigin(): string | undefined {
  const s = document.currentScript as HTMLScriptElement | null;
  try {
    return s?.src ? new URL(s.src).origin : undefined;
  } catch {
    return undefined;
  }
}

const origin = scriptOrigin();
const run = () => autoMountMessageButtons(document, origin ? { appUrl: origin } : {});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
else run();

export { autoMountMessageButtons, mountMessageButton } from "./button.js";
