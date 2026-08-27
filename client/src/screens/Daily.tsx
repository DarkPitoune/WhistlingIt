import { useEffect, useMemo, useRef, useState } from "react";
import type { DailyClip } from "../api";
import { Bar } from "../components/Bar";
import { GoIcon, PauseIcon, PlayIcon } from "../components/icons";
import { useClipPlayer } from "../audio/useClipPlayer";
import type { Round } from "../game/useRound";

/** How long the struck-through wrong guess sits there before the count flips over it. */
const STRIKE_MS = 520;

export function Daily({ clip, round }: { clip: DailyClip; round: Round }) {
  const player = useClipPlayer(clip.audioUrl, round.unlocked, clip.startAt ?? 0);
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
  const parTs = clip.noteEnds[clip.avgSolveNote - 1];

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
        <span className="tag">{clip.category} · {clip.difficulty}</span>

        <div className="count">
          {/* The number moving IS the "no". No error toast, no red banner. */}
          <h2 className={`big${round.bumped ? " tick" : ""}`} aria-live="polite">
            {round.notes}<em>/{round.total}</em>
          </h2>
          <span className="count-lab">notes unlocked</span>
        </div>

        <button
          className={`play${player.playing ? " on" : ""}`}
          onClick={player.toggle}
          disabled={!player.ready}
          aria-label={player.playing ? "Pause" : "Play"}
        >
          {player.playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>

      <Bar
        duration={clip.duration}
        open={round.unlocked}
        heard={player.pos}
        ticks={ticks}
        {...(parTs !== undefined ? { parTs, par: clip.avgSolveNote } : {})}
        onSeek={(t) => { player.pause(); player.seek(t); }}
        showKnob
      />

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
