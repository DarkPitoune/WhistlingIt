import { useCallback, useEffect, useRef, useState } from "react";
import { loadClip, setAudioSession, unlock } from "./context";

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
  /** Resolves once the clip is actually rolling — it waits for the context to resume. */
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  /**
   * Move the playhead by `seconds`, forward or back, keeping playback going.
   *
   * Clamped to the same floor and ceiling as `seek`, so nudging forward cannot
   * reach past the unlocked stretch and nudging back stops at the first note
   * rather than at second zero.
   */
  nudge: (seconds: number) => void;
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
  /**
   * Bumped by every teardown. `play` has to wait for the audio context to resume,
   * so it gives up the gesture and can come back to find that a pause, a new level
   * or an unmount happened in the meantime. Only the newest attempt may schedule.
   */
  const gen = useRef(0);

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
    gen.current++;
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

  const play = useCallback(async () => {
    if (!buffer) return;
    teardown();
    const mine = gen.current;

    // Everything that decides whether to play at all is settled before the await,
    // so a refusal stays synchronous and never has to undo `playing`.
    //
    // Reaching the end of the unlocked stretch and pressing play again restarts it —
    // from the first note, not from the top of the file.
    const floor = startRef.current;
    const spent = posRef.current >= limitRef.current - 0.05;
    const from = spent || posRef.current < floor ? floor : posRef.current;
    const span = limitRef.current - from;
    if (span <= 0.01) return;

    // Optimistic, because the first resume of a session is not instant and a play
    // button that ignores the first tap reads as broken. Every path that can make
    // us bail below either sets `playing` false itself (pause, the level-change
    // effect, a natural finish) or is a second `play` that sets it true again.
    setPlaying(true);

    // Both of these are iOS, and both have to be settled before `at` is computed.
    // A Web-Audio-only page sits in the `ambient` session, which the ringer switch
    // mutes; and a context that hasn't finished resuming has a frozen clock, so
    // scheduling against it starts nothing at all. `unlock` fires resume() inside
    // this gesture and hands back the wait.
    setAudioSession("playback");
    const ctx = await unlock();

    // The await outlived the gesture: a pause, a level unlock or an unmount may
    // have landed while we waited, and each of those bumped the generation.
    if (gen.current !== mine) return;

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

  const nudge = useCallback((seconds: number) => {
    // posRef, not `pos`: while playing, state trails the frame loop by up to a
    // frame, and nudging twice quickly off stale state would lose the first jump.
    const ceiling = limitRef.current;
    const target = Math.max(startRef.current, Math.min(posRef.current + seconds, ceiling));
    seek(target);
    if (!playing) return;

    // Landing on the ceiling is the same event as playback reaching it, so stop
    // there. Calling `play` instead would hit its restart-from-the-top rule —
    // a playhead at the end means "press play again to replay" — and nudging
    // forward would silently start the clip over, which it did.
    if (target >= ceiling - 0.05) {
      pause();
      return;
    }
    // Playback is a scheduled source node with a fixed span, so moving the
    // playhead means re-scheduling. `play` tears the old node down itself.
    void play();
  }, [seek, playing, play, pause]);

  const toggle = useCallback(() => { if (playing) pause(); else void play(); }, [playing, pause, play]);

  // A level unlocking mid-playback would leave the source node scheduled against the
  // old, shorter span. Stop rather than silently truncate.
  useEffect(() => { pause(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [limit]);

  // A different clip means a different floor; don't leave the playhead behind it.
  useEffect(() => {
    posRef.current = startRef.current;
    setPos(startRef.current);
  }, [start]);

  useEffect(() => teardown, [teardown]);

  return { loading, ready: !!buffer, error, playing, pos, play, pause, toggle, seek, nudge };
}
