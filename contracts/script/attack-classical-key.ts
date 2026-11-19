/**
 * Attacker demo: what can someone do with ONLY a victim's classical (secp256k1) private key?
 *
 * That is the key a future quantum computer could recover from a public key. On most chains it is
 * the whole account. On QoreChain the account also has a registered ML-DSA-87 key, and Whisper
 * checks that key everywhere. This script gives the attacker the classical key and nothing else,
 * then tries every route we know of. Each attempt reports BLOCKED or SUCCEEDED; it changes nothing
 * unless an attack succeeds (then it moves at most 0.001 QOR to ATTACK_THIEF).
 *
 * Usage (testnet only):
 *   ATTACK_PRIVATE_KEY=0x… [ATTACK_THIEF=0x…] pnpm --filter @whisper/contracts attack:classical
 */
import { StargateClient } from "@cosmjs/stargate";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  evmToQor,
  fetchEvmWindow,
  fetchPqcStatus,
  generatePqcKeypair,
  openEvmWindowMsg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { classicalKeyFromPrivate, signMessage } from "@qorechain/qoresign";
import {
  QORECHAIN_TESTNET,
  WhisperClient,
  cardStatement,
  encodePayload,
  generateInboxKeys,
  signedStatement,
  verifyCard,
  verifySignedMessage,
  whisperMailboxAbi,
} from "@whisper/sdk";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, hexToBytes, http, parseEther, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NET = { chainId: "qorechain-diana", rest: "https://api-testnet.qore.host", rpc: "https://rpc-testnet.qore.host", evmRpc: "https://evm-testnet.qore.host" };
const chain = defineChain({ id: 9800, name: "QoreChain Testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [NET.evmRpc] } } });
const MAILBOX = QORECHAIN_TESTNET.mailbox;

type Outcome = { name: string; blocked: boolean; detail: string };
const results: Outcome[] = [];
const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 220);

async function attempt(name: string, run: () => Promise<string>) {
  try {
    const detail = await run();
    results.push({ name, blocked: false, detail });
    console.log(`  SUCCEEDED  ${name}\n             ${short(detail)}`);
  } catch (e) {
    const detail = (e as { shortMessage?: string; details?: string; message?: string }).details ?? (e as Error).message;
    results.push({ name, blocked: true, detail });
    console.log(`  BLOCKED    ${name}\n             ${short(detail)}`);
  }
}

async function native(account: UnifiedAccount, mode: "hybrid" | "classical", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"]) {
  const body = (await (await fetch(`${NET.rest}/cosmos/auth/v1beta1/accounts/${account.cosmos}`)).json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  const transport = await StargateClient.connect(NET.rpc);
  try {
    const res = await new EthNativeSigner(account, { signMode: mode, rest: NET.rest }).signAndBroadcast(transport, {
      chainId: NET.chainId,
      accountNumber: BigInt(acc.account_number ?? "0"),
      sequence: BigInt(acc.sequence ?? "0"),
      fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
      messages,
    });
    if (res.code !== 0) throw new Error(`rejected by the chain (code ${res.code}): ${res.rawLog ?? ""}`);
    return `accepted in tx ${res.transactionHash}`;
  } finally {
    transport.disconnect();
  }
}

async function main() {
  const pk = process.env.ATTACK_PRIVATE_KEY?.trim() as Hex | undefined;
  if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new Error("Set ATTACK_PRIVATE_KEY to the victim's 0x-prefixed secp256k1 key (testnet only)");

  // Everything the attacker has: the classical key and what can be computed from it.
  const evm = privateKeyToAccount(pk);
  const victim = { evm: evm.address, cosmos: evmToQor(evm.address) };
  const thief = (process.env.ATTACK_THIEF as Hex | undefined) ?? "0x000000000000000000000000000000000000dEaD";
  const ownPq = generatePqcKeypair(); // the attacker's own ML-DSA-87 key: the real one is unknown to them
  const attacker: UnifiedAccount = {
    ...victim,
    svm: "",
    privateKey: pk,
    publicKey: toHex(secp256k1.getPublicKey(hexToBytes(pk), true)),
    pqc: ownPq,
  } as unknown as UnifiedAccount;

  const pub = createPublicClient({ chain, transport: http() });
  const wallet = createWalletClient({ account: evm, chain, transport: http() });
  const status = await fetchPqcStatus({ rest: NET.rest, address: victim.cosmos });
  const window = await fetchEvmWindow({ rest: NET.rest, address: victim.cosmos }).catch(() => ({ found: false }));
  console.log(`victim   ${victim.evm} (${victim.cosmos})`);
  console.log(`balance  ${(await pub.getBalance({ address: victim.evm })).toString()} wei`);
  console.log(`ML-DSA-87 key registered: ${status.registered}; open EVM window: ${JSON.stringify(window, (_k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 200)}`);
  console.log("\nThe attacker holds the classical key only. Attempts:\n");

  const gasPrice = await pub.getGasPrice();

  await attempt("1. EVM: transfer 0.001 QOR to the thief", async () => {
    const h = await wallet.sendTransaction({ to: thief, value: parseEther("0.001"), gas: 21000n, gasPrice });
    return `tx ${h} status ${(await pub.waitForTransactionReceipt({ hash: h })).status}`;
  });

  await attempt("2. EVM: send a Whisper message as the victim", async () => {
    const data = encodeFunctionData({ abi: whisperMailboxAbi, functionName: "request", args: [thief, toHex(new Uint8Array(1688))] });
    const h = await wallet.sendTransaction({ to: MAILBOX, data, value: QORECHAIN_TESTNET.messageFee, gas: 400000n, gasPrice });
    return `tx ${h} status ${(await pub.waitForTransactionReceipt({ hash: h })).status}`;
  });

  await attempt("3. Native: MsgSend 0.001 QOR, classical signature only", () =>
    native(attacker, "classical", [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: victim.cosmos, toAddress: evmToQor(thief), amount: [{ denom: "uqor", amount: "1000" }] } }]),
  );

  await attempt("4. Native: open an EVM window, classical signature only", () =>
    native(attacker, "classical", [openEvmWindowMsg({ sender: victim.cosmos, blocks: 100n, maxTxs: 1n, maxValue: 1_000n, allowedTargets: [MAILBOX] })]),
  );

  await attempt("5. Native: open an EVM window, hybrid with the attacker's own ML-DSA key", () =>
    native(attacker, "hybrid", [openEvmWindowMsg({ sender: victim.cosmos, blocks: 100n, maxTxs: 1n, maxValue: 1_000n, allowedTargets: [MAILBOX] })]),
  );

  await attempt("6. Native: register the attacker's ML-DSA key over the victim's", () => {
    const proofOfPossession = signProofOfPossession({ chainId: NET.chainId, account: victim.cosmos, keypair: ownPq });
    return native(attacker, "classical", [buildRegisterPqcKeyMsg(victim.cosmos, { pqcKeypair: ownPq, proofOfPossession })]);
  });

  // Off-chain forgeries: these never touch the chain; Whisper checks them against the registered key.
  const client = new WhisperClient();
  const realPq = await client.pqcPublicKey(victim.evm);
  const classicalKey = classicalKeyFromPrivate(hexToBytes(pk), "eth_secp256k1");
  const forge = (data: string) => signMessage({ chainId: NET.chainId, signer: victim.cosmos, data, classicalKey, pqKey: ownPq });

  await attempt("7. Forge a signed Whisper message (\"I owe you nothing\")", async () => {
    if (!realPq) throw new Error("victim has no registered ML-DSA key");
    const ts = Date.now();
    const body = "I confirm I owe you nothing.";
    const statement = signedStatement({ chainId: NET.chainId, from: victim.evm, to: thief, ts, body });
    const payload = { v: 1 as const, type: "text" as const, body, ts, signed: { statement, signature: forge(statement) } };
    encodePayload(payload);
    verifySignedMessage({ chainId: NET.chainId, from: victim.evm, to: thief, payload, pqPublicKey: realPq });
    return "Whisper accepted the forged signature";
  });

  await attempt("8. Forge a Whisper card to swap in the attacker's inbox key", async () => {
    if (!realPq) throw new Error("victim has no registered ML-DSA key");
    const keys = generateInboxKeys();
    const statement = cardStatement({ account: victim.evm, chainId: NET.chainId, mlkemPublicKey: keys.mlkemPublicKey, issuedAt: new Date().toISOString() });
    verifyCard({ card: { v: 1, statement, signature: forge(statement) }, account: victim.evm, chainId: NET.chainId, mlkemPublicKey: keys.mlkemPublicKey, pqPublicKey: realPq });
    return "Whisper accepted the forged card";
  });

  const after = await fetchPqcStatus({ rest: NET.rest, address: victim.cosmos });
  console.log(`\nVictim's registered ML-DSA key unchanged: ${after.registered && JSON.stringify(after.pubkey) === JSON.stringify(status.pubkey)}`);
  const ok = results.every((r) => r.blocked);
  console.log(`\n${results.filter((r) => r.blocked).length}/${results.length} attacks blocked.${ok ? "" : " SOME ATTACKS SUCCEEDED, see above."}`);
  process.exitCode = ok ? 0 : 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
