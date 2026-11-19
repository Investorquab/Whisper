import { toEvmAddress } from "./address.js";

export interface ComposeLinkOptions {
  /** Recipient (`0x…` or `qor1…`). */
  to: string;
  /** Optional draft text placed in the composer. The sender still reviews and sends it. */
  draft?: string;
  /** Where your users come from, shown to the sender ("from Heirloom"). */
  source?: string;
  /** The Whisper app to open, for example your deployment's origin. */
  appUrl: string;
}

/** A link that opens Whisper with the composer addressed to `to`. */
export function composeUrl(options: ComposeLinkOptions): string {
  const url = new URL(`/to/${toEvmAddress(options.to)}`, options.appUrl);
  if (options.draft) url.searchParams.set("draft", options.draft.slice(0, 500));
  if (options.source) url.searchParams.set("from", options.source.slice(0, 60));
  return url.toString();
}

/**
 * Opens Whisper in a popup addressed to `to`. Use this from a click handler. QoreX does not inject
 * into iframes, so Whisper always opens as its own window where the wallet is available.
 * Returns the window, or null when the browser blocked the popup (fall back to a normal link).
 */
export function openCompose(options: ComposeLinkOptions & { width?: number; height?: number }): Window | null {
  const w = options.width ?? 440;
  const h = options.height ?? 720;
  const left = Math.max(0, Math.round((window.screen.width - w) / 2));
  const top = Math.max(0, Math.round((window.screen.height - h) / 2));
  return window.open(composeUrl(options), "whisper-compose", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
}
