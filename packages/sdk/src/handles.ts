import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bech32 } from "@scure/base";
import { WhisperError } from "./errors.js";

/**
 * QoreX @handles. Records come from QoreX's handle registry and carry two signatures:
 * the owner's secp256k1 signature over (handle, address), and the registry's Ed25519 signature over the
 * whole record. Whisper verifies both in the browser, so a proxy or a compromised network cannot swap
 * the address behind a handle. Mirrors the verification in QoreX 0.4.3.
 */

/** QoreX handle registry (it only allows browser requests from the QoreChain dashboard, so apps proxy it). */
export const QOREX_HANDLE_REGISTRY = "https://cadkdpvbuztgqexpwoxkikmxya0vtcvd.lambda-url.us-east-1.on.aws";
/** The registry's Ed25519 public key, as pinned in QoreX 0.4.3. */
export const QOREX_HANDLE_REGISTRY_KEY = "91098dc532956f330a92be5b2d8e6e82db7af896fa9f453c3387f8e28ca28bc3";

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;
const RESERVED = ["qorechain", "qorex", "qcai", "qor", "admin", "support", "official", "wallet", "staking", "faucet", "bridge", "registry"];

export interface HandleRecord {
  handle: string;
  qorAddress: string;
  evmAddress?: string;
  svmAddress?: string;
  externalAddresses?: Record<string, string>;
  pqcRegistered?: boolean;
  createdAt: number;
  ownerPubkeyHex: string;
  sigOwnerHex: string;
  sigRegistryHex: string;
}

/** `@Maria ` → `maria`. */
export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, "");
}

/** True for something that looks like a handle (3–20 of a–z, 0–9, _), with or without @. */
export function isHandle(input: string): boolean {
  const h = normalizeHandle(input);
  return HANDLE_RE.test(h) && !RESERVED.includes(h) && !h.startsWith("qorechain");
}

const enc = new TextEncoder();
const fromHex = (hex: string): Uint8Array => {
  const s = hex.replace(/^0x/, "");
  if (s.length % 2 !== 0 || /[^0-9a-f]/i.test(s)) throw new Error("bad hex");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};

function lengthPrefixed(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + 8 + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    let len = BigInt(p.length);
    for (let i = 7; i >= 0; i--) {
      out[o + i] = Number(len & 0xffn);
      len >>= 8n;
    }
    o += 8;
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function registryDigest(r: HandleRecord): Uint8Array {
  const external = Object.entries(r.externalAddresses ?? {})
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  return sha256(
    lengthPrefixed([
      enc.encode("qorex-handle-registry-v1"),
      enc.encode(normalizeHandle(r.handle)),
      enc.encode(r.qorAddress),
      enc.encode(r.evmAddress ?? ""),
      enc.encode(r.svmAddress ?? ""),
      enc.encode(external),
      enc.encode(r.pqcRegistered ? "1" : "0"),
      enc.encode(String(r.createdAt)),
      enc.encode(r.ownerPubkeyHex),
      enc.encode(r.sigOwnerHex),
    ]),
  );
}

/** Throws INVALID_SIGNATURE unless both the owner's and the registry's signatures verify. */
export function verifyHandleRecord(record: HandleRecord, registryKeyHex = QOREX_HANDLE_REGISTRY_KEY): void {
  const fail = (why: string): never => {
    throw new WhisperError("INVALID_SIGNATURE", `@${record?.handle ?? "?"} failed verification: ${why}`);
  };
  try {
    if (!isHandle(record.handle)) fail("not a valid handle");
    const ownerKey = fromHex(record.ownerPubkeyHex);
    const derived = bech32.encode("qor", bech32.toWords(ripemd160(sha256(ownerKey))));
    if (derived !== record.qorAddress) fail("owner key does not match the address");
    const ownerMsg = sha256(enc.encode(`qorex:handle:v1:${normalizeHandle(record.handle)}:${record.qorAddress}`));
    if (!secp256k1.verify(fromHex(record.sigOwnerHex), ownerMsg, ownerKey, { prehash: false })) fail("owner signature invalid");
    if (!ed25519.verify(fromHex(record.sigRegistryHex), registryDigest(record), fromHex(registryKeyHex))) fail("registry signature invalid");
  } catch (error) {
    if (error instanceof WhisperError) throw error;
    fail("malformed record");
  }
}

/**
 * Resolves `@handle` to its verified record. `baseUrl` is your same-origin proxy of the QoreX handle
 * registry (browsers cannot call the registry directly). Returns undefined when the handle is unclaimed.
 */
export async function resolveHandle(
  handle: string,
  options: { baseUrl: string; fetch?: (input: string) => Promise<Response>; registryKeyHex?: string },
): Promise<HandleRecord | undefined> {
  const h = normalizeHandle(handle);
  if (!isHandle(h)) throw new WhisperError("INVALID_ADDRESS", "Handles are 3–20 characters: a–z, 0–9 and underscore.");
  const f = options.fetch ?? ((u: string) => fetch(u));
  let res: Response;
  try {
    res = await f(`${options.baseUrl.replace(/\/$/, "")}/resolve/${encodeURIComponent(h)}`);
  } catch (cause) {
    throw new WhisperError("NETWORK", "Could not reach the handle registry", cause);
  }
  if (res.status === 404) return undefined;
  if (!res.ok) throw new WhisperError("NETWORK", `Handle registry answered ${res.status}`);
  const body = (await res.json()) as { record?: HandleRecord };
  if (!body.record) return undefined;
  if (normalizeHandle(body.record.handle) !== h) throw new WhisperError("INVALID_SIGNATURE", `The registry answered for @${body.record.handle} when asked for @${h}`);
  verifyHandleRecord(body.record, options.registryKeyHex);
  return body.record;
}

/** The verified @handle of an address, or undefined. */
export async function reverseHandle(
  qorAddress: string,
  options: { baseUrl: string; fetch?: (input: string) => Promise<Response>; registryKeyHex?: string },
): Promise<string | undefined> {
  const f = options.fetch ?? ((u: string) => fetch(u));
  try {
    const res = await f(`${options.baseUrl.replace(/\/$/, "")}/reverse/${encodeURIComponent(qorAddress)}`);
    if (!res.ok) return undefined;
    const body = (await res.json()) as { record?: HandleRecord };
    if (!body.record || body.record.qorAddress !== qorAddress) return undefined;
    verifyHandleRecord(body.record, options.registryKeyHex);
    return body.record.handle;
  } catch {
    return undefined;
  }
}
