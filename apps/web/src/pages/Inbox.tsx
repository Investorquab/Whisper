import { Inbox as InboxIcon } from "lucide-react";
import { Address } from "../components/Address";
import { useSession } from "../state/session";

/** Inbox screen. Conversations, composer and requests arrive in the next milestone (M2/M3). */
export function InboxPage() {
  const s = useSession();
  return (
    <div className="empty">
      <InboxIcon aria-hidden="true" className="empty__icon" />
      <h1>Your inbox is ready</h1>
      <p className="muted">
        Messages to <Address value={s.account!.evmAddress} /> are sealed to your key and stored on QoreChain.
      </p>
    </div>
  );
}
