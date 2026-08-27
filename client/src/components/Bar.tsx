import { useCallback, useRef, useState } from "react";

export interface BarProps {
  /** Full length of the clip in seconds. The bar always shows all of it. */
  duration: number;
  /** Seconds unlocked. Everything past this is hatched and un-scrubbable. */
  open: number;
  /** Playhead, in seconds. */
  heard?: number;
  /** Seconds at which the remaining levels unlock. */
  ticks?: number[];
  /** Seconds at which the median player solves it. */
  parTs?: number;
  par?: number;
  onSeek?: (t: number) => void;
  showKnob?: boolean;
}

/**
 * The one real idea in the design: four facts in a single object — where you are,
 * how much is unlocked, where the next unlocks fall, and where the crowd solves.
 *
 * Consolidating those is what let the level ladder, the tries counter and the
 * guess-history list all come off the screen.
 */
export function Bar({ duration, open, heard = 0, ticks = [], parTs, par, onSeek, showKnob }: BarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [shake, setShake] = useState(false);
  const dragging = useRef(false);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const interactive = !!onSeek;

  // Seeing how much tune is still hiding is what makes three notes feel tense.
  const bump = useCallback(() => {
    setShake(false);
    requestAnimationFrame(() => setShake(true));
  }, []);

  const timeAt = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * duration;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const t = timeAt(e.clientX);
    if (t > open + 0.15) { bump(); return; }
    dragging.current = true;
    trackRef.current?.setPointerCapture(e.pointerId);
    onSeek(Math.max(0, Math.min(t, open)));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !onSeek) return;
    onSeek(Math.max(0, Math.min(timeAt(e.clientX), open)));
  };

  const endDrag = () => { dragging.current = false; };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = heard + 0.5;
    else if (e.key === "ArrowLeft") next = heard - 0.5;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = open;
    if (next === null) return;
    e.preventDefault();
    if (next > open + 0.15) { bump(); return; }
    onSeek(Math.max(0, Math.min(next, open)));
  };

  return (
    <div
      className={`bar${parTs !== undefined ? " bar--par" : ""}${shake ? " shake" : ""}`}
      onAnimationEnd={() => setShake(false)}
    >
      <div
        ref={trackRef}
        className={`bar-track${interactive ? "" : " static"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        {...(interactive
          ? {
              role: "slider" as const,
              tabIndex: 0,
              "aria-label": "Position in the whistle",
              "aria-valuemin": 0,
              "aria-valuemax": Math.round(open),
              "aria-valuenow": Math.round(heard),
              "aria-valuetext": `${heard.toFixed(1)} of ${open.toFixed(1)} seconds unlocked`,
            }
          : {})}
      >
        <div className="bar-fills">
          <div className="bar-open" style={{ width: `${pct(open)}%` }} />
          <div className="bar-heard" style={{ width: `${pct(Math.min(heard, open))}%` }} />
          <div className="bar-lock" style={{ left: `${pct(open)}%` }} />
          {ticks.map((t, i) => (
            <i key={i} className="bar-tick" style={{ left: `${pct(t)}%` }} />
          ))}
        </div>
        {showKnob && <span className="bar-knob" style={{ left: `${pct(Math.min(heard, open))}%` }} />}
        {parTs !== undefined && (
          <span className="bar-par" style={{ left: `${pct(parTs)}%` }}>
            <span>par {par}</span>
            <b />
          </span>
        )}
      </div>
    </div>
  );
}
