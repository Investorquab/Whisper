import { MAX_BODY_LENGTH, explainError, signedStatement, type Recipient, type WhisperPayload } from "@whisper/sdk";
import { ExternalLink, FileSignature, Paperclip, Send, X } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { formatEther, parseEther } from "viem";
import { signStatement, WalletError } from "../lib/qorex";
import { useSession } from "../state/session";
import { Button, Notice } from "./ui";

export interface SentInfo {
  hash: `0x${string}`;
  payload: WhisperPayload;
  recipient: Recipient;
  attached: bigint;
}

function readableError(error: unknown): string {
  if (error instanceof WalletError) return error.message;
  return explainError(error).message;
}

/** Message box with optional attached QOR and the opt-in ML-DSA-87 signature. */
export function Composer({
  recipient,
  replyTo,
  initialDraft = "",
  replyPreview,
  onCancelReply,
  onSent,
  compact,
}: {
  recipient?: Recipient;
  replyTo?: string;
  replyPreview?: string;
  onCancelReply?: () => void;
  initialDraft?: string;
  onSent?: (info: SentInfo) => void;
  compact?: boolean;
}) {
  const s = useSession();
  const ids = useId();
  const [body, setBody] = useState(initialDraft);
  const [attachOpen, setAttachOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [sign, setSign] = useState(false);
  const [phase, setPhase] = useState<"idle" | "signing" | "sending" | "confirming">("idle");
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<{ hash: string; request: boolean }>();

  useEffect(() => {
    if (!sent || !compact) return;
    const t = setTimeout(() => setSent(undefined), 4500);
    return () => clearTimeout(t);
  }, [sent, compact]);

  const canSend = Boolean(recipient && recipient.status === "ready" && !recipient.blocked && s.keys && s.account);
  const requestOnly = Boolean(recipient?.requestOnly);
  const length = [...body].length;
  let attach = 0n;
  let amountError: string | undefined;
  if (attachOpen && amount.trim()) {
    try {
      attach = parseEther(amount.trim() as `${number}`);
      if (attach < 0n) amountError = "Enter a positive amount.";
    } catch {
      amountError = "Enter an amount like 0.5";
    }
  }
  const fee = s.client.network.messageFee;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!recipient || !s.keys || !s.account || !s.qorex) return;
    if (!body.trim()) return setError("Write a message first.");
    if (length > MAX_BODY_LENGTH) return setError(`Messages are at most ${MAX_BODY_LENGTH} characters.`);
    if (amountError) return setError(amountError);
    setError(undefined);
    setSent(undefined);
    try {
      const ts = Date.now();
      const payload: WhisperPayload = { v: 1, type: requestOnly ? "request" : "text", body: body.trim(), ts, ...(replyTo ? { replyTo } : {}) };
      if (sign) {
        setPhase("signing");
        const statement = signedStatement({ chainId: s.client.network.chainId, from: s.account.evmAddress, to: recipient.inbox, ts, body: payload.body });
        const signature = await signStatement(s.qorex, s.account.qorAddress, statement);
        payload.signed = { statement, signature };
      }
      setPhase("sending");
      const hash = await s.client.send({ from: s.account.evmAddress, recipient, payload, senderKeys: s.keys, attach: requestOnly ? 0n : attach });
      setPhase("confirming");
      await s.client.waitFor(hash);
      setSent({ hash, request: requestOnly });
      onCancelReply?.();
      onSent?.({ hash, payload, recipient, attached: requestOnly ? 0n : attach });
      setBody("");
      setAmount("");
      setAttachOpen(false);
      setSign(false);
    } catch (err) {
      setError(readableError(err));
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const label =
    phase === "signing" ? "Approve the signature in QoreX…" : phase === "sending" ? "Approve in QoreX…" : phase === "confirming" ? "Waiting for QoreChain…" : requestOnly ? "Send request" : "Send";

  return (
    <form className={`composer ${compact ? "composer--compact" : ""}`} onSubmit={submit} noValidate>
      {replyTo && replyPreview && (
        <div className="composer__reply">
          <span className="muted small">Replying to</span>
          <span className="composer__reply-text">{replyPreview}</span>
          <button type="button" className="icon-btn" aria-label="Cancel reply" onClick={onCancelReply}>
            <X aria-hidden="true" />
          </button>
        </div>
      )}
      <label htmlFor={`${ids}-body`} className="sr-only">
        Message
      </label>
      <textarea
        id={`${ids}-body`}
        className="input input--area composer__body"
        placeholder={requestOnly ? "Say who you are and why you are writing" : "Write a message. It is sealed in your browser before it leaves."}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
        }}
        disabled={busy || !canSend}
        maxLength={MAX_BODY_LENGTH * 2}
        aria-describedby={`${ids}-count`}
      />
      <div className="composer__tools">
        <div className="composer__toggles">
          {!requestOnly && (
            <button type="button" className={`chip ${attachOpen ? "chip--on" : ""}`} aria-pressed={attachOpen} onClick={() => setAttachOpen((v) => !v)} disabled={busy || !canSend}>
              <Paperclip aria-hidden="true" /> Attach QOR
            </button>
          )}
          <button
            type="button"
            className={`chip ${sign ? "chip--on" : ""}`}
            aria-pressed={sign}
            onClick={() => setSign((v) => !v)}
            disabled={busy || !canSend}
            title="Adds a portable ML-DSA-87 signature anyone can check. Use it for deals and agreements."
          >
            <FileSignature aria-hidden="true" /> Sign this message
          </button>
        </div>
        <span id={`${ids}-count`} className={`composer__count ${length > MAX_BODY_LENGTH ? "composer__count--over" : ""}`}>
          {length}/{MAX_BODY_LENGTH}
        </span>
      </div>
      {attachOpen && !requestOnly && (
        <div className="composer__attach">
          <label htmlFor={`${ids}-amount`} className="field__label">
            QOR to send with this message
          </label>
          <input id={`${ids}-amount`} className="input" inputMode="decimal" placeholder="0.5" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} aria-invalid={Boolean(amountError) || undefined} />
          {amountError && <p className="field__error">{amountError}</p>}
        </div>
      )}
      {sign && (
        <p className="muted small">
          QoreX will show the exact text you are signing. The recipient (and anyone they share it with) can prove you wrote it. Leave this off for everyday messages.
        </p>
      )}
      {error && <Notice tone="danger" title="Not sent">{error}</Notice>}
      {sent && (
        <Notice key={sent.hash} toast={compact} tone="success" title={sent.request ? "Contact request sent" : "Sent"} action={<a href={s.client.txUrl(sent.hash)} target="_blank" rel="noreferrer">View on the explorer <ExternalLink className="inline-icon" aria-hidden="true" /></a>}>
          Sealed with ML-KEM-1024 and stored on QoreChain.
        </Notice>
      )}
      <div className="composer__foot">
        <p className="muted small">
          Fee {formatEther(fee)} QOR{attach > 0n ? ` + ${formatEther(attach)} QOR attached` : ""}. QoreX asks you to approve.
        </p>
        <Button type="submit" icon={<Send />} loading={busy} disabled={!canSend || !body.trim()}>
          {label}
        </Button>
      </div>
    </form>
  );
}
