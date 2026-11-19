/**
 * Deploys WhisperMailbox to the QoreChain testnet (qorechain-diana, EVM chain 9800).
 *
 * QoreChain admits an EVM transaction only inside an authorisation window that the sender opens
 * with a hybrid (secp256k1 + ML-DSA-87) signed native-lane message, so deployment has three steps:
 *   1. register the deployer's ML-DSA-87 key (once per account),
 *   2. open a short, unscoped window (contract creation is refused under a scoped one),
 *   3. deploy the contract with an ordinary EVM transaction.
 *
 * Usage: pnpm --filter @whisper/contracts deploy:testnet   (reads contracts/.env)
 */
import { readFileSync } from "node:fs";
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  fetchPqcStatus,
  openEvmWindowMsg,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NET = {
  chainId: "qorechain-diana",
  rest: "https://api-testnet.qore.host",
  rpc: "https://rpc-testnet.qore.host",
  evmRpc: "https://evm-testnet.qore.host",
};
const chain = defineChain({
  id: 9800,
  name: "QoreChain Testnet",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [NET.evmRpc] } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function accountSequence(address: string) {
  const res = await fetch(`${NET.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: fund it from the faucet first`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

async function broadcastNative(acc: UnifiedAccount, mode: "hybrid" | "classical", messages: Parameters<EthNativeSigner["sign"]>[0]["messages"]) {
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: NET.rest });
  const transport = await StargateClient.connect(NET.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: NET.chainId,
      ...(await accountSequence(acc.cosmos)),
      fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
      messages,
    });
    if (res.code !== 0) throw new Error(`native tx failed (code ${res.code}): ${res.rawLog ?? ""}`);
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

async function main() {
  const mnemonic = process.env.DEPLOYER_MNEMONIC?.trim();
  if (!mnemonic) throw new Error("Set DEPLOYER_MNEMONIC in contracts/.env (testnet-only account)");
  const fee = parseEther(process.env.MESSAGE_FEE_QOR ?? "0.001");
  const acc = await deriveUnifiedAccount(mnemonic, 0);
  console.log(`deployer ${acc.evm} (${acc.cosmos})`);

  if (!(await fetchPqcStatus({ rest: NET.rest, address: acc.cosmos })).registered) {
    const proofOfPossession = signProofOfPossession({ chainId: NET.chainId, account: acc.cosmos, keypair: acc.pqc });
    const tx = await broadcastNative(acc, "classical", [buildRegisterPqcKeyMsg(acc.cosmos, { pqcKeypair: acc.pqc, proofOfPossession })]);
    console.log(`registered ML-DSA-87 key: ${tx}`);
    await sleep(8000);
  }

  const windowTx = await broadcastNative(acc, "hybrid", [
    openEvmWindowMsg({ sender: acc.cosmos, blocks: 300n, maxTxs: 1n, maxValue: 3_000_000n }),
  ]);
  console.log(`opened EVM window: ${windowTx}`);
  await sleep(9000);

  const artifact = JSON.parse(readFileSync(new URL("../out/WhisperMailbox.sol/WhisperMailbox.json", import.meta.url), "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  const wallet = createWalletClient({ account: privateKeyToAccount(acc.privateKey as Hex), chain, transport: http() });
  const publicClient = createPublicClient({ chain, transport: http() });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [fee, acc.evm],
    gas: 3_000_000n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deployment failed: ${hash}`);
  console.log(JSON.stringify({ network: "qorechain-diana", evmChainId: 9800, address: receipt.contractAddress, deployBlock: Number(receipt.blockNumber), deployTx: hash, messageFeeWei: fee.toString(), feeRecipient: acc.evm }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
