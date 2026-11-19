import { bech32 } from "@scure/base";
import { getAddress, isAddress, type Address } from "viem";
import { WhisperError } from "./errors.js";

/** QoreChain account prefix. `qor1…` and `0x…` are two encodings of the same 20 bytes. */
export const QOR_PREFIX = "qor";

/** Accepts `0x…` or `qor1…` and returns the checksummed `0x` form. */
export function toEvmAddress(input: string): Address {
  const value = input.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    if (!isAddress(value, { strict: false })) throw new WhisperError("INVALID_ADDRESS", `Not a valid address: ${value}`);
    return getAddress(value);
  }
  if (value.toLowerCase().startsWith(`${QOR_PREFIX}1`)) {
    try {
      const decoded = bech32.decode(value.toLowerCase() as `${string}1${string}`);
      if (decoded.prefix !== QOR_PREFIX) throw new Error("wrong prefix");
      const bytes = bech32.fromWords(decoded.words);
      if (bytes.length !== 20) throw new Error("wrong length");
      return getAddress(`0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`);
    } catch (cause) {
      throw new WhisperError("INVALID_ADDRESS", `Not a valid QoreChain address: ${value}`, cause);
    }
  }
  throw new WhisperError("INVALID_ADDRESS", `Expected a 0x… or qor1… address, got: ${value}`);
}

/** The `qor1…` encoding of an address. */
export function toQorAddress(input: string): string {
  const hex = toEvmAddress(input).slice(2);
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bech32.encode(QOR_PREFIX, bech32.toWords(bytes));
}

/** True for a valid `0x…` or `qor1…` address. */
export function isWhisperAddress(input: string): boolean {
  try {
    toEvmAddress(input);
    return true;
  } catch {
    return false;
  }
}

/** Case-insensitive address equality across both encodings. */
export function sameAddress(a: string, b: string): boolean {
  try {
    return toEvmAddress(a) === toEvmAddress(b);
  } catch {
    return false;
  }
}

/** Short display form: `0x1234…abcd` or `qor1ab…wxyz`. */
export function shortAddress(input: string, head = 6, tail = 4): string {
  return input.length <= head + tail + 1 ? input : `${input.slice(0, head)}…${input.slice(-tail)}`;
}
