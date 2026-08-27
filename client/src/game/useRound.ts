import { useCallback, useMemo, useRef, useState } from "react";
import type { DailyClip, TryKind } from "../api";
import { api } from "../api";
import { isRight } from "./match";
import { makeLadder, unlockedSeconds } from "./levels";
import { loadRound, loadStreak, recordResult, saveRound } from "./storage";

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
  done: null | { won: boolean };
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
  miss: () => void;
  skip: () => void;
}

export function useRound(clip: DailyClip): Round {
  const ladder = useMemo(() => makeLadder(clip.noteStarts.length), [clip.noteStarts.length]);

  const saved = useMemo(() => loadRound(clip.date, clip.id), [clip.date, clip.id]);
  const [level, setLevel] = useState(() => Math.min(saved?.level ?? 0, ladder.length - 1));
  const [tape, setTape] = useState<TryKind[]>(() => saved?.tape ?? []);
  const [done, setDone] = useState<null | { won: boolean }>(() => saved?.done ?? null);
  const [streak, setStreak] = useState(() => loadStreak());
  const [bumped, setBumped] = useState(false);

  // The round can only end once, however it ends.
  const settled = useRef(saved?.done != null);

  const persist = useCallback(
    (next: { level: number; tape: TryKind[]; done: null | { won: boolean } }) => {
      saveRound({ date: clip.date, clipId: clip.id, ...next });
    },
    [clip.date, clip.id],
  );

  const finish = useCallback(
    (won: boolean, atLevel: number, finalTape: TryKind[]) => {
      if (settled.current) return;
      settled.current = true;
      setDone({ won });
      setStreak(recordResult(won));
      persist({ level: atLevel, tape: finalTape, done: { won } });
      void api
        .submitRound({
          clipId: clip.id,
          date: clip.date,
          won,
          solvedAtNote: ladder[atLevel] ?? clip.noteStarts.length,
          tape: finalTape,
        })
        .catch((e: unknown) => console.warn("[round] submit failed, kept locally", e));
    },
    [clip.id, clip.date, clip.noteStarts.length, ladder, persist],
  );

  /** A miss: buy the next note, or end the round if there are none left. */
  const spend = useCallback(
    (kind: TryKind) => {
      if (done) return;
      const nextTape = [...tape, kind];
      setTape(nextTape);

      if (level >= ladder.length - 1) {
        finish(false, level, nextTape);
        return;
      }
      const nextLevel = level + 1;
      setLevel(nextLevel);
      setBumped(true);
      // One frame of the flip animation, then clear so a re-render doesn't replay it.
      requestAnimationFrame(() => requestAnimationFrame(() => setBumped(false)));
      persist({ level: nextLevel, tape: nextTape, done: null });
    },
    [done, tape, level, ladder.length, finish, persist],
  );

  const check = useCallback(
    (text: string) => !done && isRight(text, clip.accepted),
    [done, clip.accepted],
  );

  const solve = useCallback(() => {
    if (!done) finish(true, level, tape);
  }, [done, finish, level, tape]);

  const miss = useCallback(() => spend("wrong"), [spend]);
  const skip = useCallback(() => spend("skip"), [spend]);

  const notes = ladder[level] ?? clip.noteStarts.length;

  return {
    notes,
    total: clip.noteStarts.length,
    unlocked: unlockedSeconds(clip, notes),
    ladder,
    level,
    tape,
    done,
    streak,
    bumped,
    nextNotes: level < ladder.length - 1 ? (ladder[level + 1] ?? null) : null,
    check,
    solve,
    miss,
    skip,
  };
}
