import { verifySignedMessage } from "@whisper/sdk";
import { AlertCircle, CornerUpLeft, FileSignature, Link2, SmilePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import type { ThreadMessage } from "../lib/conversations";
import { useSession } from "../state/session";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🙏", "✅", "👀"];

type SignatureState = "none" | "checking" | "valid" | "invalid";

function useSignature(message: ThreadMessage): SignatureState {
  const s = useSession();
  const [state, setState] = useState<SignatureState>(message.item.payload?.signed ? "checking" : "none");
  useEffect(() => {
    const payload = message.item.payload;
    if (!payload?.signed) return;
    let live = true;
    (async () => {
      try {
        const pq = await s.client.pqcPublicKey(message.item.from);
        if (!pq) throw new Error("no key");
        verifySignedMessage({ chainId: s.client.network.chainId, from: message.item.from, to: message.item.to, payload, pqPublicKey: pq });
        if (live) setState("valid");
      } catch {
        if (live) setState("invalid");
      }
    })();
    return () => {
      live = false;
    };
  }, [message, s.client]);
  return state;
}

export function MessageBubble({
  message,
  quoted,
  onReply,
  onReact,
  highlight,
}: {
  message: ThreadMessage;
  quoted?: ThreadMessage;
  onReply: () => void;
  onReact: (emoji: string) => void;
  highlight?: boolean;
}) {
  const s = useSession();
  const [picker, setPicker] = useState(false);
  const [copied, setCopied] = useState(false);
  const signature = useSignature(message);
  const p = message.item.payload;
  const time = p ? new Date(p.ts) : undefined;

  return (
    <article id={`m-${message.id}`} className={`msg ${message.mine ? "msg--mine" : ""} ${highlight ? "msg--highlight" : ""}`} aria-label={message.mine ? "You wrote" : "They wrote"}>
      <div className="msg__bubble">
        {message.item.kind === "request" && <span className="msg__kind">Contact request</span>}
        {quoted?.item.payload && (
          <a className="msg__quote" href={`#m-${quoted.id}`}>
            <CornerUpLeft aria-hidden="true" /> {quoted.item.payload.body.slice(0, 120)}
          </a>
        )}
        {p ? (
          <p className="msg__text">{p.body}</p>
        ) : (
          <p className="msg__text msg__text--error">
            <AlertCircle aria-hidden="true" className="inline-icon" /> {message.item.error}
          </p>
        )}
        {message.item.attached > 0n && <span className="msg__attached">+{formatEther(message.item.attached)} QOR</span>}
        <div className="msg__meta">
          {signature === "valid" && (
            <span className="badge badge--verified" title="Signed with the sender's ML-DSA-87 key, registered on QoreChain. The signature covers this exact text.">
              <FileSignature aria-hidden="true" /> Signed
            </span>
          )}
          {signature === "invalid" && <span className="badge badge--danger">Signature does not verify</span>}
          {signature === "checking" && <span className="badge badge--neutral">Checking signature…</span>}
          {time && (
            <time dateTime={time.toISOString()} title={time.toLocaleString()}>
              {time.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            </time>
          )}
        </div>
      </div>
      {message.reactions.length > 0 && (
        <div className="msg__reactions" aria-label="Reactions">
          {message.reactions.map((r) => (
            <span key={r.id} className={`reaction ${r.mine ? "reaction--mine" : ""}`} title={r.mine ? "Your reaction" : "Their reaction"}>
              {r.emoji}
            </span>
          ))}
        </div>
      )}
      {p && (
        <div className="msg__actions">
          <button type="button" className="msg__action" onClick={onReply} aria-label="Reply to this message">
            <CornerUpLeft aria-hidden="true" />
          </button>
          <button type="button" className="msg__action" onClick={() => setPicker((v) => !v)} aria-label="React" aria-expanded={picker}>
            <SmilePlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="msg__action"
            aria-label={copied ? "Link copied" : "Copy a link to this message"}
            title="Only you and the other person can read it"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/app/m/${message.item.txHash}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked */
              }
            }}
          >
            <Link2 aria-hidden="true" />
          </button>
          <a className="msg__action msg__action--link" href={s.client.txUrl(message.item.txHash)} target="_blank" rel="noreferrer">
            On chain
          </a>
          {picker && (
            <div className="picker" role="group" aria-label="Pick a reaction">
              {QUICK_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="picker__emoji"
                  onClick={() => {
                    setPicker(false);
                    onReact(e);
                  }}
                  aria-label={`React with ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
