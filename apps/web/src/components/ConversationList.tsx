import { shortAddress, toQorAddress } from "@whisper/sdk";
import { Inbox, PenSquare, RefreshCw, Settings, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { formatEther } from "viem";
import { shortTime } from "../lib/conversations";
import { useMailbox } from "../state/mailbox";
import { useSession } from "../state/session";
import { Avatar } from "./Avatar";
import { Notice, Spinner } from "./ui";

export function peerName(peer: string, me: string | undefined, handle: string | null | undefined): string {
  if (me && peer.toLowerCase() === me.toLowerCase()) return "Notes to self";
  return handle ? `@${handle}` : shortAddress(toQorAddress(peer), 10, 6);
}

export function ConversationList() {
  const s = useSession();
  const m = useMailbox();
  const [tab, setTab] = useState<"inbox" | "requests">("inbox");
  const requests = m.conversations.filter((c) => c.isRequest);
  const shown = tab === "inbox" ? m.conversations.filter((c) => !c.isRequest) : requests;
  const [refreshing, setRefreshing] = useState(false);

  return (
    <nav className="convs" aria-label="Conversations">
      <div className="convs__head">
        <h1 className="convs__title">Messages</h1>
        <div className="row">
          <button
            type="button"
            className="icon-btn"
            aria-label="Check for new messages"
            title={m.syncedAt ? `Last checked ${new Date(m.syncedAt).toLocaleTimeString()}` : undefined}
            onClick={async () => {
              setRefreshing(true);
              await m.reload();
              setRefreshing(false);
            }}
          >
            <RefreshCw aria-hidden="true" className={refreshing ? "spin" : undefined} />
          </button>
          <Link to="/app/settings" className="icon-btn" aria-label="Settings">
            <Settings aria-hidden="true" />
          </Link>
          <Link to="/app/new" className="btn btn--primary btn--md convs__new">
            <PenSquare aria-hidden="true" className="btn__icon" /> New
          </Link>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Folders">
        <button role="tab" type="button" aria-selected={tab === "inbox"} className="tabs__tab" onClick={() => setTab("inbox")}>
          Inbox
        </button>
        <button role="tab" type="button" aria-selected={tab === "requests"} className="tabs__tab" onClick={() => setTab("requests")}>
          Requests {requests.length > 0 && <span className="tabs__count">{requests.length}</span>}
        </button>
      </div>
      {m.error && <Notice tone="danger" title="Could not reach QoreChain">{m.error}</Notice>}
      {m.loading ? (
        <div className="centered">
          <Spinner label="Reading your inbox" />
          <p className="muted small">Reading and decrypting your inbox…</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="convs__empty">
          {tab === "inbox" ? <Inbox aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          <p>{tab === "inbox" ? "No conversations yet" : "No contact requests"}</p>
          <p className="muted small">
            {tab === "inbox" ? "Start one with New, or share your address so people can write to you." : "When an inbox in request mode hears from someone new, it lands here."}
          </p>
        </div>
      ) : (
        <ul className="convs__list">
          {shown.map((c) => {
            const handle = m.handleOf(c.peer);
            const last = c.messages[c.messages.length - 1]!;
            return (
              <li key={c.peer}>
                <NavLink to={`/app/c/${c.peer}`} className={({ isActive }) => `conv ${isActive ? "conv--active" : ""}`}>
                  <Avatar address={c.peer} handle={handle} />
                  <span className="conv__body">
                    <span className="conv__top">
                      <span className="conv__name">{peerName(c.peer, s.account?.evmAddress, handle)}</span>
                      <span className="conv__time">{last.item.payload ? shortTime(last.item.payload.ts) : ""}</span>
                    </span>
                    <span className="conv__preview">{c.preview}</span>
                    {c.attachedTotal > 0n && <span className="conv__attached">+{formatEther(c.attachedTotal)} QOR received</span>}
                  </span>
                  {c.unread > 0 && (
                    <span className="conv__unread" aria-label={`${c.unread} unread`}>
                      {c.unread}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
