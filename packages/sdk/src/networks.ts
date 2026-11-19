import type { Address } from "viem";

/** Everything the SDK needs to talk to one QoreChain network. */
export interface WhisperNetwork {
  /** Human-readable name. */
  name: string;
  /** Native (Cosmos) chain id, used in signatures and sealing. */
  chainId: string;
  /** EVM chain id. */
  evmChainId: number;
  /** QoreChain REST (LCD) endpoint, used for registered post-quantum keys. */
  rest: string;
  /** EVM JSON-RPC endpoint. */
  evmRpc: string;
  /** WhisperMailbox contract. */
  mailbox: Address;
  /** Block the mailbox was deployed in. */
  deployBlock: bigint;
  /** Anti-spam fee per message, in wei (18-decimal QOR). */
  messageFee: bigint;
  /** Block explorer for links. */
  explorer: string;
  /** Largest block span the public EVM node accepts in one eth_getLogs call. */
  maxLogRange: bigint;
}

/** QoreChain testnet (qorechain-diana). */
export const QORECHAIN_TESTNET: WhisperNetwork = {
  name: "QoreChain Testnet",
  chainId: "qorechain-diana",
  evmChainId: 9800,
  rest: "https://api-testnet.qore.host",
  evmRpc: "https://evm-testnet.qore.host",
  mailbox: "0xd837298637f4459a3981b540d5543a4423add801",
  deployBlock: 10350669n,
  messageFee: 1_000_000_000_000_000n,
  explorer: "https://explore.qore.network",
  maxLogRange: 10_000n,
};
