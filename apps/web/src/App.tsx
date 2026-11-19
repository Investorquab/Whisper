import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CheckPage } from "./pages/Check";
import { ComposePage } from "./pages/Compose";
import { InboxPage, MessageLinkPage } from "./pages/Inbox";
import { SettingsPage } from "./pages/Settings";
import { MailboxProvider } from "./state/mailbox";
import { SetupPage } from "./pages/Setup";
import { useSession } from "./state/session";

/** Shows setup (or unlock) until the inbox is ready, then the requested page. Deep links survive setup. */
function RequireInbox({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const location = useLocation();
  const ready = s.account?.kind === "ethereum" && s.account.onTestnet && s.keys && s.keysMatchChain;
  return ready ? <MailboxProvider>{children}</MailboxProvider> : <SetupPage returnTo={location.pathname + location.search + location.hash} />;
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<RequireInbox><InboxPage /></RequireInbox>} />
        <Route path="/app/c/:peer" element={<RequireInbox><InboxPage /></RequireInbox>} />
        <Route path="/app/m/:tx" element={<RequireInbox><MessageLinkPage /></RequireInbox>} />
        <Route path="/app/settings" element={<RequireInbox><SettingsPage /></RequireInbox>} />
        <Route path="/app/new" element={<RequireInbox><ComposePage /></RequireInbox>} />
        <Route path="/to/:address" element={<RequireInbox><ComposePage /></RequireInbox>} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/check" element={<CheckPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AppShell>
  );
}
