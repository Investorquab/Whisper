import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { InboxPage } from "./pages/Inbox";
import { SetupPage } from "./pages/Setup";
import { useSession } from "./state/session";

function AppHome() {
  const s = useSession();
  const ready = s.account?.kind === "ethereum" && s.account.onTestnet && s.keys && s.keysMatchChain;
  return ready ? <InboxPage /> : <SetupPage />;
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/app" element={<AppHome />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AppShell>
  );
}
