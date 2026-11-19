import { isWhisperAddress, toEvmAddress } from "@whisper/sdk";
import { MessagesSquare } from "lucide-react";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Address } from "../components/Address";
import { ConversationList } from "../components/ConversationList";
import { Thread } from "../components/Thread";
import { Spinner } from "../components/ui";
import { useMailbox } from "../state/mailbox";
import { useSession } from "../state/session";

/** Two panes on wide screens (list + thread), one pane with back navigation on phones. */
export function InboxPage() {
  const { peer } = useParams();
  const s = useSession();
  const valid = peer && isWhisperAddress(peer);
  if (peer && !valid) return <Navigate to="/app" replace />;
  const peerAddress = valid ? toEvmAddress(peer).toLowerCase() : undefined;
  return (
    <div className={`inbox ${peerAddress ? "inbox--thread" : ""}`}>
      <div className="inbox__list">
        <ConversationList />
      </div>
      <div className="inbox__pane">
        {peerAddress ? (
          <Thread key={peerAddress} peer={peerAddress} />
        ) : (
          <div className="empty inbox__placeholder">
            <MessagesSquare aria-hidden="true" className="empty__icon" />
            <h2>Pick a conversation</h2>
            <p className="muted">
              People can write to you at <Address value={s.account!.evmAddress} />. Every message is sealed to your key and stored on QoreChain.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** `/app/m/:tx`: a shareable link to one message. Only the two people in the conversation can read it. */
export function MessageLinkPage() {
  const { tx } = useParams();
  const m = useMailbox();
  const navigate = useNavigate();
  useEffect(() => {
    if (m.loading) return;
    for (const c of m.conversations) {
      const hit = c.messages.find((x) => x.item.txHash.toLowerCase() === tx?.toLowerCase());
      if (hit) {
        navigate(`/app/c/${c.peer}#m-${hit.id}`, { replace: true });
        return;
      }
    }
  }, [m.loading, m.conversations, tx, navigate]);
  if (m.loading) return <div className="centered"><Spinner label="Finding the message" /></div>;
  return (
    <div className="empty">
      <h1>This message is not in your inbox</h1>
      <p className="muted">Message links only open for the sender and the recipient, because only they hold a key that can decrypt it.</p>
    </div>
  );
}
