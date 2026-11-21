import { open, seal } from "@qorechain/qoreseal";
import { verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import { sameAddress, toEvmAddress, toQorAddress } from "./address.js";
import { WhisperError } from "./errors.js";
import type { InboxKeys } from "./keys.js";
import { statementFields } from "./keys.js";

/** QoreSeal purpose string: envelopes sealed for Whisper cannot be opened as anything else. */
export const WHISPER_PURPOSE = "whisper/v1";
/** Longest message body, in characters. */
export const MAX_BODY_LENGTH = 4000;
/** Payloads are padded to a multiple of this many bytes so ciphertext size reveals little. */
export const PAD_BLOCK = 256;

export type WhisperMessageType = "text" | "reaction" | "request";

/** A signed message: the readable statement the sender approved in QoreX and its hybrid signature. */
export interface SignedProof {
  statement: string;
  signature: MessageSignature;
}

/** What is inside a sealed Whisper envelope. */
export interface WhisperPayload {
  v: 1;
  type: WhisperMessageType;
  /** Message text (for a reaction: the emoji). */
  body: string;
  /** Unix milliseconds when the sender wrote it. */
  ts: number;
  /** Id of the message this replies to or reacts to. */
  replyTo?: string;
  /** Present when the sender chose "Sign this message". */
  signed?: SignedProof;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function validatePayload(payload: WhisperPayload): void {
  if (payload.v !== 1) throw new WhisperError("INVALID_PAYLOAD", "Unsupported payload version");
  if (!["text", "reaction", "request"].includes(payload.type)) throw new WhisperError("INVALID_PAYLOAD", "Unknown message type");
  if (typeof payload.body !== "string") throw new WhisperError("INVALID_PAYLOAD", "Message body must be text");
  if ([...payload.body].length > MAX_BODY_LENGTH) throw new WhisperError("MESSAGE_TOO_LONG", `Messages are at most ${MAX_BODY_LENGTH} characters`);
  if (payload.type === "reaction" && (!payload.replyTo || [...payload.body].length > 8)) {
    throw new WhisperError("INVALID_PAYLOAD", "A reaction is a short emoji pointing at a message");
  }
  if (!Number.isFinite(payload.ts)) throw new WhisperError("INVALID_PAYLOAD", "Missing timestamp");
}

/** UTF-8 JSON, padded with spaces to a multiple of PAD_BLOCK bytes. */
export function encodePayload(payload: WhisperPayload): Uint8Array {
  validatePayload(payload);
  const json = encoder.encode(JSON.stringify(payload));
  const padded = Math.ceil((json.length + 1) / PAD_BLOCK) * PAD_BLOCK;
  const out = new Uint8Array(padded).fill(0x20);
  out.set(json);
  return out;
}

export function decodePayload(bytes: Uint8Array): WhisperPayload {
  let payload: WhisperPayload;
  try {
    payload = JSON.parse(decoder.decode(bytes).trimEnd()) as WhisperPayload;
  } catch (cause) {
    throw new WhisperError("INVALID_PAYLOAD", "Decrypted payload is not a Whisper message", cause);
  }
  validatePayload(payload);
  return payload;
}

/**
 * Additional authenticated data: binds an envelope to its sender and recipient. A ciphertext copied
 * into someone else's transaction, or re-sent to another inbox, fails to open.
 */
export function messageAad(from: string, to: string): Uint8Array {
  return encoder.encode(`${WHISPER_PURPOSE}|${toEvmAddress(from).toLowerCase()}|${toEvmAddress(to).toLowerCase()}`);
}

/**
 * Seal a payload in the browser with ML-KEM-1024 to the recipient, and to the sender too so the sender
 * can read their own sent messages. Uses QoreSeal's `mlkem` mode: the key comes from the recipient's
 * published key alone.
 */
export function sealMessage(args: {
  chainId: string;
  from: string;
  to: string;
  payload: WhisperPayload;
  recipientKey: Uint8Array;
  senderKey?: Uint8Array;
}): Uint8Array {
  const recipients = [{ mlkemPublicKey: args.recipientKey }];
  if (args.senderKey && !sameAddress(args.from, args.to)) recipients.push({ mlkemPublicKey: args.senderKey });
  return seal({
    chainId: args.chainId,
    purpose: WHISPER_PURPOSE,
    mode: "mlkem",
    recipients,
    plaintext: encodePayload(args.payload),
    aad: messageAad(args.from, args.to),
  });
}

/** Open an envelope with an inbox's keys. Throws `DECRYPT_FAILED` when it was not sealed to these keys. */
export function openMessage(args: { chainId: string; from: string; to: string; envelope: Uint8Array; keys: InboxKeys }): WhisperPayload {
  let plaintext: Uint8Array;
  try {
    plaintext = open({
      chainId: args.chainId,
      purpose: WHISPER_PURPOSE,
      envelope: args.envelope,
      keys: args.keys,
      aad: messageAad(args.from, args.to),
    });
  } catch (cause) {
    throw new WhisperError("DECRYPT_FAILED", "This message was not sealed to this inbox, or it was altered", cause);
  }
  return decodePayload(plaintext);
}

/** The readable statement a sender signs for a signed message. */
export function signedStatement(args: { chainId: string; from: string; to: string; ts: number; body: string }): string {
  return [
    "Whisper signed message v1",
    `from: ${toQorAddress(args.from)}`,
    `to: ${toQorAddress(args.to)}`,
    `chain: ${args.chainId}`,
    `time: ${new Date(args.ts).toISOString()}`,
    "",
    args.body,
  ].join("\n");
}

/**
 * Verifies a signed message: the statement must match the message (sender, recipient, chain, time,
 * body) and its hybrid signature must verify against the sender's registered ML-DSA-87 key.
 */
export function verifySignedMessage(args: {
  chainId: string;
  from: string;
  to: string;
  payload: WhisperPayload;
  pqPublicKey: Uint8Array;
}): void {
  const proof = args.payload.signed;
  if (!proof) throw new WhisperError("INVALID_SIGNATURE", "This message is not signed");
  const expected = signedStatement({ chainId: args.chainId, from: args.from, to: args.to, ts: args.payload.ts, body: args.payload.body });
  if (proof.statement !== expected) throw new WhisperError("INVALID_SIGNATURE", "The signed text does not match the message");
  verifyStatementSignature({ chainId: args.chainId, signer: args.from, statement: proof.statement, signature: proof.signature, pqPublicKey: args.pqPublicKey });
}

/** Verify any Whisper statement (card, link or signed message) against its signer's registered key. */
export function verifyStatementSignature(args: {
  chainId: string;
  signer: string;
  statement: string;
  signature: MessageSignature;
  pqPublicKey: Uint8Array;
}): void {
  try {
    verifyMessage({
      chainId: args.chainId,
      signer: toQorAddress(args.signer),
      data: args.statement,
      signature: args.signature,
      pqPublicKey: args.pqPublicKey,
      requirePq: true,
    });
  } catch (cause) {
    throw new WhisperError("INVALID_SIGNATURE", "Signature does not verify against the signer's ML-DSA-87 key", cause);
  }
}

/** A portable proof that someone can check on the "Check a message" page without the inbox keys. */
export interface MessageProofBundle {
  v: 1;
  chainId: string;
  from: string;
  statement: string;
  signature: MessageSignature;
  txHash?: string;
}

/** Throws unless a proof bundle's statement was signed by the `from` it names. */
export function verifyProofBundle(bundle: MessageProofBundle, pqPublicKey: Uint8Array): { from: string; to?: string; time?: string; body: string } {
  if (!bundle.statement.startsWith("Whisper signed message v1\n")) throw new WhisperError("INVALID_SIGNATURE", "Not a Whisper signed message");
  // Header fields come only from the header (before the first blank line). The body is free text the signer
  // wrote, and a "to: …" or "time: …" line in it must not change what the Check page says.
  const header = bundle.statement.split("\n\n")[0] ?? "";
  const f = statementFields(header);
  if (!f.from || !sameAddress(f.from, bundle.from)) throw new WhisperError("INVALID_SIGNATURE", "Proof names a different sender");
  if (f.chain !== bundle.chainId) throw new WhisperError("INVALID_SIGNATURE", "Proof is for a different chain");
  verifyStatementSignature({ chainId: bundle.chainId, signer: bundle.from, statement: bundle.statement, signature: bundle.signature, pqPublicKey });
  const body = bundle.statement.split("\n\n").slice(1).join("\n\n");
  return { from: toQorAddress(bundle.from), to: f.to, time: f.time, body };
}
