import { generateSealKeys, sealKeysFromSeed, type SealKeyPair } from "@qorechain/qoreseal";
import { verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import { sha256, toHex } from "viem";
import { sameAddress, toEvmAddress, toQorAddress } from "./address.js";
import { WhisperError } from "./errors.js";

export type { SealKeyPair } from "@qorechain/qoreseal";
export type { MessageSignature } from "@qorechain/qoresign";

/** A Whisper inbox's encryption keys. Only `seed` needs to be stored; everything else derives from it. */
export type InboxKeys = SealKeyPair;

/** Fresh ML-KEM-1024 (+ X25519) keys from a random seed. */
export function generateInboxKeys(): InboxKeys {
  return generateSealKeys();
}

/** Rebuild inbox keys from their 32-byte seed. */
export function inboxKeysFromSeed(seed: Uint8Array): InboxKeys {
  if (seed.length !== 32) throw new WhisperError("INVALID_PAYLOAD", "An inbox seed is 32 bytes");
  return sealKeysFromSeed(seed);
}

/** SHA-256 of an ML-KEM public key, as 0x-hex. Cards and links name keys by this fingerprint. */
export function keyFingerprint(mlkemPublicKey: Uint8Array): `0x${string}` {
  return sha256(mlkemPublicKey);
}

/** Fields a Whisper card states. */
export interface CardFields {
  /** The account publishing the key (any encoding). */
  account: string;
  /** QoreChain native chain id. */
  chainId: string;
  /** The ML-KEM-1024 key being bound to the account. */
  mlkemPublicKey: Uint8Array;
  /** When the card was made (ISO 8601). */
  issuedAt: string;
}

/**
 * The text a user signs to bind an encryption key to their account. It is shown in full in QoreX's
 * approval window, so it is written to be read by people.
 */
export function cardStatement(fields: CardFields): string {
  return [
    "Whisper card v1",
    "I use this encryption key to receive Whisper messages.",
    `account: ${toQorAddress(fields.account)}`,
    `evm: ${toEvmAddress(fields.account)}`,
    `chain: ${fields.chainId}`,
    `key: ${keyFingerprint(fields.mlkemPublicKey)}`,
    `issued: ${fields.issuedAt}`,
  ].join("\n");
}

/** A card as stored on chain: the statement and its hybrid (secp256k1 + ML-DSA-87) signature. */
export interface WhisperCard {
  v: 1;
  statement: string;
  signature: MessageSignature;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeCard(card: WhisperCard): Uint8Array {
  return encoder.encode(JSON.stringify(card));
}

export function decodeCard(bytes: Uint8Array): WhisperCard {
  try {
    const card = JSON.parse(decoder.decode(bytes)) as WhisperCard;
    if (card.v !== 1 || typeof card.statement !== "string" || typeof card.signature !== "object" || card.signature === null) {
      throw new Error("bad shape");
    }
    return card;
  } catch (cause) {
    throw new WhisperError("INVALID_CARD", "Card is not a Whisper card", cause);
  }
}

/** Reads `key: value` lines from a statement. */
export function statementFields(statement: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of statement.split("\n")) {
    const i = line.indexOf(": ");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 2);
  }
  return out;
}

/**
 * Checks that a card binds `mlkemPublicKey` to `account` on `chainId` and that its signature verifies
 * against the account's ML-DSA-87 key registered on QoreChain (`pqPublicKey`). Throws `INVALID_CARD`
 * or `INVALID_SIGNATURE` otherwise.
 */
export function verifyCard(args: {
  card: WhisperCard;
  account: string;
  chainId: string;
  mlkemPublicKey: Uint8Array;
  pqPublicKey: Uint8Array;
}): void {
  const f = statementFields(args.card.statement);
  if (!args.card.statement.startsWith("Whisper card v1\n")) throw new WhisperError("INVALID_CARD", "Not a Whisper card v1");
  if (!f.account || !sameAddress(f.account, args.account)) throw new WhisperError("INVALID_CARD", "Card names a different account");
  if (f.chain !== args.chainId) throw new WhisperError("INVALID_CARD", "Card is for a different chain");
  if (f.key !== keyFingerprint(args.mlkemPublicKey)) throw new WhisperError("INVALID_CARD", "Card names a different key");
  try {
    verifyMessage({
      chainId: args.chainId,
      signer: toQorAddress(args.account),
      data: args.card.statement,
      signature: args.card.signature,
      pqPublicKey: args.pqPublicKey,
      requirePq: true,
    });
  } catch (cause) {
    throw new WhisperError("INVALID_SIGNATURE", "Card signature does not verify against the account's ML-DSA-87 key", cause);
  }
}

/** 0x-hex of bytes (for contract calls). */
export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return toHex(bytes);
}
