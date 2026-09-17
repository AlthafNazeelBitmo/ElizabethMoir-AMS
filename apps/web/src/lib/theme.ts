import { useEffect, useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the operating system says. The choice is kept in
 * this browser only; it is a preference of the person at the desk, not a
 * setting of the school.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ams.theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system")
      return stored;
  } catch {
    // Private windows and blocked storage fall through to the default.
  }
  return "system";
}

let current: Theme = read();

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolvedTheme(theme: Theme = current): "light" | "dark" {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

/** Applies the class the stylesheet keys on; idempotent. */
export function applyTheme(theme: Theme = current): void {
  const root = document.documentElement;
  const dark = resolvedTheme(theme) === "dark";
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted; it still applies for this page.
  }
  applyTheme(theme);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    () => current,
    () => "system",
  );

  // Follow the operating system while "system" is chosen.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (current === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return [theme, setTheme];
}
