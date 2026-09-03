import { useCallback, useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "./icons";

/**
 * Light/dark, with the system as the default.
 *
 * Three states, two of them on disk: nothing stored means "follow the system",
 * and the toggle writes an explicit "light" or "dark" that then wins. That is why
 * the attribute is *removed* rather than set for the system case — tokens.css
 * resolves it through `prefers-color-scheme` on its own, so leaving it alone keeps
 * the system as the genuine default instead of a value frozen at first visit.
 *
 * There is no way back to "follow the system" from this button. A three-way
 * control is a lot of interface for a game with seven elements on screen, and
 * clearing site data is the escape hatch. Worth revisiting if anyone asks.
 */
const KEY = "whistlingit.theme";

type Choice = "light" | "dark";

function stored(): Choice | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;   // private mode
  }
}

const systemPrefers = (): Choice =>
  matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

function apply(choice: Choice | null): void {
  const root = document.documentElement;
  if (choice) root.dataset.theme = choice;
  else delete root.dataset.theme;
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice | null>(stored);
  // What is actually on screen, which is what the button has to label itself by.
  const [system, setSystem] = useState<Choice>(systemPrefers);
  const active: Choice = choice ?? system;

  // index.html applies the stored choice before first paint; this keeps the
  // attribute in step afterwards, and clears it if the choice is ever dropped.
  useEffect(() => { apply(choice); }, [choice]);

  // Only meaningful while following the system, but harmless to keep listening:
  // a phone that flips to dark at sunset should take the app with it.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const flip = useCallback(() => {
    const next: Choice = active === "dark" ? "light" : "dark";
    setChoice(next);
    try { localStorage.setItem(KEY, next); } catch { /* not fatal */ }
  }, [active]);

  return (
    <button
      className="theme-toggle"
      onClick={flip}
      // The label names the destination, not the state — a switch that says
      // "Dark" is ambiguous about which way it is pointing.
      aria-label={active === "dark" ? "Switch to the light theme" : "Switch to the dark theme"}
      title={active === "dark" ? "Light theme" : "Dark theme"}
    >
      {/* The icon shows where you are going, matching the label. */}
      {active === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
