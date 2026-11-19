import { toEvmAddress } from "@whisper/sdk";
import { ArrowLeft } from "lucide-react";
import { useId, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Composer } from "../components/Composer";
import { RecipientCard } from "../components/RecipientCard";
import { useRecipient } from "../hooks/useRecipient";

/** New message. Also serves `/to/:address` deep links from "Message the creator" buttons. */
export function ComposePage() {
  const params = useParams();
  const [search] = useSearchParams();
  const ids = useId();
  const initial = (() => {
    try {
      return params.address ? toEvmAddress(params.address) : "";
    } catch {
      return params.address ?? "";
    }
  })();
  const [to, setTo] = useState(initial);
  const state = useRecipient(to);
  // Both come from the linking site's URL, so they are untrusted: trimmed, shown as plain text, labelled as the site's claim.
  const source = search.get("from")?.replace(/\s+/g, " ").trim().slice(0, 60);
  const draft = (search.get("draft") ?? "").slice(0, 500);
  const invite = `${window.location.origin}/app`;

  return (
    <div className="compose">
      <Link to="/app" className="back-link">
        <ArrowLeft aria-hidden="true" /> Inbox
      </Link>
      <h1 className="compose__title">New message</h1>
      {source && <p className="muted">You came here from a site that calls itself “{source}”. Check the recipient below before you send.</p>}
      <div className="card stack">
        <div className="field">
          <label htmlFor={`${ids}-to`} className="field__label">
            To
          </label>
          <input
            id={`${ids}-to`}
            className="input mono"
            placeholder="@handle, qor1… or 0x…"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            autoFocus={!initial}
          />
        </div>
        <RecipientCard state={state} inviteUrl={invite} />
        <Composer recipient={state.status === "resolved" ? state.recipient : undefined} initialDraft={draft} />
      </div>
    </div>
  );
}
