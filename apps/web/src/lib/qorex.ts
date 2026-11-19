/**
 * QoreX adapter. Facts this relies on were verified against QoreX 0.4.3 (Chrome Web Store build):
 * - `window.qorex.native.getKey()` reports `algo: "ethsecp256k1"` for an Ethereum account (coin 60)
 *   and `"secp256k1"` for a QoreChain main account (coin 118). Only Ethereum accounts can use the EVM lane.
 * - `eth_sendTransaction` works for Ethereum accounts: QoreX opens an ML-DSA-87 signed authorisation
 *   window scoped to the contract, then sends.
 * - `signArbitrary` returns a hybrid secp256k1 + ML-DSA-87 signature over readable text.
 * - QoreX injects into the top page only (not iframes) and emits no account-change events.
 */
import type { MessageSignature } from "@whisper/sdk";

export const TESTNET_CHAIN_ID = "qorechain-diana";
export const TESTNET_EVM_CHAIN_HEX = "0x2648";

interface QorexKey {
  algo: string;
  bech32Address: string;
}

interface QorexNative {
  capabilities: readonly string[];
  enable(chainId: string): Promise<unknown>;
  getKey(chainId: string): Promise<QorexKey>;
  signArbitrary(chainId: string, signer: string, data: string): Promise<MessageSignature & Record<string, unknown>>;
  listAccounts?(): Promise<{ accounts: { index: number; label: string; address: string }[]; activeIndex: number }>;
}

interface QorexEvm {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

export interface Qorex {
  native: QorexNative;
  evm: QorexEvm;
}

declare global {
  interface Window {
    qorex?: Qorex;
  }
}

export function getQorex(): Qorex | undefined {
  const q = typeof window === "undefined" ? undefined : window.qorex;
  return q?.native && q?.evm ? q : undefined;
}

/** QoreX can take a moment to inject after load. */
export async function waitForQorex(timeoutMs = 1500): Promise<Qorex | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const q = getQorex();
    if (q) return q;
    await new Promise((r) => setTimeout(r, 100));
  }
  return getQorex();
}

export type AccountKind = "ethereum" | "main";

export interface WalletAccount {
  /** `qor1…` address of the active QoreX account. */
  qorAddress: string;
  /** `0x…` the EVM provider reports for this site. */
  evmAddress: string;
  kind: AccountKind;
  /** EVM chain the wallet is on. */
  evmChainHex: string;
  onTestnet: boolean;
  capabilities: readonly string[];
}

export class WalletError extends Error {
  constructor(
    readonly code: "NOT_INSTALLED" | "REJECTED" | "WRONG_NETWORK" | "UNSUPPORTED" | "FAILED",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

function asWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error;
  const message = String((error as { message?: unknown })?.message ?? error);
  if (/reject|denied|cancel/i.test(message)) return new WalletError("REJECTED", "You cancelled the request in QoreX.");
  if (/unsupported chain|does not match the active network|wallet is on/i.test(message)) {
    return new WalletError("WRONG_NETWORK", "QoreX is on a different network. Switch QoreX to testnet.");
  }
  return new WalletError("FAILED", message.replace(/^QoreX:\s*/, ""));
}

/** Reads the active account without prompting (works once the site is connected). */
export async function readAccount(q: Qorex): Promise<WalletAccount | undefined> {
  try {
    const [accounts, chainHex] = await Promise.all([q.evm.request({ method: "eth_accounts" }) as Promise<string[]>, q.evm.request({ method: "eth_chainId" }) as Promise<string>]);
    if (!accounts?.length) return undefined;
    const key = await q.native.getKey(TESTNET_CHAIN_ID);
    return toAccount(q, key, accounts[0]!, chainHex);
  } catch {
    return undefined;
  }
}

/** Asks the user to connect this site in QoreX. */
export async function connect(q: Qorex): Promise<WalletAccount> {
  try {
    const chainHex = (await q.evm.request({ method: "eth_chainId" })) as string;
    if (chainHex !== TESTNET_EVM_CHAIN_HEX) {
      throw new WalletError("WRONG_NETWORK", "QoreX is on mainnet. Whisper runs on QoreChain testnet for the Build Before Q-Day fest.");
    }
    await q.native.enable(TESTNET_CHAIN_ID);
    const accounts = (await q.evm.request({ method: "eth_requestAccounts" })) as string[];
    const key = await q.native.getKey(TESTNET_CHAIN_ID);
    if (!accounts?.length) throw new WalletError("FAILED", "QoreX did not share an account.");
    return toAccount(q, key, accounts[0]!, chainHex);
  } catch (error) {
    throw asWalletError(error);
  }
}

function toAccount(q: Qorex, key: QorexKey, evmAddress: string, chainHex: string): WalletAccount {
  return {
    qorAddress: key.bech32Address,
    evmAddress,
    kind: key.algo === "ethsecp256k1" ? "ethereum" : "main",
    evmChainHex: chainHex,
    onTestnet: chainHex === TESTNET_EVM_CHAIN_HEX,
    capabilities: q.native.capabilities ?? [],
  };
}

/** Hybrid (secp256k1 + ML-DSA-87) signature over readable text, approved by the user in QoreX. */
export async function signStatement(q: Qorex, signer: string, statement: string): Promise<MessageSignature> {
  if (!q.native.capabilities?.includes("signArbitrary")) {
    throw new WalletError("UNSUPPORTED", "Update QoreX: this version cannot sign messages yet.");
  }
  try {
    const r = await q.native.signArbitrary(TESTNET_CHAIN_ID, signer, statement);
    if (r.signatureType !== "ml-dsa-87-hybrid" || !r.pq) throw new WalletError("FAILED", "QoreX returned a signature without the ML-DSA-87 layer.");
    return { signatureType: r.signatureType, classical: r.classical, pq: r.pq };
  } catch (error) {
    throw asWalletError(error);
  }
}

export const QOREX_INSTALL_URL = "https://chromewebstore.google.com/detail/qorex/cflpnggbnnifibblifgbeobogdpfjpcg";
export const FAUCET_URL = "https://dashboard.qorechain.io/faucet";
