import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { applyTheme, initialTheme } from "./components/ThemeToggle";
import { SessionProvider } from "./state/session";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/app.css";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
