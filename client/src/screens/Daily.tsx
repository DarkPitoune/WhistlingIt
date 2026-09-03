import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyClip } from "../api";
import { Bar } from "../components/Bar";
import { GoIcon, PauseIcon, PlayIcon } from "../components/icons";
import { useClipPlayer } from "../audio/useClipPlayer";
import { useSpaceToggle } from "../audio/useSpaceToggle";
import { difficultyFor, difficultyStep } from "../game/difficulty";
import { notesAtLevel, tuneEnd } from "../game/levels";
import { solveRate, whistlerCredit } from "../game/stats";
import type { Round } from "../game/useRound";

/** How long the struck-through wrong guess sits there before the count flips over it. */
const STRIKE_MS = 520;

/**
 * How far the seek buttons move the playhead, and what they print on themselves.
 *
 * Two seconds is still most of an early reveal — the first rung is a single note —
 * so the clamping in `nudge` is doing real work rather than guarding an edge case.
 * The labels derive from it, so a button can never promise a jump it won't make.
 */
const NUDGE_S = 2;

export function Daily({ clip, round }: { clip: DailyClip; round: Round }) {
  const player = useClipPlayer(clip.audioUrl, round.unlocked, clip.startAt ?? 0);
  useSpaceToggle(player.toggle, player.ready);
  const [value, setValue] = useState("");
  /** The guess just submitted, held locally until `round.miss` commits it. */
  const [pending, setPending] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A new level means a new stretch of clip; start it from the top. seek clamps
  // to the clip's floor, so "the top" is the first note rather than second zero.
  useEffect(() => { player.seek(0); }, [round.level]); // eslint-disable-line react-hooks/exhaustive-deps

  const ticks = useMemo(
    () => round.ladder.slice(0, -1)
      .map((rung) => clip.noteStarts[rung])
      .filter((t): t is number => t !== undefined),
    [round.ladder, clip.noteStarts],
  );
  /*
   * Par and difficulty are both `solve_level_sum / solved_count`, so with nobody
   * solved they are not measurements — the payload falls back to level 2 and the
   * screen would present an invented average as a fact. Gated on solvers rather
   * than on plays: a day where three people tried and all failed still has no
   * average to show.
   */
  const measured = clip.solvedCount > 0;

  // The crowd marker sits at the end of the average rung's stretch, so it always
  // lands on a boundary a player could actually have stopped at.
  const parNotes = notesAtLevel(round.ladder, clip.avgSolveLevel);
  const parTs = measured ? clip.noteEnds[parNotes - 1] : undefined;
  const rate = solveRate(clip);

  const misses = pending ? [...round.wrongGuesses, pending] : round.wrongGuesses;

  const submit = () => {
    const v = value.trim();
    if (!v || locked) return;
    if (round.check(v)) { round.solve(); return; }   // the parent swaps in the reveal

    // Shown immediately; `round.miss` commits it to the round a beat later, so the
    // strike-through lands before the count flips over it. Both land in the same
    // render, so the entry doesn't blink as it moves from pending to committed.
    setPending(v);
    setLocked(true);
    setValue("");
    player.pause();
    timers.current.push(
      window.setTimeout(() => {
        round.miss(v);
        setPending(null);
        setLocked(false);
        inputRef.current?.focus({ preventScroll: true });
      }, STRIKE_MS),
    );
  };

  const skipLabel = round.nextNotes === null
    ? "Give up"
    : round.nextNotes === round.total
      ? `Skip · hear all ${round.total}`
      : `Skip · hear ${round.nextNotes}/${round.total}`;

  return (
    <div className="daily">
      <div className="hero">
        <div className="count">
          {/* The number moving IS the "no". No error toast, no red banner. */}
          <h2 className={`big${round.bumped ? " tick" : ""}`} aria-live="polite">
            {round.notes}<em>/{round.total}</em>
          </h2>
          <span className="count-lab">notes unlocked</span>
        </div>

        {/* Flanking play, the way every media player does it — near enough to the
            thumb that scrubbing the bar is for jumping, not for nudging. */}
        <div className="transport">
          <button
            className="seek"
            onClick={() => player.nudge(-NUDGE_S)}
            disabled={!player.ready}
            aria-label={`Back ${NUDGE_S} seconds`}
          >
            -{NUDGE_S}s
          </button>

          <button
            className={`play${player.playing ? " on" : ""}`}
            onClick={player.toggle}
            disabled={!player.ready}
            aria-label={player.playing ? "Pause" : "Play"}
          >
            {player.playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            className="seek"
            onClick={() => player.nudge(NUDGE_S)}
            disabled={!player.ready}
            aria-label={`Forward ${NUDGE_S} seconds`}
          >
            +{NUDGE_S}s
          </button>
        </div>
      </div>

      <Bar
        duration={tuneEnd(clip)}
        open={round.unlocked}
        heard={player.pos}
        ticks={ticks}
        {...(parTs !== undefined ? { parTs, par: parNotes } : {})}
        onSeek={(t) => { player.pause(); player.seek(t); }}
        showKnob
      />

      {/* Enough to frame the guess, not enough to narrow it. Sits against the input
          rather than up by the count, so it reads as a hint while you type. */}
      <div className="tags">
        <span className="tag-chip tag-chip--cat">{clip.category}</span>
        {measured && (
          <span
            className="tag-chip tag-chip--diff"
            data-step={difficultyStep(round.ladder, clip.avgSolveLevel)}
          >
            Difficulty: {difficultyFor(round.ladder, clip.avgSolveLevel)}
          </span>
        )}
      </div>

      {/* Credit before the tune is guessed: the whistler is not the answer. */}
      <p className="credit">{whistlerCredit(clip)}</p>

      {/* An invitation rather than a zero when the day is untouched: "0 of 0
          players have found it" reads as "this one is impossible". */}
      <p className={`solve-rate${rate ? "" : " solve-rate--invite"}`}>
        {rate ?? "Be the first to find today's tune!"}
      </p>

      <div className="guess-field">
        <input
          ref={inputRef}
          id="guess"
          name="guess"
          type="text"
          value={value}
          disabled={locked}
          placeholder="Name that tune"
          autoComplete="off"
          spellCheck={false}
          aria-label="Your guess"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button className="btn-go" onClick={submit} disabled={!value.trim() || locked} aria-label="Guess">
          <GoIcon />
        </button>
      </div>

      <div className="under">
        <button className="btn-skip" onClick={round.skip}>{skipLabel}</button>
        {misses.length > 0 && (
          <p className="misses" aria-live="polite" aria-label="Wrong guesses so far">
            {misses.map((g, i) => (
              <span key={`${g}-${i}`} className={i === misses.length - 1 ? "last" : ""}>
                ✕ <s>{g}</s>
              </span>
            ))}
          </p>
        )}
      </div>

      {player.error && <p className="hint" style={{ textAlign: "center" }}>{player.error}</p>}
    </div>
  );
}
