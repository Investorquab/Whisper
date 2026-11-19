import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../state/session";
import { Address } from "./Address";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { Badge } from "./ui";

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="shell__bar">
        <Link to="/" className="shell__home" aria-label="Whisper home">
          <Logo />
        </Link>
        <div className="shell__right">
          {s.account && (
            <span className="shell__account">
              {!s.account.onTestnet && <Badge tone="warn">Wrong network</Badge>}
              {s.account.onTestnet && <Badge tone="neutral">Testnet</Badge>}
              <Address value={s.account.evmAddress} label="Your address" />
            </span>
          )}
          {s.keys && (
            <button type="button" className="icon-btn" aria-label="Lock inbox" title="Lock inbox" onClick={s.lock}>
              <LogOut aria-hidden="true" />
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>
      <main id="main" className="shell__main">
        {children}
      </main>
    </div>
  );
}
