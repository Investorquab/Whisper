import { QORECHAIN_TESTNET, WhisperClient, inboxKeysFromSeed, keyFingerprint, type InboxKeys, type KeyRecord } from "@whisper/sdk";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { connect as connectWallet, readAccount, waitForQorex, type Qorex, type WalletAccount } from "../lib/qorex";
import { loadVault, openVault, type VaultRecord } from "../lib/vault";

export type WalletStatus = "detecting" | "missing" | "disconnected" | "connected";

export interface Session {
  status: WalletStatus;
  qorex?: Qorex;
  account?: WalletAccount;
  /** Reader/writer for the mailbox; writes go through QoreX. */
  client: WhisperClient;
  /** The account's key as published on chain (undefined when none, null while loading). */
  chainKey: KeyRecord | undefined | null;
  vault: VaultRecord | undefined | null;
  /** Inbox keys, present once unlocked this session. */
  keys?: InboxKeys;
  /** True when the unlocked keys match the key on chain. */
  keysMatchChain: boolean;
  connect(): Promise<void>;
  refresh(): Promise<void>;
  unlock(password: string): Promise<void>;
  setKeys(keys: InboxKeys | undefined): void;
  lock(): void;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children, client: injected }: { children: ReactNode; client?: WhisperClient }) {
  const [status, setStatus] = useState<WalletStatus>("detecting");
  const [qorex, setQorex] = useState<Qorex>();
  const [account, setAccount] = useState<WalletAccount>();
  const [chainKey, setChainKey] = useState<KeyRecord | undefined | null>(null);
  const [vault, setVault] = useState<VaultRecord | undefined | null>(null);
  const [keys, setKeys] = useState<InboxKeys>();
  const accountRef = useRef<string | undefined>(undefined);

  // QoreChain's REST API is reached through a same-origin rewrite (it sends no CORS headers).
  const client = useMemo(
    () => injected ?? new WhisperClient({ provider: qorex?.evm, network: { ...QORECHAIN_TESTNET, rest: `${window.location.origin}/api/qore` } }),
    [injected, qorex],
  );

  const loadAccountState = useCallback(
    async (acct: WalletAccount | undefined) => {
      if (acct?.evmAddress.toLowerCase() !== accountRef.current) {
        accountRef.current = acct?.evmAddress.toLowerCase();
        setKeys(undefined);
        setChainKey(null);
        setVault(null);
      }
      setAccount(acct);
      if (!acct || acct.kind !== "ethereum" || !acct.onTestnet) return;
      const [key, stored] = await Promise.all([client.getKey(acct.evmAddress).catch(() => undefined), loadVault(acct.evmAddress).catch(() => undefined)]);
      if (accountRef.current !== acct.evmAddress.toLowerCase()) return;
      setChainKey(key);
      setVault(stored);
    },
    [client],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = await waitForQorex();
      if (cancelled) return;
      if (!q) {
        setStatus("missing");
        return;
      }
      setQorex(q);
      const acct = await readAccount(q);
      if (cancelled) return;
      setStatus(acct ? "connected" : "disconnected");
      await loadAccountState(acct);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAccountState]);

  const refresh = useCallback(async () => {
    if (!qorex) return;
    const acct = await readAccount(qorex);
    setStatus(acct ? "connected" : "disconnected");
    await loadAccountState(acct);
  }, [qorex, loadAccountState]);

  // QoreX emits no account-change events: re-read when the user comes back to the tab.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    if (!qorex) throw new Error("QoreX is not installed");
    const acct = await connectWallet(qorex);
    setStatus("connected");
    await loadAccountState(acct);
  }, [qorex, loadAccountState]);

  const unlock = useCallback(
    async (password: string) => {
      if (!vault) throw new Error("No inbox key is stored in this browser");
      const seed = await openVault(vault, password);
      setKeys(inboxKeysFromSeed(seed));
    },
    [vault],
  );

  const keysMatchChain = Boolean(keys && chainKey && keyFingerprint(keys.mlkemPublicKey) === keyFingerprint(chainKey.mlkemPublicKey));

  const value: Session = {
    status,
    qorex,
    account,
    client,
    chainKey,
    vault,
    keys,
    keysMatchChain,
    connect,
    refresh,
    unlock,
    setKeys,
    lock: () => setKeys(undefined),
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** Re-loads vault and chain key after setup writes them. */
export function useReloadAccount() {
  const s = useSession();
  return s.refresh;
}
