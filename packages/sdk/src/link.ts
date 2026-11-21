import { verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import { sameAddress, toEvmAddress, toQorAddress } from "./address.js";
import { WhisperError } from "./errors.js";
import { statementFields } from "./keys.js";

/**
 * A link lets an account that cannot use the EVM lane (a QoreX main account, coin type 118) receive
 * Whisper messages in an inbox it controls. The account signs the statement; the inbox publishes it.
 */
export function linkStatement(args: { account: string; inbox: string; chainId: string; issuedAt?: string }): string {
  return [
    "Whisper link v1",
    "Deliver my Whisper messages to this inbox.",
    `account: ${toQorAddress(args.account)}`,
    `inbox: ${toEvmAddress(args.inbox)}`,
    `chain: ${args.chainId}`,
    // When the link was made. Readers follow the newest signed link, so an old proof re-sent later cannot
    // take delivery back. Optional only so that links signed before it existed still verify.
    ...(args.issuedAt ? [`issued: ${args.issuedAt}`] : []),
  ].join("\n");
}

export interface WhisperLinkProof {
  v: 1;
  statement: string;
  signature: MessageSignature;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeLinkProof(proof: WhisperLinkProof): Uint8Array {
  return encoder.encode(JSON.stringify(proof));
}

export function decodeLinkProof(bytes: Uint8Array): WhisperLinkProof {
  try {
    const proof = JSON.parse(decoder.decode(bytes)) as WhisperLinkProof;
    if (proof.v !== 1 || typeof proof.statement !== "string" || typeof proof.signature !== "object" || proof.signature === null) {
      throw new Error("bad shape");
    }
    return proof;
  } catch (cause) {
    throw new WhisperError("INVALID_LINK", "Not a Whisper link proof", cause);
  }
}

/** Throws unless `proof` is `account`'s signed statement naming `inbox` on `chainId`. */
export function verifyLinkProof(args: {
  proof: WhisperLinkProof;
  account: string;
  inbox: string;
  chainId: string;
  pqPublicKey: Uint8Array;
}): void {
  const f = statementFields(args.proof.statement);
  if (!args.proof.statement.startsWith("Whisper link v1\n")) throw new WhisperError("INVALID_LINK", "Not a Whisper link v1");
  if (!f.account || !sameAddress(f.account, args.account)) throw new WhisperError("INVALID_LINK", "Link names a different account");
  if (!f.inbox || !sameAddress(f.inbox, args.inbox)) throw new WhisperError("INVALID_LINK", "Link names a different inbox");
  if (f.chain !== args.chainId) throw new WhisperError("INVALID_LINK", "Link is for a different chain");
  try {
    verifyMessage({
      chainId: args.chainId,
      signer: toQorAddress(args.account),
      data: args.proof.statement,
      signature: args.proof.signature,
      pqPublicKey: args.pqPublicKey,
      requirePq: true,
    });
  } catch (cause) {
    throw new WhisperError("INVALID_SIGNATURE", "Link signature does not verify against the account's ML-DSA-87 key", cause);
  }
}
