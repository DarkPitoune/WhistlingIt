import { useEffect } from "react";

/** Typing a space in the guess field must stay a space, not a play command. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Space toggles playback, the way every media player does.
 *
 * Bound to the document rather than to the play button, so it works without
 * having tabbed anywhere first — but it defers when a button already has focus,
 * because the browser turns space into a click there and we would toggle twice.
 */
export function useSpaceToggle(toggle: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.target instanceof HTMLElement && e.target.closest("button")) return;
      e.preventDefault();   // otherwise the page scrolls
      toggle();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggle, enabled]);
}
