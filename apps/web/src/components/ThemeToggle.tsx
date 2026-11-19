import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "whisper-theme";

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    /* storage blocked */
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || initialTheme());
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
  }, [theme]);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" className="icon-btn" aria-label={`Switch to ${next} theme`} onClick={() => setTheme(next)}>
      {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
