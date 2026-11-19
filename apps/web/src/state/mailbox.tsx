import { reverseHandle, toQorAddress, type InboxItem } from "@whisper/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HANDLE_PROXY } from "../hooks/useRecipient";
import { buildConversations, type Conversation } from "../lib/conversations";
import { getItem, setItem } from "../lib/storage";
import { useSession } from "./session";

const POLL_MS = 15_000;

export interface Mailbox {
  conversations: Conversation[];
  loading: boolean;
  error?: string;
  /** Last successful sync. */
  syncedAt?: number;
  reload(): Promise<void>;
  markRead(peer: string): void;
  /** Verified QoreX @handle for an address (undefined while unknown, null when none). */
  handleOf(address: string): string | null | undefined;
}

const MailboxContext = createContext<Mailbox | null>(null);

export function MailboxProvider({ children }: { children: ReactNode }) {
  const s = useSession();
  const me = s.account?.evmAddress;
  const [received, setReceived] = useState<InboxItem[]>([]);
  const [sent, setSent] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [syncedAt, setSyncedAt] = useState<number>();
  const [lastRead, setLastRead] = useState<Record<string, string>>({});
  const [handles, setHandles] = useState<Record<string, string | null>>({});
  const size = useRef<{ inbox: bigint; outbox: bigint }>(undefined);
  const readKey = me ? `whisper-read-${me.toLowerCase()}` : undefined;

  useEffect(() => {
    if (!readKey) return;
    try {
      setLastRead(JSON.parse(getItem(readKey) ?? "{}"));
    } catch {
      setLastRead({});
    }
  }, [readKey]);

  const reload = useCallback(async () => {
    if (!me || !s.keys) return;
    try {
      const [inbox, outbox, sizes] = await Promise.all([
        s.client.readMailbox(me, s.keys, { direction: "in" }),
        s.client.readMailbox(me, s.keys, { direction: "out" }),
        s.client.mailboxSize(me),
      ]);
      size.current = sizes;
      setReceived(inbox);
      setSent(outbox);
      setError(undefined);
      setSyncedAt(Date.now());
    } catch (e) {
      setError((e as Error).message?.split("\n")[0] ?? "Could not read your inbox from QoreChain.");
    } finally {
      setLoading(false);
    }
  }, [me, s.keys, s.client]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Cheap polling: one contract read of the index sizes; full reload only when they change.
  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const now = await s.client.mailboxSize(me);
        if (!size.current || now.inbox !== size.current.inbox || now.outbox !== size.current.outbox) await reload();
      } catch {
        /* offline: try again next tick */
      }
    };
    const t = setInterval(tick, POLL_MS);
    return () => clearInterval(t);
  }, [me, s.client, reload]);

  const conversations = useMemo(() => (me ? buildConversations(me, received, sent, lastRead) : []), [me, received, sent, lastRead]);

  // Verified @handles for everyone we talk to (records are signature-checked in the SDK).
  useEffect(() => {
    const missing = conversations.map((c) => c.peer).filter((p) => !(p in handles));
    if (!missing.length) return;
    let live = true;
    (async () => {
      const found: Record<string, string | null> = {};
      await Promise.all(
        missing.map(async (p) => {
          found[p] = (await reverseHandle(toQorAddress(p), { baseUrl: HANDLE_PROXY })) ?? null;
        }),
      );
      if (live) setHandles((h) => ({ ...h, ...found }));
    })();
    return () => {
      live = false;
    };
  }, [conversations, handles]);

  const markRead = useCallback(
    (peer: string) => {
      const conv = conversations.find((c) => c.peer === peer.toLowerCase());
      if (!conv || !readKey) return;
      const next = { ...lastRead, [conv.peer]: conv.lastId.toString() };
      if (lastRead[conv.peer] === next[conv.peer]) return;
      setLastRead(next);
      setItem(readKey, JSON.stringify(next));
    },
    [conversations, lastRead, readKey],
  );

  const value: Mailbox = {
    conversations,
    loading,
    error,
    syncedAt,
    reload,
    markRead,
    handleOf: (address) => handles[address.toLowerCase()],
  };
  return <MailboxContext.Provider value={value}>{children}</MailboxContext.Provider>;
}

export function useMailbox(): Mailbox {
  const m = useContext(MailboxContext);
  if (!m) throw new Error("useMailbox outside MailboxProvider");
  return m;
}
