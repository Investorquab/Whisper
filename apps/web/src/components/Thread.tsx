import { explainError, toQorAddress } from "@whisper/sdk";
import { ArrowLeft, Ban, Check, ShieldCheck, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useRecipient } from "../hooks/useRecipient";
import { WalletError } from "../lib/qorex";
import { useMailbox } from "../state/mailbox";
import { useSession } from "../state/session";
import { Address } from "./Address";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { peerName } from "./ConversationList";
import { MessageBubble } from "./MessageBubble";
import { Badge, Button, Notice, VerifiedBadge } from "./ui";

export function Thread({ peer }: { peer: string }) {
  const s = useSession();
  const m = useMailbox();
  const location = useLocation();
  const conv = m.conversations.find((c) => c.peer === peer.toLowerCase());
  const recipientState = useRecipient(peer);
  const recipient = recipientState.status === "resolved" ? recipientState.recipient : undefined;
  const handle = m.handleOf(peer);
  const [replyTo, setReplyTo] = useState<string>();
  const [action, setAction] = useState<{ busy?: string; error?: string; note?: string }>({});
  const endRef = useRef<HTMLDivElement>(null);
  const isSelf = s.account?.evmAddress.toLowerCase() === peer.toLowerCase();
  const highlight = location.hash.startsWith("#m-") ? location.hash.slice(3) : undefined;
  const [contact, setContact] = useState<{ requestMode: boolean; allowed: boolean; blocked: boolean }>();
  const me = s.account?.evmAddress;
  useEffect(() => {
    if (!me) return;
    let live = true;
    s.client.contactStatus(me, peer).then((c) => live && setContact(c)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me, peer, s.client, conv?.lastId]);
  const byId = useMemo(() => new Map(conv?.messages.map((x) => [x.id, x]) ?? []), [conv]);

  useEffect(() => {
    if (!action.note) return;
    const t = setTimeout(() => setAction((a) => (a.note ? { ...a, note: undefined } : a)), 4500);
    return () => clearTimeout(t);
  }, [action.note]);

  useEffect(() => {
    if (conv) m.markRead(conv.peer);
  }, [conv, m]);

  useEffect(() => {
    if (highlight) document.getElementById(`m-${highlight}`)?.scrollIntoView({ block: "center" });
    else endRef.current?.scrollIntoView({ block: "end" });
  }, [conv?.messages.length, highlight]);

  async function run(label: string, fn: () => Promise<`0x${string}`>, note: string) {
    setAction({ busy: label });
    try {
      await s.client.waitFor(await fn());
      setAction({ note });
      if (me) setContact(await s.client.contactStatus(me, peer).catch(() => contact));
      await m.reload();
    } catch (e) {
      setAction({ error: e instanceof WalletError ? e.message : explainError(e).message });
    }
  }

  async function react(targetId: string, emoji: string) {
    if (!recipient || !s.account || !s.keys) return;
    await run(
      "react",
      () => s.client.send({ from: s.account!.evmAddress, recipient, payload: { v: 1, type: "reaction", body: emoji, replyTo: targetId, ts: Date.now() }, senderKeys: s.keys }),
      "Reaction sent",
    );
  }

  const lastInbound = conv ? [...conv.messages].reverse().find((x) => !x.mine) : undefined;
  const replyMessage = replyTo ? byId.get(replyTo) : undefined;

  return (
    <section className="thread" aria-label={`Conversation with ${peerName(peer, s.account?.evmAddress, handle)}`}>
      <header className="thread__head">
        <Link to="/app" className="icon-btn thread__back" aria-label="Back to messages">
          <ArrowLeft aria-hidden="true" />
        </Link>
        <Avatar address={peer} handle={handle} size={44} />
        <div className="thread__who">
          {handle || isSelf ? <h2 className="thread__name">{peerName(peer, s.account?.evmAddress, handle)}</h2> : <h2 className="sr-only">Conversation</h2>}
          <Address value={toQorAddress(peer)} label="Address" />
        </div>
        <ul className="thread__facts" aria-label="What QoreChain proves about this account">
          {recipient?.hasPqcKey ? (
            <li>
              <VerifiedBadge label="Post-quantum account" title="This account has an ML-DSA-87 key registered on QoreChain. Its messages can only be sent through a window it opened with that key." />
            </li>
          ) : recipientState.status === "resolved" ? (
            <li>
              <Badge tone="warn">
                <ShieldAlert aria-hidden="true" /> No ML-DSA key
              </Badge>
            </li>
          ) : null}
          {recipient?.key && (
            <li>
              <Badge tone="neutral">
                <ShieldCheck aria-hidden="true" /> {recipient.key.source === "whisper" ? `Inbox key v${recipient.key.version}` : "Key in QoreChain registry"}
              </Badge>
            </li>
          )}
        </ul>
      </header>

      <div className="thread__messages">
        {!conv && <p className="muted thread__start">No messages yet. Say hello below.</p>}
        {conv?.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            quoted={msg.item.payload?.replyTo ? byId.get(msg.item.payload.replyTo) : undefined}
            onReply={() => setReplyTo(msg.id)}
            onReact={(emoji) => void react(msg.id, emoji)}
            highlight={highlight === msg.id}
          />
        ))}
        <div ref={endRef} />
      </div>

      {action.error && <Notice tone="danger" title="That did not go through">{action.error}</Notice>}
      {action.note && !action.busy && (
        <Notice key={action.note} tone="success" toast>
          {action.note}
        </Notice>
      )}
      {action.busy === "react" && <Notice tone="info">Approve the reaction in QoreX…</Notice>}

      {contact?.blocked && !isSelf && (
        <div className="thread__request">
          <p>You blocked this address. They cannot message you.</p>
          <div className="row">
            <Button variant="secondary" loading={action.busy === "unblock"} onClick={() => void run("unblock", () => s.client.setBlocked(me!, peer, false), "Unblocked.")}>
              Unblock
            </Button>
          </div>
        </div>
      )}
      {!contact?.blocked && !isSelf && (conv?.isRequest || (contact?.requestMode && !contact.allowed && lastInbound?.item.kind === "request")) && (
        <div className="thread__request">
          <p>
            <strong>{peerName(peer, s.account?.evmAddress, handle)}</strong> wants to message you. Accept to let them message you directly, or block them.
          </p>
          <div className="row">
            <Button icon={<Check />} loading={action.busy === "accept"} onClick={() => void run("accept", () => s.client.setAllowed(s.account!.evmAddress, peer, true), "Accepted. They can now message you directly.")}>
              Accept
            </Button>
            <Button variant="danger" icon={<Ban />} loading={action.busy === "block"} onClick={() => void run("block", () => s.client.setBlocked(s.account!.evmAddress, peer, true), "Blocked. They can no longer message you.")}>
              Block
            </Button>
          </div>
        </div>
      )}

      <div className="thread__composer">
        <Composer
          compact
          recipient={recipient}
          replyTo={replyTo}
          replyPreview={replyMessage?.item.payload?.body.slice(0, 120)}
          onCancelReply={() => setReplyTo(undefined)}
          onSent={() => void m.reload()}
        />
      </div>
    </section>
  );
}
