import { toQorAddress } from "@whisper/sdk";
import { AtSign, Ban, Inbox, Link2, ShieldAlert, ShieldCheck, UserRoundX } from "lucide-react";
import type { RecipientState } from "../hooks/useRecipient";
import { Address } from "./Address";
import { Badge, Notice, Spinner, VerifiedBadge } from "./ui";

/** The address safety check shown before sending: who this reaches and how much we can trust it. */
export function RecipientCard({ state, inviteUrl }: { state: RecipientState; inviteUrl: string }) {
  if (state.status === "empty") return null;
  if (state.status === "loading")
    return (
      <div className="recipient recipient--loading">
        <Spinner label="Checking recipient" />
        <span className="muted">Checking this recipient on QoreChain…</span>
      </div>
    );
  if (state.status === "invalid") return <Notice tone="warn">{state.message}</Notice>;
  if (state.status === "error") return <Notice tone="danger" title="Could not check this recipient">{state.message}</Notice>;
  if (state.status === "unknown-handle")
    return (
      <Notice tone="warn" title={`@${state.handle} is not claimed`}>
        No QoreX user has this handle. Check the spelling, or paste their address instead.
      </Notice>
    );

  const { recipient, handle, isSelf } = state;
  if (recipient.status === "no-key") {
    return (
      <div className="recipient">
        <div className="recipient__head">
          <UserRoundX aria-hidden="true" className="recipient__icon recipient__icon--muted" />
          <div>
            <p className="recipient__title">{handle ? `@${handle}` : "This address"} is not on Whisper yet</p>
            <p className="muted small">
              <Address value={toQorAddress(recipient.address)} /> has no published inbox key, so a message could not be sealed to them.
            </p>
          </div>
        </div>
        <p className="small">
          Send them an invite: <span className="mono invite">{inviteUrl}</span>
        </p>
      </div>
    );
  }

  if (recipient.status === "untrusted-key") {
    return (
      <Notice tone="danger" title="This inbox key is not signed by its owner">
        <Address value={toQorAddress(recipient.inbox)} /> has an ML-DSA-87 key on QoreChain, but its latest Whisper key is not bound to
        it by a valid signature. Someone else may have published it, so Whisper will not seal a message to it. Ask the owner to
        republish their key from Whisper's settings.
      </Notice>
    );
  }

  return (
    <div className="recipient">
      <div className="recipient__head">
        {recipient.blocked ? (
          <Ban aria-hidden="true" className="recipient__icon recipient__icon--danger" />
        ) : (
          <Inbox aria-hidden="true" className="recipient__icon" />
        )}
        <div className="recipient__who">
          <p className="recipient__title">
            {handle ? (
              <>
                <AtSign aria-hidden="true" className="inline-icon" />
                {handle}
              </>
            ) : isSelf ? (
              "Note to yourself"
            ) : (
              "Whisper inbox"
            )}
          </p>
          <Address value={toQorAddress(recipient.address)} label="Recipient" />
        </div>
      </div>
      <ul className="recipient__facts">
        {recipient.key?.source === "chain-registry" ? (
          <li>
            <VerifiedBadge label="Key in QoreChain's registry" title="This encryption key was registered on QoreChain by the account itself, in a transaction signed with its hybrid ML-DSA-87 key." />
          </li>
        ) : recipient.key?.cardVerified ? (
          <li>
            <VerifiedBadge label="Key signed with ML-DSA-87" title="The inbox key is bound to this account by a hybrid ML-DSA-87 signature, checked against the key registered on QoreChain." />
          </li>
        ) : (
          <li>
            <Badge tone="warn">
              <ShieldAlert aria-hidden="true" /> Key not verified
            </Badge>
          </li>
        )}
        <li>
          {recipient.hasPqcKey ? (
            <Badge tone="neutral">
              <ShieldCheck aria-hidden="true" /> Post-quantum account
            </Badge>
          ) : (
            <Badge tone="warn">No ML-DSA key registered</Badge>
          )}
        </li>
        {recipient.via === "link" && (
          <li>
            <Badge tone="accent">
              <Link2 aria-hidden="true" /> Delivered to linked inbox
            </Badge>
          </li>
        )}
      </ul>
      {recipient.via === "link" && (
        <p className="muted small">
          This account signed that its messages go to <Address value={recipient.inbox} />.
        </p>
      )}
      {recipient.blocked && <Notice tone="danger" title="You cannot message this inbox">Its owner blocked messages from your address.</Notice>}
      {recipient.requestOnly && !recipient.blocked && (
        <Notice tone="info" title="Contact request first">
          This inbox only accepts direct messages from people it allowed. Your message is sent as a contact request; they can accept it and reply.
        </Notice>
      )}
    </div>
  );
}
