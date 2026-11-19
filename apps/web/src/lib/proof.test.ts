import { describe, expect, it } from "vitest";
import { decodeProof, encodeProof } from "./proof";

const bundle = {
  v: 1 as const,
  chainId: "qorechain-diana",
  from: "0xeB279977041A05a7F909Bd0942411F682bB581d8",
  statement: "Whisper signed message v1\nfrom: qor1…\n\nI confirm — 49.95 QOR by Friday ✅",
  signature: { signatureType: "ml-dsa-87-hybrid" as const, classical: { keyType: "eth_secp256k1" as const, publicKey: "AA==", signature: "BB==" }, pq: { algorithmId: 1, signature: "CC==" } },
  txHash: "0x1ccefdee14a02d46a14220ff9eb8a5e27be329fa929faebbdfeadae26bd1c7b5",
};

describe("message proofs", () => {
  it("round-trips through a URL-safe fragment, including non-ASCII text", () => {
    const encoded = encodeProof(bundle);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeProof(encoded)).toEqual(bundle);
    expect(decodeProof(`https://whisper.example/check#${encoded}`)).toEqual(bundle);
  });

  it("accepts pasted JSON and rejects anything else", () => {
    expect(decodeProof(JSON.stringify(bundle))).toEqual(bundle);
    expect(() => decodeProof("not a proof")).toThrow();
    expect(() => decodeProof(encodeProof({ ...bundle, v: 2 } as never))).toThrowError(/not a Whisper message proof/);
  });
});
