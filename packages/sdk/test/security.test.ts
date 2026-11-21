/**
 * Security regression tests (attack audit, second pass, Nov 2026). Each test is an exploit written as a
 * test: it asserts the attack FAILS. A tiny in-memory chain stands in for the public RPC so the real
 * WhisperClient code paths (getKey, getLinkedInbox, resolveRecipient, send) run unchanged.
 */
import { addressFromPublicKey, deriveCanonicalPqKey, deriveClassicalKey, signMessage } from "@qorechain/qoresign";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, hexToBytes, keccak256, toHex, type Hex, type PublicClient } from "viem";
import { describe, expect, it } from "vitest";
import { whisperMailboxAbi } from "../src/abi.js";
import {
  cardStatement,
  encodeCard,
  encodeLinkProof,
  generateInboxKeys,
  isWhisperError,
  linkStatement,
  openMessage,
  signedStatement,
  toQorAddress,
  verifyProofBundle,
  toEvmAddress,
  WhisperClient,
  type Eip1193Provider,
  type InboxKeys,
} from "../src/index.js";
import { QORECHAIN_TESTNET } from "../src/networks.js";

const CHAIN = QORECHAIN_TESTNET.chainId;
// BIP-39 public test-vector mnemonics. Test-only keys.
const ALICE_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const MALLORY_MNEMONIC = "legal winner thank year wave sausage worth useful legal winner thank yellow";

function signer(mnemonic: string) {
  const classicalKey = deriveClassicalKey({ mnemonic, type: "secp256k1" });
  const address = addressFromPublicKey(classicalKey.publicKey, "secp256k1").bech32;
  const pq = deriveCanonicalPqKey({ mnemonic, address });
  return {
    qor: address,
    evm: toEvmAddress(address),
    pqPublicKey: pq.publicKey,
    sign: (data: string) => signMessage({ chainId: CHAIN, signer: address, data, classicalKey, pqKey: pq }),
  };
}

type Ev = { name: "KeyPublished" | "Linked"; block: bigint; account: Hex; topics: Hex[]; data: Hex };

/** In-memory WhisperMailbox state + logs, answering the reads WhisperClient makes. */
class FakeChain {
  events: Ev[] = [];
  keyHash = new Map<string, Hex>();
  keyVersion = new Map<string, bigint>();
  pqc = new Map<string, Uint8Array>();
  block = 100n;

  publishKey(from: Hex, mlkemPublicKey: Uint8Array, card: Uint8Array) {
    const a = from.toLowerCase();
    const version = (this.keyVersion.get(a) ?? 0n) + 1n;
    this.keyVersion.set(a, version);
    this.keyHash.set(a, keccak256(mlkemPublicKey));
    this.events.push({
      name: "KeyPublished",
      block: this.block++,
      account: from,
      topics: encodeEventTopics({ abi: whisperMailboxAbi, eventName: "KeyPublished", args: { account: from, version } }) as Hex[],
      data: encodeAbiParameters([{ type: "bytes" }, { type: "bytes" }], [toHex(mlkemPublicKey), toHex(card)]),
    });
  }

  link(from: Hex, account: Hex, proof: Uint8Array) {
    this.events.push({
      name: "Linked",
      block: this.block++,
      account,
      topics: encodeEventTopics({ abi: whisperMailboxAbi, eventName: "Linked", args: { account, inbox: from } }) as Hex[],
      data: encodeAbiParameters([{ type: "bytes" }], [toHex(proof)]),
    });
  }

  blocks(name: Ev["name"], account: string) {
    return this.events.filter((e) => e.name === name && e.account.toLowerCase() === account.toLowerCase()).map((e) => e.block);
  }

  client(): PublicClient {
    return fakeClient(this);
  }
}

function fakeClient(self: FakeChain): PublicClient {
  {
    return {
      async readContract({ functionName, args }: { functionName: string; args: unknown[] }) {
        const a = String(args[0]).toLowerCase();
        switch (functionName) {
          case "indexLengths":
            return [0n, 0n, BigInt(self.blocks("KeyPublished", a).length), BigInt(self.blocks("Linked", a).length)];
          case "keyBlocks":
          case "linkBlocks": {
            const all = self.blocks(functionName === "keyBlocks" ? "KeyPublished" : "Linked", a);
            const start = Number(args[1]);
            return all.slice(start, start + Number(args[2]));
          }
          case "keyHash":
            return self.keyHash.get(a) ?? `0x${"00".repeat(32)}`;
          case "pqcKeyStatus": {
            const k = self.pqc.get(a);
            return k ? [true, 1, toHex(k), true] : [false, 0, "0x", false];
          }
          case "requestMode":
          case "isAllowed":
          case "isBlocked":
            return false;
          default:
            throw new Error(`fake chain: ${functionName}`);
        }
      },
      async getLogs({ event, args, fromBlock, toBlock }: { event: { name: string }; args: { account?: string }; fromBlock: bigint; toBlock: bigint }) {
        return self.events
          .filter((e) => e.name === event.name && e.block >= fromBlock && e.block <= toBlock)
          .filter((e) => !args.account || e.account.toLowerCase() === args.account.toLowerCase())
          .map((e) => ({ topics: e.topics, data: e.data, blockNumber: e.block, transactionHash: "0x" }));
      },
    } as unknown as PublicClient;
  }
}

const noRest = async () => new Response("{}", { status: 404 });

/** Records the transaction a wallet would be asked to send. */
function recordingProvider(): Eip1193Provider & { sent: { data: Hex }[] } {
  const sent: { data: Hex }[] = [];
  return { sent, request: async ({ params }) => (sent.push((params as { data: Hex }[])[0]!), `0x${"11".repeat(32)}`) };
}

function card(owner: ReturnType<typeof signer>, account: string, keys: InboxKeys, issuedAt: string, by = owner) {
  const statement = cardStatement({ account, chainId: CHAIN, mlkemPublicKey: keys.mlkemPublicKey, issuedAt });
  return encodeCard({ v: 1, statement, signature: by.sign(statement) });
}

describe("F-6: key substitution with a forged card (attacker with the victim's classical key and an open EVM window)", () => {
  it("refuses to seal to a key whose card does not verify against the account's registered ML-DSA-87 key", async () => {
    const alice = signer(ALICE_MNEMONIC);
    const mallory = signer(MALLORY_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(alice.evm.toLowerCase(), alice.pqPublicKey);
    const aliceKeys = generateInboxKeys();
    chain.publishKey(alice.evm, aliceKeys.mlkemPublicKey, card(alice, alice.evm, aliceKeys, "2026-11-19T00:00:00.000Z"));

    // The thief lands one publishKey from Alice's address (L-2 window) with his own inbox key and a card
    // he signed himself: it can never verify against Alice's ML-DSA-87 key.
    const malloryKeys = generateInboxKeys();
    chain.publishKey(alice.evm, malloryKeys.mlkemPublicKey, card(alice, alice.evm, malloryKeys, "2026-11-20T00:00:00.000Z", mallory));

    const provider = recordingProvider();
    const client = new WhisperClient({ publicClient: chain.client(), provider, fetch: noRest });
    const recipient = await client.resolveRecipient(alice.evm, "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5");

    let sealedToThief = false;
    try {
      await client.send({ from: "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5", recipient, payload: { v: 1, type: "text", body: "the launch code is 4471", ts: 1 } });
      const call = decodeFunctionData({ abi: whisperMailboxAbi, data: provider.sent[0]!.data });
      const bytes = hexToBytes(call.args![1] as Hex);
      const opened = openMessage({ chainId: CHAIN, from: "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5", to: alice.evm, envelope: bytes, keys: malloryKeys });
      sealedToThief = opened.body === "the launch code is 4471";
    } catch (error) {
      expect(isWhisperError(error)).toBe(true);
    }
    expect(sealedToThief).toBe(false);
    expect(recipient.status).not.toBe("ready");
    expect(provider.sent).toHaveLength(0);
  });

  it("still sends to a key with a valid card", async () => {
    const alice = signer(ALICE_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(alice.evm.toLowerCase(), alice.pqPublicKey);
    const keys = generateInboxKeys();
    chain.publishKey(alice.evm, keys.mlkemPublicKey, card(alice, alice.evm, keys, "2026-11-19T00:00:00.000Z"));
    const client = new WhisperClient({ publicClient: chain.client(), fetch: noRest });
    const recipient = await client.resolveRecipient(alice.evm);
    expect(recipient.status).toBe("ready");
    expect(recipient.key?.cardVerified).toBe(true);
  });
});

describe("F-7: key rollback by replaying the account's own old card", () => {
  it("does not seal to an older key re-published after a rotation, even though its card is genuine", async () => {
    const alice = signer(ALICE_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(alice.evm.toLowerCase(), alice.pqPublicKey);
    const oldKeys = generateInboxKeys(); // later leaked: the reason Alice rotated
    const oldCard = card(alice, alice.evm, oldKeys, "2026-11-19T00:00:00.000Z");
    chain.publishKey(alice.evm, oldKeys.mlkemPublicKey, oldCard);
    const newKeys = generateInboxKeys();
    chain.publishKey(alice.evm, newKeys.mlkemPublicKey, card(alice, alice.evm, newKeys, "2026-11-20T00:00:00.000Z"));

    // The thief copies the old key and its genuine card from the public event history and re-publishes
    // them from Alice's address through one open EVM window.
    chain.publishKey(alice.evm, oldKeys.mlkemPublicKey, oldCard);

    const client = new WhisperClient({ publicClient: chain.client(), fetch: noRest });
    const recipient = await client.resolveRecipient(alice.evm);
    expect(recipient.status).not.toBe("ready");
    expect(recipient.key?.cardVerified).toBe(false);
  });

  it("is not fooled into distrust when the current key and card are simply published again", async () => {
    const alice = signer(ALICE_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(alice.evm.toLowerCase(), alice.pqPublicKey);
    const a = generateInboxKeys();
    const b = generateInboxKeys();
    const bCard = card(alice, alice.evm, b, "2026-11-20T00:00:00.000Z");
    chain.publishKey(alice.evm, a.mlkemPublicKey, card(alice, alice.evm, a, "2026-11-19T00:00:00.000Z"));
    chain.publishKey(alice.evm, b.mlkemPublicKey, bCard);
    chain.publishKey(alice.evm, b.mlkemPublicKey, bCard);
    const recipient = await new WhisperClient({ publicClient: chain.client(), fetch: noRest }).resolveRecipient(alice.evm);
    expect(recipient.status).toBe("ready");
  });

  it("accepts a normal rotation to a newer card", async () => {
    const alice = signer(ALICE_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(alice.evm.toLowerCase(), alice.pqPublicKey);
    const a = generateInboxKeys();
    const b = generateInboxKeys();
    chain.publishKey(alice.evm, a.mlkemPublicKey, card(alice, alice.evm, a, "2026-11-19T00:00:00.000Z"));
    chain.publishKey(alice.evm, b.mlkemPublicKey, card(alice, alice.evm, b, "2026-11-20T00:00:00.000Z"));
    const recipient = await new WhisperClient({ publicClient: chain.client(), fetch: noRest }).resolveRecipient(alice.evm);
    expect(recipient.status).toBe("ready");
    expect(recipient.key?.version).toBe(2);
  });
});

describe("F-8: link replay by a former inbox", () => {
  function linkProof(main: ReturnType<typeof signer>, inbox: Hex, issuedAt: string) {
    const statement = linkStatement({ account: main.qor, inbox, chainId: CHAIN, issuedAt });
    return encodeLinkProof({ v: 1, statement, signature: main.sign(statement) });
  }

  it("keeps delivering to the newest linked inbox when an old link proof is re-emitted", async () => {
    const main = signer(ALICE_MNEMONIC); // a QoreX main account
    const chain = new FakeChain();
    chain.pqc.set(main.evm.toLowerCase(), main.pqPublicKey);
    const oldInbox = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5" as Hex; // later compromised
    const newInbox = "0x35750cc522969F297F421E411e0Cb4493572b1a8" as Hex;
    const oldProof = linkProof(main, oldInbox, "2026-11-19T00:00:00.000Z");
    chain.link(oldInbox, main.evm, oldProof);
    chain.link(newInbox, main.evm, linkProof(main, newInbox, "2026-11-20T00:00:00.000Z"));

    // Whoever controls the old inbox calls link(main, oldProof) again: the proof is genuine and names it.
    chain.link(oldInbox, main.evm, oldProof);

    const client = new WhisperClient({ publicClient: chain.client(), fetch: noRest });
    expect(await client.getLinkedInbox(main.evm)).toBe(toEvmAddress(newInbox));
  });

  it("ranks links signed before `issued` existed as oldest, and still follows them when they are all there is", async () => {
    const main = signer(ALICE_MNEMONIC);
    const chain = new FakeChain();
    chain.pqc.set(main.evm.toLowerCase(), main.pqPublicKey);
    const legacyInbox = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5" as Hex;
    const legacy = linkStatement({ account: main.qor, inbox: legacyInbox, chainId: CHAIN });
    const legacyProof = encodeLinkProof({ v: 1, statement: legacy, signature: main.sign(legacy) });
    chain.link(legacyInbox, main.evm, legacyProof);
    const client = new WhisperClient({ publicClient: chain.client(), fetch: noRest });
    expect(await client.getLinkedInbox(main.evm)).toBe(toEvmAddress(legacyInbox));

    const newInbox = "0x35750cc522969F297F421E411e0Cb4493572b1a8" as Hex;
    chain.link(newInbox, main.evm, linkProof(main, newInbox, "2026-11-20T00:00:00.000Z"));
    chain.link(legacyInbox, main.evm, legacyProof); // replayed legacy proof
    expect(await new WhisperClient({ publicClient: chain.client(), fetch: noRest }).getLinkedInbox(main.evm)).toBe(toEvmAddress(newInbox));
  });
});

describe("F-9: the Check page shows header fields that the body can override", () => {
  it("reads to/time/chain only from the statement header, never from lines in the signed body", () => {
    const alice = signer(ALICE_MNEMONIC);
    const bob = "0x9d915196cB6c562E95F83240d5f1F6E4D38661A5";
    const carol = "qor1avnejacyrgz607gfh5y5ysgldq4mtqwcy67tzp";
    const body = "Payment received in full.\nto: " + carol + "\ntime: 2020-01-01T00:00:00.000Z";
    const statement = signedStatement({ chainId: CHAIN, from: alice.qor, to: bob, ts: Date.parse("2026-11-20T10:00:00.000Z"), body });
    const bundle = { v: 1 as const, chainId: CHAIN, from: alice.qor, statement, signature: alice.sign(statement) };
    const shown = verifyProofBundle(bundle, alice.pqPublicKey);
    expect(shown.to).toBe(toQorAddress(bob));
    expect(shown.time).toBe("2026-11-20T10:00:00.000Z");
    expect(shown.body).toBe(body);
  });
});
