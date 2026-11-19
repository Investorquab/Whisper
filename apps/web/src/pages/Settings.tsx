import { explainError, keyFingerprint, toQorAddress } from "@whisper/sdk";
import { ArrowLeft, Download, Link2, Lock, ShieldCheck, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Address } from "../components/Address";
import { Button, Notice, VerifiedBadge } from "../components/ui";
import { WalletError } from "../lib/qorex";
import { backupFileName } from "../lib/vault";
import { useSession } from "../state/session";

export function SettingsPage() {
  const s = useSession();
  const me = s.account!.evmAddress;
  const [requestMode, setRequestMode] = useState<boolean>();
  const [state, setState] = useState<{ busy?: boolean; error?: string; note?: string }>({});
  const [possession, setPossession] = useState<boolean>();

  useEffect(() => {
    let live = true;
    s.client.policy(me).then((p) => live && setRequestMode(p.requestMode)).catch(() => undefined);
    s.client.pqcKeyStatus(me).then((st) => live && setPossession(st.possessionProven)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [me, s.client]);

  async function toggleRequestMode() {
    setState({ busy: true });
    try {
      await s.client.waitFor(await s.client.setRequestMode(me, !requestMode));
      setRequestMode(!requestMode);
      setState({ note: !requestMode ? "Request mode is on. New senders must send a contact request first." : "Request mode is off. Anyone can message you directly." });
    } catch (e) {
      setState({ error: e instanceof WalletError ? e.message : explainError(e).message });
    }
  }

  function downloadBackup() {
    if (!s.vault) return;
    const blob = new Blob([JSON.stringify(s.vault, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupFileName(s.vault);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="settings">
      <Link to="/app" className="back-link">
        <ArrowLeft aria-hidden="true" /> Messages
      </Link>
      <h1 className="compose__title">Settings</h1>

      <section className="card stack" aria-labelledby="set-id">
        <h2 id="set-id" className="settings__h">Your inbox</h2>
        <dl className="facts">
          <div>
            <dt>Address</dt>
            <dd>
              <Address value={toQorAddress(me)} label="qor1 address" /> <Address value={me} label="0x address" />
            </dd>
          </div>
          <div>
            <dt>Post-quantum key</dt>
            <dd>{possession ? <VerifiedBadge label="ML-DSA-87, possession proven" /> : "Registered ML-DSA-87 key"}</dd>
          </div>
          {s.chainKey && (
            <div>
              <dt>Inbox key</dt>
              <dd>
                ML-KEM-1024, version {s.chainKey.version ?? 1} <span className="mono small muted">{keyFingerprint(s.chainKey.mlkemPublicKey).slice(0, 18)}…</span>{" "}
                {s.chainKey.cardVerified && <VerifiedBadge label="Card verified" />}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="card stack" aria-labelledby="set-req">
        <h2 id="set-req" className="settings__h">
          <UserCheck aria-hidden="true" className="inline-icon" /> Who can message you
        </h2>
        <p className="muted">
          With request mode on, people you have not accepted can only send a contact request. You see it in Requests and choose to accept or block.
        </p>
        <div className="row">
          <Button variant="secondary" loading={state.busy} disabled={requestMode === undefined} onClick={() => void toggleRequestMode()} aria-pressed={requestMode}>
            {requestMode ? "Turn request mode off" : "Turn request mode on"}
          </Button>
          <span className="muted small">{requestMode === undefined ? "Checking…" : requestMode ? "On" : "Off: anyone can message you"}</span>
        </div>
        {state.error && <Notice tone="danger" title="Not changed">{state.error}</Notice>}
        {state.note && <Notice tone="success">{state.note}</Notice>}
      </section>

      <section className="card stack" aria-labelledby="set-backup">
        <h2 id="set-backup" className="settings__h">
          <ShieldCheck aria-hidden="true" className="inline-icon" /> Backup
        </h2>
        <p className="muted">
          Your inbox key lives only in this browser. The backup file is encrypted with your password; keep it somewhere safe to read your messages on another device.
        </p>
        <Button variant="secondary" icon={<Download />} onClick={downloadBackup} disabled={!s.vault}>
          Download encrypted backup
        </Button>
      </section>

      <section className="card stack" aria-labelledby="set-link">
        <h2 id="set-link" className="settings__h">
          <Link2 aria-hidden="true" className="inline-icon" /> Link your QoreX main account
        </h2>
        <p className="muted">
          Messages sent to your main QoreX account (and its @handle) can reach this inbox. Switch QoreX to your main account, come back to this tab and follow the prompt, then switch back here to publish the link.
        </p>
      </section>

      <section className="card stack" aria-labelledby="set-lock">
        <h2 id="set-lock" className="settings__h">
          <Lock aria-hidden="true" className="inline-icon" /> Lock
        </h2>
        <p className="muted">Locking forgets the decrypted key in this tab. Your password unlocks it again.</p>
        <Button variant="secondary" onClick={s.lock}>
          Lock inbox
        </Button>
      </section>
    </div>
  );
}
