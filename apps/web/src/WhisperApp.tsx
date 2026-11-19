import { App } from "./App";
import { SessionProvider } from "./state/session";

/** The wallet-connected app (SDK, post-quantum crypto, viem). Loaded on demand so public pages stay light. */
export default function WhisperApp() {
  return (
    <SessionProvider>
      <App />
    </SessionProvider>
  );
}
