import { useEffect, useState } from "react";
import type { DailyClip } from "../api";
import { msUntilNextDay, today } from "../api/day";
import { Bar } from "../components/Bar";
import { Tape, tapeText } from "../components/Tape";
import { PauseIcon, PlayIcon } from "../components/icons";
import { useClipPlayer } from "../audio/useClipPlayer";
import { useSpaceToggle } from "../audio/useSpaceToggle";
import { notesAtLevel, tuneEnd } from "../game/levels";
import { solveRate, whistlerCredit } from "../game/stats";
import type { Round } from "../game/useRound";

/**
 * Five things: the answer, your tape, one line of comparison, share, and a countdown.
 * The answer is the hero — not the score — because "what *was* that?" is the question
 * everyone actually has.
 */
/**
 * Hardcoded, not `location.origin`: the point of the last line is to tell someone
 * who has never played where to go, and a dev or preview origin pasted into a
 * group chat sends them nowhere. Matches client/public/CNAME.
 */
const SHARE_URL = "https://whistling.it";

export function Reveal({
  clip,
  round,
  onCalendar,
}: {
  clip: DailyClip;
  round: Round;
  onCalendar?: () => void;
}) {
  const won = round.done?.won ?? false;
  // The round is over, so the whole clip is unlocked.
  const player = useClipPlayer(clip.audioUrl, tuneEnd(clip), clip.startAt ?? 0);
  useSpaceToggle(player.toggle, player.ready);
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown();

  /*
   * The clip was fetched before the round began, so its counts are one short:
   * they don't include the result the player just posted. Add it here rather than
   * refetching — the round trip would leave the number visibly wrong for a beat,
   * and this is the one result we already know.
   *
   * Guarded by `justFinished`, which is false when the round was restored from
   * storage. By then the server's counts already contain this player, and adding
   * again would count them twice.
   *
   * If the write was declined the tally is one optimistic, and corrects itself on
   * the next load. Worth it: "1 of 1" on a screen you just finished reads broken.
   */
  const rate = solveRate({
    ...clip,
    solvedCount: clip.solvedCount + (round.justFinished && won ? 1 : 0),
    failedCount: clip.failedCount + (round.justFinished && !won ? 1 : 0),
  });

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const share = async () => {
    const text = [
      `WhistlingIt ${clip.date.slice(8)}/${clip.date.slice(5, 7)}`,
      `${tapeText(round.tape, round.ladder.length, won)} ${verdict(won, round)}`,
      `🔥 ${round.streak}`,
      SHARE_URL,
    ].join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied */ }
    setCopied(true);
  };

  return (
    <div className="reveal">
      <div className={`res-hero${won ? "" : " miss"}`}>
        <span className="res-kicker">{won ? "Solved" : "Out of notes"}</span>
        <h2 className="res-title">{clip.title}</h2>
        <p className="res-from">{clip.from}</p>
        {/* Distinct from `from`, which is where the tune comes from — this is who
            whistled it. */}
        <p className="res-by">{whistlerCredit(clip)}</p>
      </div>

      <Tape tape={round.tape} rungs={round.ladder.length} won={won} />
      <p className="res-line">
        <b>{won ? "got it on" : ""} {verdict(won, round)}</b>
        {/* Dropped when nobody has solved it: the payload's average is a fallback
            at that point, and "most got it on 2" with no solvers is a fiction.
            The player's own solve is not in these counts yet either. */}
        {clip.solvedCount > 0 && <> · most got it on {notesAtLevel(round.ladder, clip.avgSolveLevel)}</>}
      </p>
      {/* Its own line rather than a third clause: the one above is already two
          facts wide, and this one is about everybody else. */}
      {rate && <p className="solve-rate">{rate}</p>}

      {/* Now that the day is done, the whole tune is listenable. */}
      <button className="btn-replay" onClick={player.toggle} disabled={!player.ready}>
        {player.playing ? <PauseIcon /> : <PlayIcon />}
        {player.playing ? "Playing the whole tune" : "Hear the whole tune"}
      </button>
      <Bar duration={tuneEnd(clip)} open={tuneEnd(clip)} heard={player.pos} showKnob />

      <button className="btn-share" onClick={share}>{copied ? "Copied ✓" : "Copy result"}</button>
      <p className="countdown">Next whistle in <b>{countdown}</b></p>
      {onCalendar && (
        <button className="btn-skip" onClick={onCalendar}>See the other days</button>
      )}
    </div>
  );
}

function verdict(won: boolean, round: Round): string {
  if (!won) return "missed it";
  return `note ${round.notes}/${round.total}`;
}

/**
 * Time until the next puzzle.
 *
 * The boundary comes from `api/day.ts`, which is also what decides *which*
 * puzzle you get — so the timer cannot promise a whistle the backend has not
 * rotated to yet. It used to count to the device's own midnight while the pick
 * ran on UTC, which in France meant it hit zero two hours early and a reload
 * served the same tune.
 */
function useCountdown(): string {
  const [text, setText] = useState(() => untilNextWhistle());
  useEffect(() => {
    const openedOn = today();
    const id = setInterval(() => {
      // The day turned over with this screen open. `App.tsx` fetches the daily
      // once on mount, so nothing else would go and get the new whistle — and a
      // timer that reaches zero and then just sits there is the exact complaint
      // this change exists to fix. Compare the day rather than the remaining
      // milliseconds: past the boundary the countdown rolls straight over to a
      // fresh 24h and never reads as zero.
      if (today() !== openedOn) {
        clearInterval(id);
        location.reload();
        return;
      }
      setText(untilNextWhistle());
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

function untilNextWhistle(): string {
  const s = Math.floor(msUntilNextDay() / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
