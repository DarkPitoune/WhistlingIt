import { useCallback, useEffect, useRef, useState } from "react";
import { getContext, loadClip } from "./context";

/** Short ramps so cutting the clip mid-note doesn't click. */
const FADE_IN = 0.008;
const FADE_OUT = 0.015;

export interface ClipPlayer {
  loading: boolean;
  ready: boolean;
  error: string | null;
  playing: boolean;
  /** Playhead in seconds. Updates on every frame while playing. */
  pos: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
}

/**
 * Plays `start` → `limit` seconds of a clip, and never past `limit`.
 *
 * `limit` is the unlocked stretch — the end of the last unlocked note. The rest of
 * the file is decoded and sitting in memory, so the gate is purely a scheduling
 * decision: we hand the source node a duration and it stops itself. That keeps the
 * cut sample-accurate instead of depending on a timer firing on time.
 *
 * `start` is the floor, not an offset: the playhead is always an absolute time in
 * the file, so the bar plots it unchanged. It exists because recordings carry dead
 * air at the front — the server reports the first note minus a short lead as
 * `DailyClip.startAt`, and without honouring it the first reveal can be mostly
 * silence. `seek` clamps to it, so "back to the top" means the first note, not 0.
 */
export function useClipPlayer(url: string | null, limit: number, start = 0): ClipPlayer {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(start);

  // Live values for the animation frame loop, which must not close over stale state.
  const limitRef = useRef(limit);
  limitRef.current = limit;
  // Guarded: a clip whose lead-in somehow reaches past the unlocked stretch would
  // otherwise make every span negative and nothing would ever play.
  const startRef = useRef(start);
  startRef.current = Math.max(0, Math.min(start, limit));
  const posRef = useRef(start);

  const nodes = useRef<{ src: AudioBufferSourceNode; gain: GainNode } | null>(null);
  const anchor = useRef({ ctxTime: 0, offset: 0 });
  const raf = useRef(0);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadClip(url).then(
      (b) => { if (!cancelled) { setBuffer(b); setLoading(false); } },
      (e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "could not load the clip");
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, [url]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const n = nodes.current;
    nodes.current = null;
    if (!n) return;
    n.src.onended = null;
    try { n.src.stop(); } catch { /* already stopped */ }
    n.src.disconnect();
    n.gain.disconnect();
  }, []);

  const pause = useCallback(() => {
    teardown();
    setPlaying(false);
  }, [teardown]);

  const play = useCallback(() => {
    if (!buffer) return;
    teardown();

    const ctx = getContext();
    // Reaching the end of the unlocked stretch and pressing play again restarts it —
    // from the first note, not from the top of the file.
    const floor = startRef.current;
    const spent = posRef.current >= limitRef.current - 0.05;
    const from = spent || posRef.current < floor ? floor : posRef.current;
    const span = limitRef.current - from;
    if (span <= 0.01) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();

    const at = ctx.currentTime + 0.03;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(1, at + FADE_IN);
    gain.gain.setValueAtTime(1, at + Math.max(FADE_IN, span - FADE_OUT));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + span);

    src.connect(gain).connect(ctx.destination);
    src.start(at, from, span);

    anchor.current = { ctxTime: at, offset: from };
    nodes.current = { src, gain };
    setPlaying(true);

    src.onended = () => {
      // Fires for a natural finish and for our own stop(); teardown clears the
      // handler first, so only the natural finish reaches here.
      posRef.current = limitRef.current;
      setPos(limitRef.current);
      teardown();
      setPlaying(false);
    };

    const frame = () => {
      const t = anchor.current.offset + Math.max(0, ctx.currentTime - anchor.current.ctxTime);
      const clamped = Math.min(t, limitRef.current);
      posRef.current = clamped;
      setPos(clamped);
      if (clamped < limitRef.current) raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
  }, [buffer, teardown]);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(startRef.current, Math.min(t, limitRef.current));
    posRef.current = clamped;
    setPos(clamped);
  }, []);

  const toggle = useCallback(() => { playing ? pause() : play(); }, [playing, pause, play]);

  // A level unlocking mid-playback would leave the source node scheduled against the
  // old, shorter span. Stop rather than silently truncate.
  useEffect(() => { pause(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [limit]);

  // A different clip means a different floor; don't leave the playhead behind it.
  useEffect(() => {
    posRef.current = startRef.current;
    setPos(startRef.current);
  }, [start]);

  useEffect(() => teardown, [teardown]);

  return { loading, ready: !!buffer, error, playing, pos, play, pause, toggle, seek };
}
