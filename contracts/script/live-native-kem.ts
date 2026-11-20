/**
 * Live test (testnet only): a Whisper message to a recipient whose ML-KEM-1024 key lives in QoreChain's
 * OWN KEM registry (x/pqc MsgRegisterKEMKey), not in WhisperMailbox.
 *
 *  1. The recipient registers its ML-DSA-87 key (if needed, with proof of possession), then registers an
 *     ML-KEM-1024 key in the native KEM registry with a hybrid-signed transaction.
 *  2. The sender's Whisper SDK resolves the recipient and must report source "chain-registry".
 *  3. The sender seals a message in this process (client side) with ML-KEM-1024 and sends it through
 *     WhisperMailbox inside an ML-DSA-87-signed EVM window.
 *  4. The script reads the recipient's mailbox back from the chain and opens it with the recipient's
 *     private key; the text must match.
 *
 * Keys come from a JSON file outside the repository and are never printed:
 *   { "sender": { "mnemonic": "…" }, "recipient": { "mnemonic": "…", "index": 7 } }
 * Usage: LIVE_KEYS=/path/keys.json [REPORT=/path/report.json] pnpm --filter @whisper/contracts live:native-kem
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  msg,
  openEvmWindowMsg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { QORECHAIN_TESTNET, WhisperClient, fetchChainKemKey, inboxKeysFromSeed } from "@whisper/sdk";
import { createPublicClient, createWalletClient, defineChain, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NET = { chainId: "qorechain-diana", rest: "https://api-testnet.qore.host", rpc: "https://rpc-testnet.qore.host", evmRpc: "https://evm-testnet.qore.host" };
const chain = defineChain({ id: 9800, name: "QoreChain Testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [NET.evmRpc] } } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: Record<string, unknown> = { at: new Date().toISOString(), network: NET.chainId, mailbox: QORECHAIN_TESTNET.mailbox };
const step = (name: string, detail: Record<string, unknown> = {}) => {
  console.log(`PASS ${name}${Object.keys(detail).length ? "  " + JSON.stringify(detail) : ""}`);
  (report.steps ??= [] as unknown[]) && (report.steps as unknown[]).push({ name, ...detail });
};

async function native(acc: UnifiedAccount, messages: Parameters<EthNativeSigner["signAndBroadcast"]>[1]["messages"], mode: "hybrid" | "classical" = "hybrid") {
  const body = (await (await fetch(`${NET.rest}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`)).json()) as { account?: Record<string, unknown> };
  const a = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  const t = await StargateClient.connect(NET.rpc);
  try {
    const res = await new EthNativeSigner(acc, { signMode: mode, rest: NET.rest }).signAndBroadcast(t, {
      chainId: NET.chainId,
      accountNumber: BigInt(a.account_number ?? "0"),
      sequence: BigInt(a.sequence ?? "0"),
      fee: { amount: [{ denom: "uqor", amount: "120000" }], gas: "800000" },
      messages,
    });
    if (res.code !== 0) throw new Error(`rejected (code ${res.code}): ${res.rawLog ?? ""}`);
    await sleep(3000);
    return { hash: res.transactionHash, height: Number(res.height) };
  } finally {
    t.disconnect();
  }
}
const balance = async (addr: string) => {
  const b = (await (await fetch(`${NET.rest}/cosmos/bank/v1beta1/balances/${addr}`)).json()) as { balances?: { denom: string; amount: string }[] };
  return BigInt(b.balances?.find((x) => x.denom === "uqor")?.amount ?? "0");
};

const keys = JSON.parse(readFileSync(process.env.LIVE_KEYS!, "utf8")) as { sender: { mnemonic: string; index?: number }; recipient: { mnemonic: string; index?: number } };
const sender = await deriveUnifiedAccount(keys.sender.mnemonic, keys.sender.index ?? 0);
const recipient = await deriveUnifiedAccount(keys.recipient.mnemonic, keys.recipient.index ?? 0);
report.sender = sender.cosmos;
report.recipient = recipient.cosmos;

// 1. The recipient: gas, ML-DSA-87 key, then an ML-KEM-1024 key in QoreChain's native registry.
if ((await balance(recipient.cosmos)) < 400_000n) {
  const t = await native(sender, [msg.bank.send({ fromAddress: sender.cosmos, toAddress: recipient.cosmos, amount: [{ denom: "uqor", amount: "600000" }] })]);
  step("recipient funded for gas", { tx: t.hash });
}
if (!(await fetchPqcStatus({ rest: NET.rest, address: recipient.cosmos })).registered) {
  const pop = signProofOfPossession({ chainId: NET.chainId, account: recipient.cosmos, keypair: recipient.pqc });
  const t = await native(recipient, [buildRegisterPqcKeyMsg(recipient.cosmos, { pqcKeypair: recipient.pqc, proofOfPossession: pop })], "classical");
  step("recipient ML-DSA-87 key registered with proof of possession", { tx: t.hash });
}
// The recipient's inbox keys come from a seed only the recipient can derive (its own private key).
const seed = createHash("sha256").update(Buffer.from(recipient.privateKey.replace(/^0x/, ""), "hex")).update("whisper native KEM inbox v1").digest();
const inbox = inboxKeysFromSeed(new Uint8Array(seed));
const existing = await fetchChainKemKey(NET.rest, recipient.cosmos);
if (!existing || toHex(existing) !== toHex(inbox.mlkemPublicKey)) {
  const t = await native(recipient, [msg.pqc.registerKemKey({ sender: recipient.cosmos, algorithmId: 2, publicKey: inbox.mlkemPublicKey })]);
  report.kemTx = t;
  step("ML-KEM-1024 key registered in QoreChain's native KEM registry (hybrid-signed)", { tx: t.hash, height: t.height });
}
const onChain = await fetchChainKemKey(NET.rest, recipient.cosmos);
if (!onChain || toHex(onChain) !== toHex(inbox.mlkemPublicKey)) throw new Error("the native KEM registry does not hold the recipient's key");
step("native registry serves the key", { route: `/qorechain/pqc/v1/kem/${recipient.cosmos}`, bytes: onChain.length });

// 2. The sender's Whisper SDK finds the key through the native registry.
const evmSender = privateKeyToAccount(sender.privateKey as Hex);
const wallet = createWalletClient({ account: evmSender, chain, transport: http() });
const pub = createPublicClient({ chain, transport: http() });
const provider = {
  request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_sendTransaction") {
      const p = (params as [{ to: Hex; data: Hex; value?: Hex }])[0];
      return wallet.sendTransaction({ to: p.to, data: p.data, value: p.value ? BigInt(p.value) : 0n, gas: 900_000n });
    }
    return pub.request({ method, params } as never);
  },
};
const client = new WhisperClient({ provider: provider as never, network: { ...QORECHAIN_TESTNET, rest: NET.rest } });
const target = await client.resolveRecipient(recipient.evm, sender.evm);
if (target.status !== "ready" || target.key?.source !== "chain-registry") throw new Error(`expected a chain-registry key, got ${target.key?.source ?? target.status}`);
if (toHex(target.key.mlkemPublicKey) !== toHex(inbox.mlkemPublicKey)) throw new Error("resolved key differs from the registered one");
step("Whisper SDK resolves the recipient through QoreChain's KEM registry", { source: target.key.source });

// 3. Seal (here, client side) and send inside an ML-DSA-87-signed EVM window.
const w = await native(sender, [openEvmWindowMsg({ sender: sender.cosmos, blocks: 120n, maxTxs: 2n, maxValue: 50_000_000n })]);
step("sender's EVM window opened (hybrid ML-DSA-87)", { tx: w.hash });
const text = `Sealed to a key from QoreChain's native KEM registry · ${new Date().toISOString()}`;
const hash = await client.send({ from: sender.evm, recipient: target, payload: { v: 1, type: "text", body: text, ts: Date.now() } });
const receipt = await client.waitFor(hash);
report.messageTx = { hash, block: Number(receipt.blockNumber) };
step("message sent through WhisperMailbox", { tx: hash, block: Number(receipt.blockNumber) });
await native(sender, [closeEvmWindowMsg(sender.cosmos)]).catch(() => undefined);

// 4. The recipient reads the chain and opens the envelope with its private key.
await sleep(2000);
const items = await client.readMailbox(recipient.evm, inbox, { direction: "in" });
const mine = items.find((x) => x.txHash.toLowerCase() === hash.toLowerCase());
if (!mine?.payload || mine.payload.body !== text) throw new Error(`could not open the message: ${mine?.error ?? "not found"}`);
step("recipient opened the message with its ML-KEM-1024 private key", { text: mine.payload.body });

report.ok = true;
if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
console.log("\nALL PASS");
