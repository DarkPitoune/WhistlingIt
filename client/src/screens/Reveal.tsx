import { useEffect, useState } from "react";
import type { DailyClip } from "../api";
import { Bar } from "../components/Bar";
import { Tape, tapeText } from "../components/Tape";
import { PauseIcon, PlayIcon } from "../components/icons";
import { useClipPlayer } from "../audio/useClipPlayer";
import type { Round } from "../game/useRound";

/**
 * Five things: the answer, your tape, one line of comparison, share, and a countdown.
 * The answer is the hero — not the score — because "what *was* that?" is the question
 * everyone actually has.
 */
export function Reveal({ clip, round }: { clip: DailyClip; round: Round }) {
  const won = round.done?.won ?? false;
  // The round is over, so the whole clip is unlocked.
  const player = useClipPlayer(clip.audioUrl, clip.duration, clip.startAt ?? 0);
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown();

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
      </div>

      <Tape tape={round.tape} rungs={round.ladder.length} won={won} />
      <p className="res-line">
        <b>{verdict(won, round)}</b> · most got it on {clip.avgSolveNote}
      </p>

      {/* Now that the day is done, the whole thing is listenable. */}
      <button className="btn-replay" onClick={player.toggle} disabled={!player.ready}>
        {player.playing ? <PauseIcon /> : <PlayIcon />}
        {player.playing ? "Playing the whole thing" : "Hear the whole thing"}
      </button>
      <Bar duration={clip.duration} open={clip.duration} heard={player.pos} showKnob />

      <button className="btn-share" onClick={share}>{copied ? "Copied ✓" : "Copy result"}</button>
      <p className="countdown">Next whistle in <b>{countdown}</b></p>
    </div>
  );
}

function verdict(won: boolean, round: Round): string {
  if (!won) return "missed it";
  return round.notes === round.total ? "the whole thing" : `note ${round.notes}`;
}

/** Time to local midnight. Matches the mock's local-date rollover. */
function useCountdown(): string {
  const [text, setText] = useState(() => untilMidnight());
  useEffect(() => {
    const id = setInterval(() => setText(untilMidnight()), 1000);
    return () => clearInterval(id);
  }, []);
  return text;
}

function untilMidnight(): string {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((v) => String(v).padStart(2, "0"))
    .join(":");
}
