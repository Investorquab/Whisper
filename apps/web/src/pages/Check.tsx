import { toQorAddress, verifyProofBundle, type MessageProofBundle } from "@whisper/sdk";
import { FileSignature, SearchCheck, ShieldX } from "lucide-react";
import { useEffect, useState } from "react";
import { Address } from "../components/Address";
import { Button, Notice, Spinner, TextArea, VerifiedBadge } from "../components/ui";
import { decodeProof } from "../lib/proof";
import { useSession } from "../state/session";

type Result =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "invalid"; reason: string; bundle?: MessageProofBundle }
  | { status: "valid"; bundle: MessageProofBundle; body: string; to?: string; time?: string; onChain?: { block: bigint; matches: boolean } };

/**
 * Public page: verifies a signed Whisper message from a proof link, with no wallet and no inbox key.
 * The signer's ML-DSA-87 key is read from QoreChain itself (pqcKeyStatus precompile).
 */
export function CheckPage() {
  const s = useSession();
  const [input, setInput] = useState(() => (window.location.hash.length > 1 ? window.location.hash.slice(1) : ""));
  const [result, setResult] = useState<Result>({ status: "idle" });

  async function check(text: string) {
    setResult({ status: "checking" });
    let bundle: MessageProofBundle | undefined;
    try {
      bundle = decodeProof(text);
      if (bundle.chainId !== s.client.network.chainId) throw new Error(`This proof is for ${bundle.chainId}, not ${s.client.network.chainId}.`);
      const pq = await s.client.pqcPublicKey(bundle.from);
      if (!pq) throw new Error("The signer has no ML-DSA-87 key registered on QoreChain, so the signature cannot be checked.");
      const parsed = verifyProofBundle(bundle, pq);
      let onChain: { block: bigint; matches: boolean } | undefined;
      if (bundle.txHash && /^0x[0-9a-fA-F]{64}$/.test(bundle.txHash)) {
        try {
          const tx = await s.client.publicClient.getTransaction({ hash: bundle.txHash as `0x${string}` });
          onChain = { block: tx.blockNumber ?? 0n, matches: tx.from.toLowerCase() === bundle.from.toLowerCase() && tx.to?.toLowerCase() === s.client.network.mailbox.toLowerCase() };
        } catch {
          onChain = undefined;
        }
      }
      setResult({ status: "valid", bundle, ...parsed, onChain });
    } catch (e) {
      setResult({ status: "invalid", reason: (e as Error).message, bundle });
    }
  }

  useEffect(() => {
    if (input) void check(input);
    // Run once for a link opened with a proof in its fragment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="check">
      <p className="eyebrow">Check a message</p>
      <h1 className="check__title">Did they really sign this?</h1>
      <p className="muted">
        Paste a Whisper proof link. Whisper checks the hybrid ML-DSA-87 signature against the signer's key registered on QoreChain. No wallet needed, nothing is sent anywhere.
      </p>

      {result.status === "valid" && (
        <section className="card stack check__result check__result--valid" aria-live="polite">
          <div className="row">
            <VerifiedBadge label="Valid ML-DSA-87 signature" />
            {result.onChain?.matches && (
              <span className="badge badge--neutral" title="Messages are sealed, so the transaction's contents cannot be compared with this text. The proof only names it.">
                Signer sent a Whisper transaction in block {result.onChain.block.toString()} (contents sealed, not compared)
              </span>
            )}
          </div>
          <blockquote className="check__quote">{result.body}</blockquote>
          <dl className="facts">
            <div>
              <dt>Signed by</dt>
              <dd>
                <Address value={toQorAddress(result.bundle.from)} label="Signer" />
              </dd>
            </div>
            {result.to && (
              <div>
                <dt>Addressed to</dt>
                <dd>
                  <Address value={result.to} label="Recipient" />
                </dd>
              </div>
            )}
            {result.time && (
              <div>
                <dt>Written</dt>
                <dd>{new Date(result.time).toLocaleString()}</dd>
              </div>
            )}
          </dl>
          <p className="muted small">
            <FileSignature aria-hidden="true" className="inline-icon" /> The signature covers this exact text. Change one character and it no longer verifies.
          </p>
        </section>
      )}
      {result.status === "invalid" && (
        <Notice tone="danger" title="Not a valid signature">
          <span className="row">
            <ShieldX aria-hidden="true" className="inline-icon" /> {result.reason}
          </span>
        </Notice>
      )}
      {result.status === "checking" && (
        <div className="centered">
          <Spinner label="Checking" />
        </div>
      )}

      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          void check(input);
        }}
      >
        <TextArea label="Proof link or proof text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://…/check#…" spellCheck={false} />
        <Button type="submit" icon={<SearchCheck />} disabled={!input.trim() || result.status === "checking"}>
          Check signature
        </Button>
      </form>
    </div>
  );
}
