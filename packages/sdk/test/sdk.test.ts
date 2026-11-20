import { readFileSync } from "node:fs";
import { addressFromPublicKey, deriveCanonicalPqKey, deriveClassicalKey, signMessage } from "@qorechain/qoresign";
import { base64 } from "@scure/base";
import { describe, expect, it } from "vitest";
import {
  PAD_BLOCK,
  blockSpans,
  cardStatement,
  composeUrl,
  decodeCard,
  encodeCard,
  encodePayload,
  explainError,
  fetchChainKemKey,
  generateInboxKeys,
  inboxKeysFromSeed,
  isWhisperError,
  linkStatement,
  openMessage,
  sameAddress,
  sealMessage,
  signedStatement,
  toEvmAddress,
  toQorAddress,
  verifyCard,
  verifyLinkProof,
  verifyProofBundle,
  verifySignedMessage,
  verifyStatementSignature,
  type WhisperPayload,
  WhisperClient,
} from "../src/index.js";

const CHAIN = "qorechain-diana";
// BIP-39 test vector mnemonic (public). Test-only keys.
const TEST_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const OTHER_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";

async function signer(mnemonic: string) {
  const classicalKey = deriveClassicalKey({ mnemonic, type: "secp256k1" });
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  const pq = deriveCanonicalPqKey({ mnemonic, address });
  return {
    address,
    pqPublicKey: pq.publicKey,
    sign: (data: string) => signMessage({ chainId: CHAIN, signer: address, data, classicalKey, pqKey: pq }),
  };
}

describe("addresses", () => {
  const qor = "qor18z3hpmxe5tjrdpk096jgj5ppd6mwry5atay6g4";
  const evm = "0x38A370ecD9A2E43686cF2ea48950216eb6E1929d";

  it("converts between qor1 and 0x encodings of the same account", () => {
    expect(toEvmAddress(qor)).toBe(evm);
    expect(toQorAddress(evm)).toBe(qor);
    expect(toQorAddress(evm.toLowerCase())).toBe(qor);
    expect(sameAddress(qor, evm.toLowerCase())).toBe(true);
  });

  it("rejects malformed input with INVALID_ADDRESS", () => {
    for (const bad of ["", "0x123", "cosmos1abc", "qor1notvalid", "0xZZ70ecD9A2E43686cF2ea48950216eb6E1929d", `${qor}x`]) {
      try {
        toEvmAddress(bad);
        expect.unreachable(`accepted ${bad}`);
      } catch (error) {
        expect(isWhisperError(error, "INVALID_ADDRESS")).toBe(true);
      }
    }
  });
});

describe("sealed messages", () => {
  const alice = "0x38A370ecD9A2E43686cF2ea48950216eb6E1929d";
  const bob = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5";
  const payload: WhisperPayload = { v: 1, type: "text", body: "Hi Bob, I sent 50 QOR to you by mistake.", ts: 1_700_000_000_000 };

  it("round-trips for the recipient and for the sender's own copy", () => {
    const bobKeys = generateInboxKeys();
    const aliceKeys = generateInboxKeys();
    const envelope = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload, recipientKey: bobKeys.mlkemPublicKey, senderKey: aliceKeys.mlkemPublicKey });
    expect(openMessage({ chainId: CHAIN, from: alice, to: bob, envelope, keys: bobKeys })).toEqual(payload);
    expect(openMessage({ chainId: CHAIN, from: alice, to: bob, envelope, keys: aliceKeys })).toEqual(payload);
  });

  it("cannot be opened by anyone else", () => {
    const bobKeys = generateInboxKeys();
    const envelope = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload, recipientKey: bobKeys.mlkemPublicKey });
    expect(() => openMessage({ chainId: CHAIN, from: alice, to: bob, envelope, keys: generateInboxKeys() })).toThrowError(/not sealed to this inbox/);
  });

  it("is bound to its sender and recipient (a copied envelope fails to open)", () => {
    const bobKeys = generateInboxKeys();
    const envelope = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload, recipientKey: bobKeys.mlkemPublicKey });
    const mallory = "0x35750cc522969F297F421E411e0Cb4493572b1a8";
    expect(() => openMessage({ chainId: CHAIN, from: mallory, to: bob, envelope, keys: bobKeys })).toThrow();
    expect(() => openMessage({ chainId: "qorechain-vladi", from: alice, to: bob, envelope, keys: bobKeys })).toThrow();
  });

  it("detects tampering with the ciphertext", () => {
    const bobKeys = generateInboxKeys();
    const envelope = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload, recipientKey: bobKeys.mlkemPublicKey });
    const tampered = envelope.slice();
    tampered[tampered.length - 5] = (tampered[tampered.length - 5] ?? 0) ^ 0xff;
    expect(() => openMessage({ chainId: CHAIN, from: alice, to: bob, envelope: tampered, keys: bobKeys })).toThrow();
  });

  it("pads payloads so ciphertext size hides message length", () => {
    expect(encodePayload({ ...payload, body: "hi" }).length).toBe(PAD_BLOCK);
    expect(encodePayload({ ...payload, body: "x".repeat(230) }).length % PAD_BLOCK).toBe(0);
  });

  it("keeps envelopes inside the contract's size limits", () => {
    const keys = generateInboxKeys();
    const small = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload: { ...payload, body: "" }, recipientKey: keys.mlkemPublicKey });
    expect(small.length).toBeGreaterThanOrEqual(1688);
    const big = sealMessage({ chainId: CHAIN, from: alice, to: bob, payload: { ...payload, body: "€".repeat(4000) }, recipientKey: keys.mlkemPublicKey, senderKey: generateInboxKeys().mlkemPublicKey });
    expect(big.length).toBeLessThanOrEqual(24_576);
  });

  it("rejects invalid payloads", () => {
    const keys = generateInboxKeys();
    const seal = (p: WhisperPayload) => sealMessage({ chainId: CHAIN, from: alice, to: bob, payload: p, recipientKey: keys.mlkemPublicKey });
    expect(() => seal({ ...payload, body: "x".repeat(4001) })).toThrowError(/at most/);
    expect(() => seal({ ...payload, type: "reaction", body: "👍" })).toThrowError(/reaction/);
    expect(() => seal({ ...payload, type: "nope" as never })).toThrowError(/Unknown/);
    expect(() => seal({ ...payload, type: "reaction", body: "👍", replyTo: "7" })).not.toThrow();
  });

  it("restores the same keys from the 32-byte seed", () => {
    const keys = generateInboxKeys();
    expect(inboxKeysFromSeed(keys.seed).mlkemPublicKey).toEqual(keys.mlkemPublicKey);
    expect(() => inboxKeysFromSeed(new Uint8Array(31))).toThrow();
  });
});

describe("QoreChain's native KEM registry (registered recipient keys)", () => {
  const dana = "qor18uusdy4ljlr9gfyad2nalete745s73lgxuelp8";
  const reply = (status: number, body?: unknown) => async () => new Response(body === undefined ? "" : JSON.stringify(body), { status });
  const keys = generateInboxKeys();
  const record = (algorithm_id: number, key: Uint8Array) => ({ found: true, key: { address: dana, algorithm_id, algorithm_name: "mlkem1024", public_key: base64.encode(key) } });

  it("reads an ML-KEM-1024 key from /qorechain/pqc/v1/kem/{address} and seals to it", async () => {
    let asked = "";
    const got = await fetchChainKemKey("https://api-testnet.qore.host", dana, async (url) => {
      asked = url;
      return reply(200, record(2, keys.mlkemPublicKey))();
    });
    expect(asked).toBe(`https://api-testnet.qore.host/qorechain/pqc/v1/kem/${dana}`);
    expect(got).toEqual(keys.mlkemPublicKey);
    const payload: WhisperPayload = { v: 1, type: "text", body: "to a key from the chain registry", ts: 1 };
    const from = "0x38A370ecD9A2E43686cF2ea48950216eb6E1929d";
    const envelope = sealMessage({ chainId: CHAIN, from, to: dana, payload, recipientKey: got! });
    expect(openMessage({ chainId: CHAIN, from, to: dana, envelope, keys })).toEqual(payload);
  });

  it("ignores other algorithms, wrong sizes and accounts without a key", async () => {
    expect(await fetchChainKemKey("https://x.test", dana, reply(200, record(3, keys.mlkemPublicKey)))).toBeUndefined();
    expect(await fetchChainKemKey("https://x.test", dana, reply(200, record(2, keys.mlkemPublicKey.slice(0, 800))))).toBeUndefined();
    expect(await fetchChainKemKey("https://x.test", dana, reply(200, { found: false }))).toBeUndefined();
    expect(await fetchChainKemKey("https://x.test", dana, reply(404))).toBeUndefined();
  });
});

describe("cards (ML-DSA-87 key binding)", () => {
  it("verifies a card signed by the account's hybrid key", async () => {
    const s = await signer(TEST_MNEMONIC);
    const keys = generateInboxKeys();
    const statement = cardStatement({ account: s.address, chainId: CHAIN, mlkemPublicKey: keys.mlkemPublicKey, issuedAt: "2026-11-19T00:00:00.000Z" });
    const card = decodeCard(encodeCard({ v: 1, statement, signature: s.sign(statement) }));
    expect(() => verifyCard({ card, account: s.address, chainId: CHAIN, mlkemPublicKey: keys.mlkemPublicKey, pqPublicKey: s.pqPublicKey })).not.toThrow();
  });

  it("rejects a card for a different key, account, chain or ML-DSA key", async () => {
    const s = await signer(TEST_MNEMONIC);
    const other = await signer(OTHER_MNEMONIC);
    const keys = generateInboxKeys();
    const statement = cardStatement({ account: s.address, chainId: CHAIN, mlkemPublicKey: keys.mlkemPublicKey, issuedAt: "2026-11-19T00:00:00.000Z" });
    const card = { v: 1 as const, statement, signature: s.sign(statement) };
    const base = { card, account: s.address, chainId: CHAIN, mlkemPublicKey: keys.mlkemPublicKey, pqPublicKey: s.pqPublicKey };
    expect(() => verifyCard({ ...base, mlkemPublicKey: generateInboxKeys().mlkemPublicKey })).toThrowError(/different key/);
    expect(() => verifyCard({ ...base, account: other.address })).toThrowError(/different account/);
    expect(() => verifyCard({ ...base, chainId: "qorechain-vladi" })).toThrowError(/different chain/);
    expect(() => verifyCard({ ...base, pqPublicKey: other.pqPublicKey })).toThrowError(/ML-DSA-87/);
    const forged = { ...card, signature: other.sign(statement) };
    expect(() => verifyCard({ ...base, card: forged })).toThrow();
  });

  it("rejects garbage card bytes", () => {
    expect(() => decodeCard(new TextEncoder().encode("{not json"))).toThrowError(/Whisper card/);
    expect(() => decodeCard(new TextEncoder().encode('{"v":2}'))).toThrowError(/Whisper card/);
  });
});

describe("links (main account to inbox)", () => {
  it("accepts the account's own signed link and nothing else", async () => {
    const main = await signer(TEST_MNEMONIC);
    const attacker = await signer(OTHER_MNEMONIC);
    const inbox = "0x35750cc522969F297F421E411e0Cb4493572b1a8";
    const statement = linkStatement({ account: main.address, inbox, chainId: CHAIN });
    const proof = { v: 1 as const, statement, signature: main.sign(statement) };
    expect(() => verifyLinkProof({ proof, account: main.address, inbox, chainId: CHAIN, pqPublicKey: main.pqPublicKey })).not.toThrow();
    expect(() => verifyLinkProof({ proof, account: main.address, inbox: "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5", chainId: CHAIN, pqPublicKey: main.pqPublicKey })).toThrowError(/different inbox/);
    const hijack = linkStatement({ account: main.address, inbox: "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5", chainId: CHAIN });
    const forged = { v: 1 as const, statement: hijack, signature: attacker.sign(hijack) };
    expect(() => verifyLinkProof({ proof: forged, account: main.address, inbox: "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5", chainId: CHAIN, pqPublicKey: main.pqPublicKey })).toThrow();
  });
});

describe("signed messages", () => {
  it("verifies when the statement matches the message, fails when anything changes", async () => {
    const s = await signer(TEST_MNEMONIC);
    const to = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5";
    const ts = 1_763_500_000_000;
    const body = "I agree to return 90% of the funds for a 10% bounty.";
    const statement = signedStatement({ chainId: CHAIN, from: s.address, to, ts, body });
    const payload: WhisperPayload = { v: 1, type: "text", body, ts, signed: { statement, signature: s.sign(statement) } };
    const args = { chainId: CHAIN, from: s.address, to, payload, pqPublicKey: s.pqPublicKey };
    expect(() => verifySignedMessage(args)).not.toThrow();
    expect(() => verifySignedMessage({ ...args, payload: { ...payload, body: body.replace("90%", "50%") } })).toThrowError(/does not match/);
    expect(() => verifySignedMessage({ ...args, to: s.address })).toThrowError(/does not match/);

    const bundle = { v: 1 as const, chainId: CHAIN, from: s.address, statement, signature: payload.signed!.signature };
    expect(verifyProofBundle(bundle, s.pqPublicKey).body).toBe(body);
    expect(() => verifyProofBundle({ ...bundle, statement: statement.replace("90%", "50%") }, s.pqPublicKey)).toThrow();
  });
});

describe("proof bundles under attack", () => {
  it("rejects a proof re-attributed to another account, replayed on another chain, or with a swapped signature", async () => {
    const alice = await signer(TEST_MNEMONIC);
    const mallory = await signer(OTHER_MNEMONIC);
    const to = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5";
    const statement = signedStatement({ chainId: CHAIN, from: alice.address, to, ts: 1_763_500_000_000, body: "Deal: 40 QOR for the print." });
    const bundle = { v: 1 as const, chainId: CHAIN, from: alice.address, statement, signature: alice.sign(statement) };
    expect(verifyProofBundle(bundle, alice.pqPublicKey).body).toBe("Deal: 40 QOR for the print.");
    // Claim Mallory signed it (checked against Mallory's registered key): the statement names Alice.
    expect(() => verifyProofBundle({ ...bundle, from: mallory.address }, mallory.pqPublicKey)).toThrow();
    // Mallory signs Alice's statement with her own keys and presents it as Alice's.
    expect(() => verifyProofBundle({ ...bundle, signature: mallory.sign(statement) }, alice.pqPublicKey)).toThrow();
    // Same statement replayed for a different chain id.
    expect(() => verifyProofBundle({ ...bundle, chainId: "qorechain-vladi" }, alice.pqPublicKey)).toThrow();
    // ML-DSA part stripped or zeroed: the classical half alone is not enough.
    const sig = bundle.signature;
    expect(() => verifyProofBundle({ ...bundle, signature: { ...sig, pq: { algorithmId: sig.pq?.algorithmId ?? 1, signature: base64.encode(new Uint8Array(4627)) } } }, alice.pqPublicKey)).toThrow();
  });
});

describe("compatibility with the real QoreX wallet", () => {
  it("verifies a signature produced by QoreX 0.4.3 signArbitrary on testnet", () => {
    const fx = JSON.parse(readFileSync(new URL("./fixtures/qorex-signature.json", import.meta.url), "utf8"));
    const pqPublicKey = base64.decode(fx.pqPublicKeyBase64);
    expect(() => verifyStatementSignature({ chainId: fx.chainId, signer: fx.signer, statement: fx.statement, signature: fx.signature, pqPublicKey })).not.toThrow();
    expect(() => verifyStatementSignature({ chainId: fx.chainId, signer: fx.signer, statement: `${fx.statement} `, signature: fx.signature, pqPublicKey })).toThrow();
  });
});

describe("helpers", () => {
  it("groups index blocks into as few log queries as the node allows", () => {
    expect(blockSpans([5n, 1n, 3n, 3n], 10_000n)).toEqual([{ fromBlock: 1n, toBlock: 5n }]);
    expect(blockSpans([1n, 10_000n, 10_001n, 25_000n], 10_000n)).toEqual([
      { fromBlock: 1n, toBlock: 10_000n },
      { fromBlock: 10_001n, toBlock: 10_001n },
      { fromBlock: 25_000n, toBlock: 25_000n },
    ]);
    expect(blockSpans([], 10_000n)).toEqual([]);
  });

  it("links a message to its block on QoreChain's explorer (the explorer cannot open EVM hashes)", () => {
    expect(new WhisperClient().blockUrl(10_375_584n)).toBe("https://explore.qore.network/block/10375584");
  });

  it("builds a compose link for 'Message the creator'", () => {
    const url = new URL(composeUrl({ appUrl: "https://example.com", to: "qor18z3hpmxe5tjrdpk096jgj5ppd6mwry5atay6g4", draft: "Hi!", source: "Heirloom" }));
    expect(url.pathname).toBe("/to/0x38A370ecD9A2E43686cF2ea48950216eb6E1929d");
    expect(url.searchParams.get("draft")).toBe("Hi!");
    expect(url.searchParams.get("from")).toBe("Heirloom");
  });

  it("explains wallet and contract errors", () => {
    expect(explainError({ code: 4001, message: "User rejected the request." }).code).toBe("USER_REJECTED");
    expect(explainError(new Error("execution reverted: custom error RequestOnly()")).code).toBe("REQUEST_ONLY");
    expect(explainError(new Error("QoreX: transaction rejected")).code).toBe("USER_REJECTED");
    expect(explainError(new Error("boom")).code).toBe("NETWORK");
    // QoreChain returns custom-error data; viem nests it several levels deep.
    const nested = { message: "Execution reverted for an unknown reason.", cause: { cause: { error: { code: 3, message: "execution reverted", data: "0x96110ff9" } } } };
    expect(explainError(nested).code).toBe("REQUEST_ONLY");
    expect(explainError({ message: "x", cause: { data: { data: "0x097ecfa0" } } }).code).toBe("SENDER_BLOCKED");
  });
});

