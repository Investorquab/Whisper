import { base64 } from "@scure/base";
import { toQorAddress } from "./address.js";
import { WhisperError } from "./errors.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (cause) {
    throw new WhisperError("NETWORK", `Could not reach ${new URL(url).host}`, cause);
  }
  if (res.status === 404) return undefined;
  if (!res.ok) throw new WhisperError("NETWORK", `${new URL(url).host} answered ${res.status}`);
  return res.json();
}

function decodeKey(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    const out = new Uint8Array(value.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return base64.decode(value);
}

/** The ML-DSA-87 public key QoreChain has registered for an account, or undefined when there is none. */
export async function fetchPqcPublicKey(rest: string, account: string, fetchImpl: FetchLike = fetch): Promise<Uint8Array | undefined> {
  const body = (await getJson(fetchImpl, `${rest}/qorechain/pqc/v1/account/${encodeURIComponent(toQorAddress(account))}`)) as
    | { found?: boolean; account?: { public_key?: string } }
    | undefined;
  if (!body?.found) return undefined;
  return decodeKey(body.account?.public_key);
}

/** The ML-KEM-1024 key in QoreChain's own KEM registry, or undefined when there is none. */
export async function fetchChainKemKey(rest: string, account: string, fetchImpl: FetchLike = fetch): Promise<Uint8Array | undefined> {
  const body = (await getJson(fetchImpl, `${rest}/qorechain/pqc/v1/kem/${encodeURIComponent(toQorAddress(account))}`)) as
    | { found?: boolean; key?: { algorithm_id?: number; public_key?: string } }
    | undefined;
  if (!body?.found || body.key?.algorithm_id !== 2) return undefined;
  const key = decodeKey(body.key.public_key);
  return key?.length === 1568 ? key : undefined;
}
