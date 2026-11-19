import {
  cardStatement,
  generateInboxKeys,
  inboxKeysFromSeed,
  keyFingerprint,
  linkStatement,
  toQorAddress,
  type InboxKeys,
  type WhisperLinkProof,
} from "@whisper/sdk";
import { ArrowRight, Download, ExternalLink, KeyRound, Link2, ShieldCheck, Upload, Wallet } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { formatEther } from "viem";
import { Address } from "../components/Address";
import { Button, Notice, Spinner, Steps, TextField, type StepItem } from "../components/ui";
import { FAUCET_URL, QOREX_INSTALL_URL, signStatement, WalletError } from "../lib/qorex";
import { getItem, INBOX_KEY, PENDING_LINK_KEY, setItem } from "../lib/storage";
import { backupFileName, checkPassword, openVault, parseBackup, saveVault, sealVault, VaultError, type VaultRecord } from "../lib/vault";
import { useSession } from "../state/session";

/** Enough for the key publication: QoreX's window transaction (~0.045 QOR) plus the call itself. */
const MIN_SETUP_BALANCE = 80_000_000_000_000_000n; // 0.08 QOR

const STEPS: StepItem[] = [
  { key: "wallet", title: "Connect QoreX", description: "Your post-quantum wallet signs everything." },
  { key: "account", title: "Use an Ethereum account", description: "Whisper runs on QoreChain's EVM lane." },
  { key: "key", title: "Create your inbox key", description: "ML-KEM-1024, made and kept in this browser." },
  { key: "card", title: "Sign your Whisper card", description: "Binds the key to you with ML-DSA-87." },
  { key: "publish", title: "Publish on chain", description: "So anyone can write to you." },
];

function downloadBackup(record: VaultRecord) {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(record);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function message(error: unknown): string {
  if (error instanceof WalletError || error instanceof VaultError) return error.message;
  const m = (error as { message?: string })?.message;
  return m ? m.split("\n")[0]! : "Something went wrong. Try again.";
}

export function SetupPage({ returnTo = "/app" }: { returnTo?: string }) {
  const s = useSession();
  const navigate = useNavigate();

  const done = new Set<string>();
  let current = "wallet";
  if (s.status === "connected" && s.account?.onTestnet) {
    done.add("wallet");
    current = "account";
    if (s.account.kind === "ethereum") {
      done.add("account");
      current = "key";
      if (s.chainKey) {
        done.add("key").add("card").add("publish");
        current = "publish";
      } else if (s.vault) {
        done.add("key");
        current = "card";
      }
    }
  }

  const returning = Boolean(
    s.account?.kind === "ethereum" && s.chainKey && s.vault && s.vault.keyFingerprint === keyFingerprint(s.chainKey.mlkemPublicKey) && !getItem(PENDING_LINK_KEY),
  );
  if (returning) {
    return (
      <div className="setup setup--compact">
        <section className="setup__panel card" aria-live="polite">
          <SetupBody onReady={() => navigate(returnTo, { replace: true })} />
        </section>
      </div>
    );
  }

  return (
    <div className="setup">
      <aside className="setup__aside">
        <p className="eyebrow">Set up your inbox</p>
        <h1 className="setup__title">Your private, post‑quantum inbox on QoreChain</h1>
        <p className="muted">Five steps, about two minutes. Nothing leaves your browser unencrypted.</p>
        <Steps steps={STEPS} current={current} done={done} />
      </aside>
      <section className="setup__panel card" aria-live="polite">
        <SetupBody onReady={() => navigate(returnTo, { replace: true })} />
      </section>
    </div>
  );
}

function SetupBody({ onReady }: { onReady: () => void }) {
  const s = useSession();

  if (s.status === "detecting") return <Centered><Spinner label="Looking for QoreX" /><p className="muted">Looking for QoreX…</p></Centered>;

  if (s.status === "missing") {
    return (
      <div className="stack">
        <PanelHead icon={<Wallet />} title="Install QoreX" />
        <p>Whisper uses QoreX, QoreChain's post-quantum wallet. Every action you take is signed with your ML-DSA-87 key inside QoreX.</p>
        <div className="row">
          <a className="btn btn--primary btn--md" href={QOREX_INSTALL_URL} target="_blank" rel="noreferrer">
            Get QoreX for Chrome <ExternalLink aria-hidden="true" className="btn__icon" />
          </a>
          <Button variant="secondary" onClick={() => window.location.reload()}>I installed it</Button>
        </div>
        <p className="muted small">On a phone, open this page inside the QoreX app's browser.</p>
      </div>
    );
  }

  if (s.status === "disconnected") return <ConnectStep />;

  const account = s.account!;
  if (!account.onTestnet) {
    return (
      <div className="stack">
        <PanelHead icon={<Wallet />} title="Switch QoreX to testnet" />
        <p>Whisper runs on QoreChain testnet (diana) during Build Before Q-Day. QoreX is on mainnet right now.</p>
        <ol className="howto">
          <li>Open QoreX and scroll to the version number at the bottom.</li>
          <li>Tap the version number seven times to turn on Developer mode.</li>
          <li>Tap <strong>Switch to testnet (diana)</strong>, then come back here.</li>
        </ol>
        <Button variant="secondary" onClick={() => void s.refresh()}>I switched</Button>
      </div>
    );
  }

  if (account.kind === "main") return <MainAccountStep />;
  if (s.chainKey === null || s.vault === null) return <Centered><Spinner label="Reading your inbox" /><p className="muted">Reading your inbox from QoreChain…</p></Centered>;

  const pendingLink = getItem(PENDING_LINK_KEY);
  if (pendingLink && s.chainKey) return <PublishLinkStep proofJson={pendingLink} />;

  if (s.chainKey && s.vault && s.vault.keyFingerprint === keyFingerprint(s.chainKey.mlkemPublicKey)) {
    return <UnlockStep onReady={onReady} />;
  }
  if (s.chainKey) return <RestoreStep onReady={onReady} />;
  return <CreateStep onReady={onReady} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}

function PanelHead({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="panel-head">
      <span className="panel-head__icon" aria-hidden="true">{icon}</span>
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
    </div>
  );
}

function ConnectStep() {
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <div className="stack">
      <PanelHead icon={<Wallet />} title="Connect QoreX" subtitle="Whisper asks QoreX for your address. It never sees your keys." />
      {error && <Notice tone="danger" title="Could not connect">{error}</Notice>}
      <Button
        size="lg"
        loading={busy}
        icon={<ArrowRight />}
        onClick={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await s.connect();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Connect QoreX
      </Button>
    </div>
  );
}

function MainAccountStep() {
  const s = useSession();
  const account = s.account!;
  const inbox = getItem(INBOX_KEY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [signed, setSigned] = useState(Boolean(getItem(PENDING_LINK_KEY)));

  if (inbox && !signed) {
    return (
      <div className="stack">
        <PanelHead icon={<Link2 />} title="Link your main account" subtitle="So messages sent to your main address and @handle reach your inbox." />
        <p>
          QoreX is on your main account <Address value={account.qorAddress} />. Sign once to say your Whisper inbox is <Address value={inbox} />.
        </p>
        {error && <Notice tone="danger" title="Not signed">{error}</Notice>}
        <Button
          loading={busy}
          icon={<KeyRound />}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const statement = linkStatement({ account: account.qorAddress, inbox, chainId: s.client.network.chainId });
              const signature = await signStatement(s.qorex!, account.qorAddress, statement);
              const proof: WhisperLinkProof & { account: string } = { v: 1, statement, signature, account: account.qorAddress };
              setItem(PENDING_LINK_KEY, JSON.stringify(proof));
              setSigned(true);
            } catch (e) {
              setError(message(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign the link in QoreX
        </Button>
      </div>
    );
  }

  return (
    <div className="stack">
      <PanelHead icon={<Wallet />} title={signed ? "Now switch back to your Ethereum account" : "Use an Ethereum account in QoreX"} />
      {signed ? (
        <p>Your link is signed. Switch QoreX back to your Ethereum account to publish it, then return to this tab.</p>
      ) : (
        <>
          <p>
            QoreX is on your main QoreChain account. That account cannot use QoreChain's EVM lane, where Whisper's mailbox lives, so Whisper uses an <strong>Ethereum account</strong> from the same recovery phrase.
          </p>
          <ol className="howto">
            <li>Open QoreX and choose <strong>Your accounts</strong>.</li>
            <li>Tap <strong>Add an Ethereum account (coin 60)</strong>, then <strong>Use</strong> it.</li>
            <li>Send it a little test QOR (about 0.2) and come back to this tab.</li>
          </ol>
          <p className="muted small">After setup you can link this main account, so messages to it (and to your @handle) reach your inbox.</p>
        </>
      )}
      <Button variant="secondary" onClick={() => void s.refresh()}>I switched accounts</Button>
    </div>
  );
}

function useBalance(address: string | undefined) {
  const s = useSession();
  const [balance, setBalance] = useState<bigint>();
  useEffect(() => {
    if (!address) return;
    let live = true;
    s.client.publicClient
      .getBalance({ address: address as `0x${string}` })
      .then((b) => live && setBalance(b))
      .catch(() => live && setBalance(undefined));
    return () => {
      live = false;
    };
  }, [address, s.client]);
  return balance;
}

/** New inbox, or finishing one whose key was made here but not yet published. */
function CreateStep({ onReady }: { onReady: () => void }) {
  const s = useSession();
  const account = s.account!;
  const balance = useBalance(account.evmAddress);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; flow?: string }>({});
  const [phase, setPhase] = useState<"idle" | "sealing" | "signing" | "publishing" | "done">("idle");
  const [keys, setKeys] = useState<InboxKeys>();
  const [record, setRecord] = useState<VaultRecord>();
  const resuming = Boolean(s.vault);

  useEffect(() => setItem(INBOX_KEY, account.evmAddress), [account.evmAddress]);

  const lowBalance = balance !== undefined && balance < MIN_SETUP_BALANCE;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    let k = keys;
    let rec = record ?? s.vault ?? undefined;
    if (!k) {
      if (resuming && rec) {
        try {
          k = inboxKeysFromSeed(await openVault(rec, password));
        } catch (err) {
          setErrors({ password: message(err) });
          return;
        }
      } else {
        next.password = checkPassword(password);
        if (!next.password && password !== confirm) next.confirm = "The two passwords do not match.";
        if (next.password || next.confirm) {
          setErrors(next);
          return;
        }
        setPhase("sealing");
        k = generateInboxKeys();
        rec = await sealVault({ account: account.evmAddress, seed: k.seed, password, keyFingerprint: keyFingerprint(k.mlkemPublicKey) });
        await saveVault(rec);
      }
      setKeys(k);
      setRecord(rec);
    }
    setErrors({});
    try {
      setPhase("signing");
      const statement = cardStatement({ account: account.evmAddress, chainId: s.client.network.chainId, mlkemPublicKey: k.mlkemPublicKey, issuedAt: new Date().toISOString() });
      const signature = await signStatement(s.qorex!, account.qorAddress, statement);
      setPhase("publishing");
      const hash = await s.client.publishKey(account.evmAddress, k.mlkemPublicKey, { v: 1, statement, signature });
      await s.client.waitFor(hash);
      s.setKeys(k);
      setPhase("done");
      await s.refresh();
    } catch (err) {
      setPhase("idle");
      setErrors({ flow: message(err) });
    }
  }

  if (phase === "done" && record) {
    return (
      <div className="stack">
        <PanelHead icon={<ShieldCheck />} title="Your inbox is live" subtitle="Anyone on QoreChain can now send you sealed messages." />
        <Notice tone="warn" title="Save a backup of your inbox key">
          Your key exists only in this browser. Without a backup, clearing the browser loses access to your messages. The file is encrypted with your password.
        </Notice>
        <div className="row">
          <Button variant="secondary" icon={<Download />} onClick={() => downloadBackup(record)}>Download backup</Button>
          <Button icon={<ArrowRight />} onClick={onReady}>Open my inbox</Button>
        </div>
        <LinkLater />
      </div>
    );
  }

  const busy = phase !== "idle";
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <PanelHead
        icon={<KeyRound />}
        title={resuming ? "Finish setting up your inbox" : "Create your inbox key"}
        subtitle={resuming ? "Your key is already in this browser. Unlock it to sign and publish." : "Your ML-KEM-1024 key is made in this browser and encrypted with your password."}
      />
      <p className="row muted small">Inbox account <Address value={account.evmAddress} /></p>
      {lowBalance && (
        <Notice tone="warn" title="Add test QOR first" action={<a className="btn btn--secondary btn--md" href={FAUCET_URL} target="_blank" rel="noreferrer">Open the faucet <ExternalLink className="btn__icon" aria-hidden="true" /></a>}>
          This account has {formatEther(balance!)} QOR. Publishing your key needs about 0.08 QOR in fees. Send some from your main account in QoreX or use the faucet.
        </Notice>
      )}
      <TextField
        label={resuming ? "Password" : "Choose a password"}
        type="password"
        autoComplete={resuming ? "current-password" : "new-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        hint={resuming ? undefined : "At least 10 characters. It encrypts your key in this browser and in your backup file. Whisper cannot recover it."}
        disabled={busy}
        required
      />
      {!resuming && (
        <TextField label="Repeat the password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} disabled={busy} required />
      )}
      {errors.flow && <Notice tone="danger" title="Setup stopped">{errors.flow}</Notice>}
      <Button type="submit" size="lg" loading={busy} disabled={lowBalance}>
        {phase === "sealing" ? "Creating your key…" : phase === "signing" ? "Approve the card in QoreX…" : phase === "publishing" ? "Approve and wait for QoreChain…" : resuming ? "Unlock, sign and publish" : "Create, sign and publish"}
      </Button>
      <p className="muted small">QoreX will ask you twice: once to sign your card (no fee), then to publish it (two taps, a small fee).</p>
    </form>
  );
}

function UnlockStep({ onReady }: { onReady: () => void }) {
  const s = useSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setItem(INBOX_KEY, s.account!.evmAddress), [s.account]);
  if (s.keys && s.keysMatchChain) {
    return (
      <div className="stack">
        <PanelHead icon={<ShieldCheck />} title="Your inbox is unlocked" />
        <Button icon={<ArrowRight />} onClick={onReady}>Open my inbox</Button>
        <LinkLater />
      </div>
    );
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await s.unlock(password);
          onReady();
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <PanelHead icon={<KeyRound />} title="Welcome back" subtitle="Unlock your inbox. Your key is stored encrypted in this browser." />
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
      <Button type="submit" size="lg" loading={busy}>Unlock</Button>
    </form>
  );
}

function RestoreStep({ onReady }: { onReady: () => void }) {
  const s = useSession();
  const account = s.account!;
  const [record, setRecord] = useState<VaultRecord>();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!record) return setError("Choose your backup file first.");
        setBusy(true);
        setError(undefined);
        try {
          const keys = inboxKeysFromSeed(await openVault(record, password));
          if (keyFingerprint(keys.mlkemPublicKey) !== keyFingerprint(s.chainKey!.mlkemPublicKey)) {
            throw new Error("This backup holds an older key than the one published for this account.");
          }
          await saveVault(record);
          s.setKeys(keys);
          await s.refresh();
          onReady();
        } catch (err) {
          setError(message(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <PanelHead icon={<Upload />} title="Restore your inbox" subtitle="This account already has a Whisper key, but it is not stored in this browser." />
      <div className="field">
        <label className="field__label" htmlFor="backup-file">Backup file</label>
        <input
          id="backup-file"
          className="input"
          type="file"
          accept="application/json,.json"
          onChange={async (e) => {
            setError(undefined);
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              setRecord(parseBackup(await file.text(), account.evmAddress));
            } catch (err) {
              setRecord(undefined);
              setError(message(err));
            }
          }}
        />
        <p className="field__hint">The <code>whisper-inbox-…-backup.json</code> file you saved when you set up.</p>
      </div>
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <Notice tone="danger" title="Not restored">{error}</Notice>}
      <Button type="submit" size="lg" loading={busy}>Restore inbox</Button>
      <p className="muted small">Lost your backup? You can publish a new key from this account later, but messages sealed to the old key stay unreadable.</p>
    </form>
  );
}

function LinkLater() {
  const s = useSession();
  return (
    <div className="link-later">
      <Link2 aria-hidden="true" />
      <p>
        Have a QoreX main account or @handle? Switch QoreX to it and reopen this page to link it to <Address value={s.account!.evmAddress} />. Messages to <span className="mono">{toQorAddress(s.account!.evmAddress).slice(0, 10)}…</span> already reach you.
      </p>
    </div>
  );
}

function PublishLinkStep({ proofJson }: { proofJson: string }) {
  const s = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  let proof: (WhisperLinkProof & { account: string }) | undefined;
  try {
    proof = JSON.parse(proofJson);
  } catch {
    proof = undefined;
  }
  if (!proof) {
    setItem(PENDING_LINK_KEY, undefined);
    return null;
  }
  if (done) {
    return (
      <div className="stack">
        <PanelHead icon={<ShieldCheck />} title="Main account linked" subtitle="Messages to it now reach this inbox." />
        <Button variant="secondary" onClick={() => void s.refresh()}>Continue</Button>
      </div>
    );
  }
  return (
    <div className="stack">
      <PanelHead icon={<Link2 />} title="Publish your link" subtitle="One transaction from your inbox account." />
      <p>
        <Address value={proof.account} /> signed that its messages go to <Address value={s.account!.evmAddress} />.
      </p>
      {error && <Notice tone="danger" title="Not published">{error}</Notice>}
      <div className="row">
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const hash = await s.client.link(s.account!.evmAddress, proof!.account, { v: 1, statement: proof!.statement, signature: proof!.signature });
              await s.client.waitFor(hash);
              setItem(PENDING_LINK_KEY, undefined);
              setDone(true);
            } catch (err) {
              setError(message(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Publish link
        </Button>
        <Button variant="ghost" onClick={() => { setItem(PENDING_LINK_KEY, undefined); void s.refresh(); }}>Discard</Button>
      </div>
    </div>
  );
}
