import {
  createPublicClient,
  decodeErrorResult,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
} from "viem";
import { whisperMailboxAbi } from "./abi.js";
import { sameAddress, toEvmAddress, toQorAddress } from "./address.js";
import { WhisperError, isWhisperError } from "./errors.js";
import { decodeCard, encodeCard, verifyCard, type InboxKeys, type WhisperCard } from "./keys.js";
import { decodeLinkProof, encodeLinkProof, verifyLinkProof, type WhisperLinkProof } from "./link.js";
import { openMessage, sealMessage, type WhisperPayload } from "./message.js";
import { QORECHAIN_TESTNET, type WhisperNetwork } from "./networks.js";
import { fetchChainKemKey, fetchPqcPublicKey } from "./rest.js";

/** Minimal EIP-1193 provider: QoreX (`window.qorex.evm`), or any EVM wallet. */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
}

export interface WhisperClientOptions {
  network?: WhisperNetwork;
  /** Wallet used for writes (publishing keys, sending). Not needed for reading. */
  provider?: Eip1193Provider;
  /** Custom viem public client (defaults to the network's public RPC). */
  publicClient?: PublicClient;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** A published encryption key and how far it can be trusted. */
export interface KeyRecord {
  /** Where the key came from. */
  source: "whisper" | "chain-registry";
  mlkemPublicKey: Uint8Array;
  /** Whisper key version (1, 2, … after rotations). */
  version?: number;
  card?: WhisperCard;
  /** True when the card's ML-DSA-87 signature verified against the account's registered key. */
  cardVerified: boolean;
  blockNumber?: bigint;
}

/** Who a message to `input` actually reaches. */
export interface Recipient {
  /** The address the user typed, as `0x…`. */
  address: Address;
  /** The inbox the message is sent to (equals `address` unless the account linked another inbox). */
  inbox: Address;
  status: "ready" | "no-key";
  via?: "direct" | "link";
  key?: KeyRecord;
  /** The account has an ML-DSA-87 key registered on QoreChain. */
  hasPqcKey: boolean;
  /** Recipient only accepts requests from this sender. */
  requestOnly?: boolean;
  blocked?: boolean;
}

export type MailboxKind = "message" | "request";

/** A message read from chain. `payload` is set when it decrypted; `error` otherwise. */
export interface InboxItem {
  id: bigint;
  kind: MailboxKind;
  from: Address;
  to: Address;
  attached: bigint;
  blockNumber: bigint;
  txHash: Hex;
  payload?: WhisperPayload;
  error?: string;
}

const MESSAGE_EVENT = whisperMailboxAbi.find((x) => x.type === "event" && x.name === "Message")!;
const REQUEST_EVENT = whisperMailboxAbi.find((x) => x.type === "event" && x.name === "Request")!;
const KEY_EVENT = whisperMailboxAbi.find((x) => x.type === "event" && x.name === "KeyPublished")!;
const LINK_EVENT = whisperMailboxAbi.find((x) => x.type === "event" && x.name === "Linked")!;
const INDEX_PAGE = 200n;

const hexToBytes = (hex: Hex): Uint8Array => {
  const s = hex.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/** Groups sorted block numbers into the fewest spans the node's log range limit allows. */
export function blockSpans(blocks: readonly bigint[], maxRange: bigint): { fromBlock: bigint; toBlock: bigint }[] {
  const sorted = [...new Set(blocks)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const spans: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (const b of sorted) {
    const last = spans[spans.length - 1];
    if (last && b - last.fromBlock < maxRange) last.toBlock = b;
    else spans.push({ fromBlock: b, toBlock: b });
  }
  return spans;
}

export class WhisperClient {
  readonly network: WhisperNetwork;
  readonly publicClient: PublicClient;
  private readonly provider?: Eip1193Provider;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly pqcKeyCache = new Map<string, Promise<Uint8Array | undefined>>();

  constructor(options: WhisperClientOptions = {}) {
    this.network = options.network ?? QORECHAIN_TESTNET;
    this.provider = options.provider;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.publicClient =
      options.publicClient ??
      createPublicClient({
        chain: defineChain({
          id: this.network.evmChainId,
          name: this.network.name,
          nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
          rpcUrls: { default: { http: [this.network.evmRpc] } },
        }),
        transport: http(this.network.evmRpc),
      });
  }

  // ---------------------------------------------------------------- reading

  /** The account's registered ML-DSA-87 key (cached), or undefined. */
  pqcPublicKey(account: string): Promise<Uint8Array | undefined> {
    const key = toEvmAddress(account);
    let hit = this.pqcKeyCache.get(key);
    if (!hit) {
      hit = fetchPqcPublicKey(this.network.rest, key, this.fetchImpl);
      hit.catch(() => this.pqcKeyCache.delete(key));
      this.pqcKeyCache.set(key, hit);
    }
    return hit;
  }

  private async indexBlocks(fn: "inboxBlocks" | "outboxBlocks" | "keyBlocks" | "linkBlocks", account: Address, total: bigint, fromIndex = 0n) {
    const blocks: bigint[] = [];
    for (let start = fromIndex; start < total; start += INDEX_PAGE) {
      const page = await this.publicClient.readContract({
        address: this.network.mailbox,
        abi: whisperMailboxAbi,
        functionName: fn,
        args: [account, start, INDEX_PAGE],
      });
      blocks.push(...page.map((b) => BigInt(b)));
    }
    return blocks;
  }

  private async indexLengths(account: Address) {
    const [inbox, outbox, keys, links] = await this.publicClient.readContract({
      address: this.network.mailbox,
      abi: whisperMailboxAbi,
      functionName: "indexLengths",
      args: [account],
    });
    return { inbox, outbox, keys, links };
  }

  private async logsAt(blocks: readonly bigint[], event: (typeof whisperMailboxAbi)[number], args: Record<string, unknown>): Promise<Log[]> {
    const out: Log[] = [];
    for (const span of blockSpans(blocks, this.network.maxLogRange)) {
      const logs = await this.publicClient.getLogs({
        address: this.network.mailbox,
        event: event as never,
        args: args as never,
        fromBlock: span.fromBlock,
        toBlock: span.toBlock,
      });
      out.push(...logs);
    }
    return out;
  }

  /** The account's Whisper key (latest version), checked against its card; falls back to QoreChain's KEM registry. */
  async getKey(account: string): Promise<KeyRecord | undefined> {
    const address = toEvmAddress(account);
    const lengths = await this.indexLengths(address);
    if (lengths.keys > 0n) {
      const blocks = await this.indexBlocks("keyBlocks", address, lengths.keys, lengths.keys - 1n);
      const logs = await this.logsAt(blocks, KEY_EVENT, { account: address });
      const latest = logs[logs.length - 1];
      if (latest) {
        const ev = decodeEventLog({ abi: whisperMailboxAbi, data: latest.data, topics: latest.topics });
        if (ev.eventName === "KeyPublished") {
          const mlkemPublicKey = hexToBytes(ev.args.mlkemPublicKey);
          const onChainHash = await this.publicClient.readContract({ address: this.network.mailbox, abi: whisperMailboxAbi, functionName: "keyHash", args: [address] });
          if (keccak256(mlkemPublicKey) !== onChainHash) throw new WhisperError("KEY_MISMATCH", "Published key does not match the contract's record");
          let card: WhisperCard | undefined;
          let cardVerified = false;
          try {
            card = decodeCard(hexToBytes(ev.args.card));
            const pq = await this.pqcPublicKey(address);
            if (pq) {
              verifyCard({ card, account: address, chainId: this.network.chainId, mlkemPublicKey, pqPublicKey: pq });
              cardVerified = true;
            }
          } catch (error) {
            if (!isWhisperError(error)) throw error;
          }
          return { source: "whisper", mlkemPublicKey, version: Number(ev.args.version), card, cardVerified, blockNumber: latest.blockNumber ?? undefined };
        }
      }
    }
    const chainKey = await fetchChainKemKey(this.network.rest, address, this.fetchImpl);
    if (chainKey) return { source: "chain-registry", mlkemPublicKey: chainKey, cardVerified: true };
    return undefined;
  }

  /** The inbox `account` linked with a valid signed proof (latest wins), or undefined. */
  async getLinkedInbox(account: string): Promise<Address | undefined> {
    const address = toEvmAddress(account);
    const lengths = await this.indexLengths(address);
    if (lengths.links === 0n) return undefined;
    const pq = await this.pqcPublicKey(address);
    if (!pq) return undefined;
    const blocks = await this.indexBlocks("linkBlocks", address, lengths.links);
    const logs = await this.logsAt(blocks, LINK_EVENT, { account: address });
    for (const log of [...logs].reverse()) {
      const ev = decodeEventLog({ abi: whisperMailboxAbi, data: log.data, topics: log.topics });
      if (ev.eventName !== "Linked") continue;
      try {
        verifyLinkProof({ proof: decodeLinkProof(hexToBytes(ev.args.proof)), account: address, inbox: ev.args.inbox, chainId: this.network.chainId, pqPublicKey: pq });
        return getAddressSafe(ev.args.inbox);
      } catch (error) {
        if (!isWhisperError(error)) throw error;
      }
    }
    return undefined;
  }

  /**
   * Everything the composer needs about a recipient: which inbox to use, its key, whether it can be
   * messaged directly by `from`.
   */
  async resolveRecipient(input: string, from?: string): Promise<Recipient> {
    const address = toEvmAddress(input);
    const [directKey, hasPqc] = await Promise.all([this.getKey(address), this.pqcPublicKey(address).then(Boolean)]);
    let inbox = address;
    let key = directKey?.source === "whisper" ? directKey : undefined;
    let via: Recipient["via"] = key ? "direct" : undefined;
    if (!key) {
      const linked = await this.getLinkedInbox(address);
      if (linked) {
        const linkedKey = await this.getKey(linked);
        if (linkedKey) {
          inbox = linked;
          key = linkedKey;
          via = "link";
        }
      }
    }
    if (!key && directKey) {
      key = directKey;
      via = "direct";
    }
    const recipient: Recipient = { address, inbox, status: key ? "ready" : "no-key", via, key, hasPqcKey: hasPqc };
    if (from && key) {
      const sender = toEvmAddress(from);
      const [requestMode, allowed, blocked] = await Promise.all([
        this.publicClient.readContract({ address: this.network.mailbox, abi: whisperMailboxAbi, functionName: "requestMode", args: [inbox] }),
        this.publicClient.readContract({ address: this.network.mailbox, abi: whisperMailboxAbi, functionName: "isAllowed", args: [inbox, sender] }),
        this.publicClient.readContract({ address: this.network.mailbox, abi: whisperMailboxAbi, functionName: "isBlocked", args: [inbox, sender] }),
      ]);
      recipient.requestOnly = requestMode && !allowed && !sameAddress(sender, inbox);
      recipient.blocked = blocked;
    }
    return recipient;
  }

  /**
   * Reads and decrypts an account's mailbox. `direction: "in"` is what the account received,
   * `"out"` what it sent (readable because senders seal a copy to themselves).
   */
  async readMailbox(account: string, keys: InboxKeys, options: { direction?: "in" | "out"; sinceIndex?: bigint } = {}): Promise<InboxItem[]> {
    const address = toEvmAddress(account);
    const direction = options.direction ?? "in";
    const lengths = await this.indexLengths(address);
    const total = direction === "in" ? lengths.inbox : lengths.outbox;
    const blocks = await this.indexBlocks(direction === "in" ? "inboxBlocks" : "outboxBlocks", address, total, options.sinceIndex ?? 0n);
    const filter = direction === "in" ? { to: address } : { from: address };
    const logs = [...(await this.logsAt(blocks, MESSAGE_EVENT, filter)), ...(await this.logsAt(blocks, REQUEST_EVENT, filter))];
    const items: InboxItem[] = [];
    for (const log of logs) {
      const ev = decodeEventLog({ abi: whisperMailboxAbi, data: log.data, topics: log.topics });
      if (ev.eventName !== "Message" && ev.eventName !== "Request") continue;
      const item: InboxItem = {
        id: ev.args.id,
        kind: ev.eventName === "Message" ? "message" : "request",
        from: ev.args.from,
        to: ev.args.to,
        attached: ev.eventName === "Message" ? ev.args.attached : 0n,
        blockNumber: log.blockNumber ?? 0n,
        txHash: log.transactionHash ?? "0x",
      };
      try {
        item.payload = openMessage({ chainId: this.network.chainId, from: item.from, to: item.to, envelope: hexToBytes(ev.args.envelope), keys });
      } catch (error) {
        item.error = isWhisperError(error) ? error.message : "Could not read this message";
      }
      items.push(item);
    }
    return items.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** Current index sizes, for polling new messages cheaply. */
  async mailboxSize(account: string): Promise<{ inbox: bigint; outbox: bigint }> {
    const l = await this.indexLengths(toEvmAddress(account));
    return { inbox: l.inbox, outbox: l.outbox };
  }

  // ---------------------------------------------------------------- writing

  private requireProvider(): Eip1193Provider {
    if (!this.provider) throw new WhisperError("NO_PROVIDER", "Connect a wallet to do this");
    return this.provider;
  }

  private async sendTransaction(from: string, data: Hex, value = 0n): Promise<Hex> {
    const provider = this.requireProvider();
    try {
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [{ from: toEvmAddress(from), to: this.network.mailbox, data, value: toHex(value) }],
      })) as Hex;
      return hash;
    } catch (error) {
      throw explainError(error);
    }
  }

  /** Waits for a transaction and throws a WhisperError if it reverted. */
  async waitFor(hash: Hex) {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new WhisperError("NETWORK", `Transaction ${hash} failed on chain`);
    return receipt;
  }

  /** Publish (or rotate) the inbox key with its signed card. */
  publishKey(from: string, mlkemPublicKey: Uint8Array, card: WhisperCard): Promise<Hex> {
    const data = encodeFunctionData({ abi: whisperMailboxAbi, functionName: "publishKey", args: [toHex(mlkemPublicKey), toHex(encodeCard(card))] });
    return this.sendTransaction(from, data);
  }

  /** Publish a link: `account` (signer of the proof) receives messages in `from`'s inbox. */
  link(from: string, account: string, proof: WhisperLinkProof): Promise<Hex> {
    const data = encodeFunctionData({ abi: whisperMailboxAbi, functionName: "link", args: [toEvmAddress(account), toHex(encodeLinkProof(proof))] });
    return this.sendTransaction(from, data);
  }

  /** Seal and send a message. `attach` adds QOR (wei) for the recipient. */
  async send(args: { from: string; recipient: Recipient; payload: WhisperPayload; senderKeys?: InboxKeys; attach?: bigint }): Promise<Hex> {
    const { recipient } = args;
    if (recipient.status !== "ready" || !recipient.key) throw new WhisperError("NO_KEY", "This address has not set up Whisper yet");
    if (recipient.blocked) throw new WhisperError("SENDER_BLOCKED", "This inbox does not accept messages from you");
    const isRequest = recipient.requestOnly === true || args.payload.type === "request";
    if (isRequest && args.attach) throw new WhisperError("INVALID_PAYLOAD", "QOR cannot be attached to a request");
    const envelope = sealMessage({
      chainId: this.network.chainId,
      from: args.from,
      to: recipient.inbox,
      payload: isRequest ? { ...args.payload, type: "request" } : args.payload,
      recipientKey: recipient.key.mlkemPublicKey,
      senderKey: args.senderKeys?.mlkemPublicKey,
    });
    const data = encodeFunctionData({ abi: whisperMailboxAbi, functionName: isRequest ? "request" : "send", args: [recipient.inbox, toHex(envelope)] });
    return this.sendTransaction(args.from, data, this.network.messageFee + (isRequest ? 0n : args.attach ?? 0n));
  }

  setRequestMode(from: string, enabled: boolean): Promise<Hex> {
    return this.sendTransaction(from, encodeFunctionData({ abi: whisperMailboxAbi, functionName: "setRequestMode", args: [enabled] }));
  }

  setAllowed(from: string, sender: string, allowed: boolean): Promise<Hex> {
    return this.sendTransaction(from, encodeFunctionData({ abi: whisperMailboxAbi, functionName: "setAllowed", args: [toEvmAddress(sender), allowed] }));
  }

  setBlocked(from: string, sender: string, blocked: boolean): Promise<Hex> {
    return this.sendTransaction(from, encodeFunctionData({ abi: whisperMailboxAbi, functionName: "setBlocked", args: [toEvmAddress(sender), blocked] }));
  }

  /** Contact policy of an inbox. */
  async policy(account: string): Promise<{ requestMode: boolean }> {
    const requestMode = await this.publicClient.readContract({ address: this.network.mailbox, abi: whisperMailboxAbi, functionName: "requestMode", args: [toEvmAddress(account)] });
    return { requestMode };
  }

  /** Explorer link for a transaction. */
  txUrl(hash: string): string {
    return `${this.network.explorer}/tx/${hash}`;
  }

  /** `qor1…` form of an address (re-exported for convenience). */
  qor(address: string): string {
    return toQorAddress(address);
  }
}

function getAddressSafe(address: string): Address {
  return toEvmAddress(address);
}

const REVERT_CODES: Record<string, WhisperError["code"]> = {
  RequestOnly: "REQUEST_ONLY",
  SenderBlocked: "SENDER_BLOCKED",
  FeeRequired: "FEE_REQUIRED",
  TransferFailed: "TRANSFER_FAILED",
  InvalidEnvelope: "INVALID_PAYLOAD",
  InvalidRecipient: "INVALID_ADDRESS",
  NoAttachmentOnRequest: "INVALID_PAYLOAD",
  InvalidKeyLength: "INVALID_PAYLOAD",
  ProofTooLarge: "INVALID_PAYLOAD",
};

const REVERT_TEXT: Record<string, string> = {
  RequestOnly: "This inbox only accepts contact requests from new senders.",
  SenderBlocked: "This inbox does not accept messages from you.",
  FeeRequired: "The message fee was missing.",
  TransferFailed: "The recipient could not receive the attached QOR.",
  InvalidEnvelope: "The sealed message has an invalid size.",
  InvalidRecipient: "That recipient address is not valid.",
  NoAttachmentOnRequest: "QOR cannot be attached to a contact request.",
  InvalidKeyLength: "The encryption key has the wrong length.",
  ProofTooLarge: "The signed card is too large.",
};

/** Turns wallet and contract errors into WhisperErrors with a readable message. */
export function explainError(error: unknown): WhisperError {
  if (isWhisperError(error)) return error;
  const e = error as { code?: number; message?: string; data?: unknown; cause?: unknown };
  const message = String(e?.message ?? error);
  if (e?.code === 4001 || /reject|denied|cancel/i.test(message)) return new WhisperError("USER_REJECTED", "You cancelled the request in your wallet", error);
  const data = typeof e?.data === "string" ? (e.data as Hex) : typeof (e?.data as { data?: unknown })?.data === "string" ? ((e.data as { data: Hex }).data) : undefined;
  if (data && data.length >= 10) {
    try {
      const decoded = decodeErrorResult({ abi: whisperMailboxAbi, data });
      const code = REVERT_CODES[decoded.errorName];
      if (code) return new WhisperError(code, REVERT_TEXT[decoded.errorName] ?? decoded.errorName, error);
    } catch {
      /* not one of ours */
    }
  }
  for (const [name, code] of Object.entries(REVERT_CODES)) {
    if (message.includes(name)) return new WhisperError(code, REVERT_TEXT[name] ?? name, error);
  }
  if (/chain|network/i.test(message) && /wrong|unrecognized|switch/i.test(message)) return new WhisperError("WRONG_NETWORK", "Switch your wallet to QoreChain Testnet", error);
  return new WhisperError("NETWORK", message.split("\n")[0] ?? "Something went wrong", error);
}
