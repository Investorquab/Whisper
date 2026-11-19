import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { applyTheme, initialTheme } from "./components/ThemeToggle";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";

applyTheme(initialTheme());

const WhisperApp = lazy(() => import("./WhisperApp"));

function Loading() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <span className="boot__ring" aria-hidden="true" /> <span className="sr-only">Loading Whisper</span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <WhisperApp />
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
);
