import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  id: number;
  kind: "good" | "bad";
  text: string;
}

/** How long a toast stays up. Long enough to read a rejection reason. */
const LIFETIME_MS = 7000;

/**
 * A small stack of notices in the top-right corner.
 *
 * Lives above the router on purpose. An upload is fired and then the booth is
 * left behind — often for the daily — so whatever reports the outcome has to
 * outlive the screen that started it.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = next.current++;
    setToasts((prev) => [...prev, { id, kind, text }]);
    timers.current.push(window.setTimeout(() => dismiss(id), LIFETIME_MS));
  }, [dismiss]);

  return { toasts, push, dismiss };
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    /* aria-live so the outcome is announced: the visual notice can easily be
       missed, and it may be the only report that an upload was rejected. */
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast is-${t.kind}`}>
          <span>{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
