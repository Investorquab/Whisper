import { composeUrl, openCompose, type ComposeLinkOptions } from "./compose.js";

export interface MessageButtonOptions extends ComposeLinkOptions {
  /** Button text. Default "Message the creator". */
  label?: string;
  /** "dark" (default) or "light" button. */
  theme?: "dark" | "light";
}

const ICON =
  '<svg width="18" height="18" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 4.5h20A3.5 3.5 0 0 1 29.5 8v13a3.5 3.5 0 0 1-3.5 3.5H13.2l-5.6 4.6a.9.9 0 0 1-1.5-.7v-3.9H6A3.5 3.5 0 0 1 2.5 21V8A3.5 3.5 0 0 1 6 4.5Z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="10" cy="14.5" r="2.2" fill="currentColor"/><circle cx="16" cy="14.5" r="2.2" fill="currentColor" opacity=".6"/><circle cx="22" cy="14.5" r="2.2" fill="currentColor" opacity=".3"/></svg>';

/**
 * Renders a "Message the creator" button into `target`. Clicking opens Whisper in a popup addressed to
 * `to` (QoreX is available there; it does not inject into iframes). If the browser blocks the popup,
 * the button falls back to a normal link in a new tab. Returns a function that removes the button.
 */
export function mountMessageButton(target: HTMLElement, options: MessageButtonOptions): () => void {
  const href = composeUrl(options);
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("data-whisper-button", "");
  a.innerHTML = `${ICON}<span></span>`;
  (a.querySelector("span") as HTMLSpanElement).textContent = options.label ?? "Message the creator";
  const dark = (options.theme ?? "dark") === "dark";
  Object.assign(a.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minHeight: "44px",
    padding: "0 20px",
    borderRadius: "999px",
    font: "500 15px/1 system-ui, -apple-system, Segoe UI, sans-serif",
    textDecoration: "none",
    cursor: "pointer",
    background: dark ? "#0a0d14" : "#ffffff",
    color: dark ? "#e9edf3" : "#0a0d14",
    border: `1px solid ${dark ? "rgba(233,237,243,.18)" : "rgba(10,13,20,.16)"}`,
  });
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return; // let the browser open a tab
    const win = openCompose(options);
    if (win) event.preventDefault();
  };
  a.addEventListener("click", onClick);
  target.appendChild(a);
  return () => {
    a.removeEventListener("click", onClick);
    a.remove();
  };
}

/**
 * Turns every `[data-whisper-to]` element on the page into a Whisper button. Attributes:
 * `data-whisper-to` (address), `data-whisper-app` (Whisper URL), and optional `data-whisper-label`,
 * `data-whisper-draft`, `data-whisper-source`, `data-whisper-theme`.
 */
export function autoMountMessageButtons(root: ParentNode = document, defaults: Partial<MessageButtonOptions> = {}): number {
  let count = 0;
  root.querySelectorAll<HTMLElement>("[data-whisper-to]").forEach((el) => {
    if (el.dataset.whisperMounted) return;
    const appUrl = el.dataset.whisperApp ?? defaults.appUrl;
    const to = el.dataset.whisperTo;
    if (!appUrl || !to) return;
    try {
      mountMessageButton(el, {
        ...defaults,
        to,
        appUrl,
        label: el.dataset.whisperLabel ?? defaults.label,
        draft: el.dataset.whisperDraft ?? defaults.draft,
        source: el.dataset.whisperSource ?? defaults.source ?? document.title,
        theme: (el.dataset.whisperTheme as "dark" | "light" | undefined) ?? defaults.theme,
      });
      el.dataset.whisperMounted = "true";
      count++;
    } catch {
      /* invalid address: leave the element untouched */
    }
  });
  return count;
}
