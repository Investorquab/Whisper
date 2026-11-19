import { isHandle, isWhisperAddress, resolveHandle, reverseHandle, toQorAddress, type HandleRecord, type Recipient } from "@whisper/sdk";
import { useEffect, useState } from "react";
import { useSession } from "../state/session";

/** Same-origin path to the QoreX handle registry (Vite proxy locally, Vercel rewrite in production). */
export const HANDLE_PROXY = "/api/handles";

export type RecipientState =
  | { status: "empty" }
  | { status: "invalid"; message: string }
  | { status: "loading" }
  | { status: "unknown-handle"; handle: string }
  | { status: "error"; message: string }
  | { status: "resolved"; recipient: Recipient; handle?: string; record?: HandleRecord; isSelf: boolean };

/** Resolves typed input (0x…, qor1… or @handle) to a Whisper recipient, debounced. */
export function useRecipient(input: string): RecipientState {
  const s = useSession();
  const [state, setState] = useState<RecipientState>({ status: "empty" });
  const from = s.account?.evmAddress;

  useEffect(() => {
    const value = input.trim();
    if (!value) {
      setState({ status: "empty" });
      return;
    }
    const looksLikeHandle = value.startsWith("@") || (!value.startsWith("0x") && !value.toLowerCase().startsWith("qor1"));
    if (looksLikeHandle && !isHandle(value)) {
      setState({ status: "invalid", message: "Enter a 0x… or qor1… address, or a QoreX @handle (3–20 letters, numbers or _)." });
      return;
    }
    if (!looksLikeHandle && !isWhisperAddress(value)) {
      const badChars = value.startsWith("0x") ? /[^0-9a-fA-F]/.test(value.slice(2)) : /[^02-9ac-hj-np-z]/.test(value.toLowerCase().slice(4));
      // Still typing a 0x… or qor1… address (both 42 characters) with valid characters: say nothing yet.
      setState(value.length < 42 && !badChars ? { status: "empty" } : { status: "invalid", message: "That address is not valid. Check it was copied in full." });
      return;
    }
    let live = true;
    setState({ status: "loading" });
    const t = setTimeout(async () => {
      try {
        let address = value;
        let handle: string | undefined;
        let record: HandleRecord | undefined;
        if (looksLikeHandle) {
          record = await resolveHandle(value, { baseUrl: HANDLE_PROXY });
          if (!live) return;
          if (!record) {
            setState({ status: "unknown-handle", handle: value.replace(/^@/, "") });
            return;
          }
          address = record.qorAddress;
          handle = record.handle;
        } else {
          handle = await reverseHandle(toQorAddress(value), { baseUrl: HANDLE_PROXY });
        }
        const recipient = await s.client.resolveRecipient(address, from);
        if (!live) return;
        const isSelf = Boolean(from && recipient.inbox.toLowerCase() === from.toLowerCase());
        setState({ status: "resolved", recipient, handle, record, isSelf });
      } catch (error) {
        if (!live) return;
        setState({ status: "error", message: (error as Error).message ?? "Could not look up this recipient." });
      }
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [input, from, s.client]);

  return state;
}
