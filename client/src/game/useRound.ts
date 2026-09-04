import { useCallback, useMemo, useRef, useState } from "react";
import type { DailyClip, TryKind } from "../api";
import { api } from "../api";
import { useI18n } from "../i18n/useI18n";
import { acceptedFor, isRight } from "./match";
import { makeLadder, unlockedSeconds } from "./levels";
import { isRecovered, loadRound, loadStreak, recordResult, saveRound } from "./storage";

export interface Round {
  /** How many notes are unlocked right now. */
  notes: number;
  /** Total notes in the clip. */
  total: number;
  /** Seconds of clip unlocked. What the player is allowed to hear. */
  unlocked: number;
  ladder: number[];
  level: number;
  tape: TryKind[];
  /** Every wrong guess this round, oldest first. Stays on screen until the round ends. */
  wrongGuesses: string[];
  done: null | { won: boolean };
  /**
   * True when `done` was deduced from an old streak rather than played.
   *
   * The day was won — that much the streak proves — but the tape, the note it
   * fell on and the guesses along the way were never kept, so the reveal has to
   * say less than usual instead of showing an empty tape as if it meant nothing.
   */
  recovered: boolean;
  /**
   * True only when the round ended during *this* mount, not when it was restored
   * from storage.
   *
   * The clip's solve counts were fetched before the round started, so they do not
   * include the result just recorded. The reveal adds it — but only once: on a
   * later visit the server's counts already contain it, and adding again would
   * count the player twice.
   */
  justFinished: boolean;
  streak: number;
  /** True for one render after a level unlocks, to drive the count's flip animation. */
  bumped: boolean;
  /** How many notes the next miss would buy, or null on the last rung. */
  nextNotes: number | null;
  /** Pure match against the accepted answers. Changes nothing. */
  check: (text: string) => boolean;
  /** End the round as a win. */
  solve: () => void;
  /** Spend a note on a wrong guess. Kept separate from `check` so the screen can let
   *  the struck-through guess land before the count flips over it. */
  miss: (text: string) => void;
  skip: () => void;
  /** Throw away a recovered result and play the day properly. */
  replay: () => void;
}

export function useRound(clip: DailyClip): Round {
  // The side comes from the context rather than a prop: every caller of
  // `useRound` is already inside the provider, and it is the same value for the
  // whole mount. What it must never do is default — the storage calls below are
  // the ones that would silently read the other side's history.
  const { lang } = useI18n();
  const ladder = useMemo(() => makeLadder(clip.noteStarts.length), [clip.noteStarts.length]);

  // For a film or a series this also accepts the credit line, so naming the
  // composer counts as getting it.
  const accepted = useMemo(() => acceptedFor(clip), [clip]);

  const saved = useMemo(() => loadRound(clip.date, clip.id, lang), [clip.date, clip.id, lang]);
  const [level, setLevel] = useState(() => Math.min(saved?.level ?? 0, ladder.length - 1));
  const [tape, setTape] = useState<TryKind[]>(() => saved?.tape ?? []);
  const [wrongGuesses, setWrongGuesses] = useState<string[]>(() => saved?.guesses ?? []);
  const [done, setDone] = useState<null | { won: boolean }>(() => saved?.done ?? null);
  const [recovered, setRecovered] = useState(() => !!saved && isRecovered(saved));
  const [streak, setStreak] = useState(() => loadStreak(lang));
  const [bumped, setBumped] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  // The round can only end once, however it ends.
  const settled = useRef(saved?.done != null);

  const persist = useCallback(
    (next: { level: number; tape: TryKind[]; guesses: string[]; done: null | { won: boolean } }) => {
      saveRound({ date: clip.date, clipId: clip.id, ...next }, lang);
    },
    [clip.date, clip.id, lang],
  );

  const finish = useCallback(
    (won: boolean, atLevel: number, finalTape: TryKind[], finalGuesses: string[]) => {
      if (settled.current) return;
      settled.current = true;
      setJustFinished(true);
      setDone({ won });
      // Past days are playable from the calendar but never move the streak.
      setStreak(recordResult(won, clip.date, lang));
      persist({ level: atLevel, tape: finalTape, guesses: finalGuesses, done: { won } });
      void api
        .submitRound({
          clipId: clip.id,
          date: clip.date,
          won,
          // `atLevel` is the 0-based index into the ladder; the score is the
          // rung itself, counted from one.
          solvedAtLevel: atLevel + 1,
          tape: finalTape,
        })
        .catch((e: unknown) => console.warn("[round] submit failed, kept locally", e));
    },
    [clip.id, clip.date, clip.noteStarts.length, ladder, persist, lang],
  );

  /** A miss: buy the next note, or end the round if there are none left. */
  const spend = useCallback(
    (kind: TryKind, text?: string) => {
      if (done) return;
      const nextTape = [...tape, kind];
      const nextGuesses = text ? [...wrongGuesses, text] : wrongGuesses;
      setTape(nextTape);
      if (text) setWrongGuesses(nextGuesses);

      if (level >= ladder.length - 1) {
        finish(false, level, nextTape, nextGuesses);
        return;
      }
      const nextLevel = level + 1;
      setLevel(nextLevel);
      setBumped(true);
      // One frame of the flip animation, then clear so a re-render doesn't replay it.
      requestAnimationFrame(() => requestAnimationFrame(() => setBumped(false)));
      persist({ level: nextLevel, tape: nextTape, guesses: nextGuesses, done: null });
    },
    [done, tape, wrongGuesses, level, ladder.length, finish, persist],
  );

  const check = useCallback(
    (text: string) => !done && isRight(text, accepted),
    [done, accepted],
  );

  const solve = useCallback(() => {
    if (!done) finish(true, level, tape, wrongGuesses);
  }, [done, finish, level, tape, wrongGuesses]);

  const miss = useCallback((text: string) => spend("wrong", text), [spend]);
  const skip = useCallback(() => spend("skip"), [spend]);

  /**
   * Drop a recovered result and start the day from note one.
   *
   * Deliberately writes nothing. A recovered ✓ is the only trace left of that
   * day, so it survives until a real round replaces it — walking away mid-replay,
   * or closing the tab, leaves the square exactly as it was. `settled` reopens so
   * the new round can end and be saved over the top; if it ends in a miss, that
   * is a real result and it is allowed to win.
   */
  const replay = useCallback(() => {
    setRecovered(false);
    setLevel(0);
    setTape([]);
    setWrongGuesses([]);
    setDone(null);
    setJustFinished(false);
    settled.current = false;
  }, []);

  const notes = ladder[level] ?? clip.noteStarts.length;

  return {
    notes,
    total: clip.noteStarts.length,
    unlocked: unlockedSeconds(clip, notes),
    ladder,
    level,
    tape,
    wrongGuesses,
    done,
    recovered,
    justFinished,
    streak,
    bumped,
    nextNotes: level < ladder.length - 1 ? (ladder[level + 1] ?? null) : null,
    check,
    solve,
    miss,
    skip,
    replay,
  };
}
