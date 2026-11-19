/** Small, failure-tolerant localStorage helpers for non-secret UI state. */
export function getItem(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setItem(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the flow still works in this tab */
  }
}

/** The Ethereum account that holds this browser's Whisper inbox (used when linking a main account). */
export const INBOX_KEY = "whisper-inbox-account";
/** A signed link waiting to be published by the inbox account. */
export const PENDING_LINK_KEY = "whisper-pending-link";
