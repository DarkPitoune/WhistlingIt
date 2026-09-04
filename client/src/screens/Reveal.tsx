import { useEffect, useState } from "react";
import type { DailyClip } from "../api";
import { msUntilNextDay, today } from "../api/day";
import { Bar } from "../components/Bar";
import { Tape, tapeText } from "../components/Tape";
import { CalendarIcon, FlagFR, FlagGB, PauseIcon, PlayIcon } from "../components/icons";
import { useClipPlayer } from "../audio/useClipPlayer";
import { useSpaceToggle } from "../audio/useSpaceToggle";
import { notesAtLevel, tuneEnd } from "../game/levels";
import { type Lang, otherLang } from "../i18n/lang";
import { useI18n } from "../i18n/useI18n";
import { solveRate, whistlerCredit } from "../game/stats";
import type { Strings } from "../i18n/strings";
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
 *
 * The language is in the path because the two sides have different tunes. A
 * bare `whistling.it` would sort the reader by their own browser, which is the
 * wrong answer for exactly the person a shared result is aimed at: someone whose
 * phone is in English being told about a French puzzle they can't be shown.
 */
const shareUrl = (lang: Lang) => `https://whistling.it/${lang}`;

export function Reveal({
  clip,
  round,
  onCalendar,
  onLang,
}: {
  clip: DailyClip;
  round: Round;
  onCalendar?: () => void;
  /** Cross to the other game. See the block under the countdown. */
  onLang: (l: Lang) => void;
}) {
  const { lang, t } = useI18n();
  const other = otherLang(lang);
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
  }, t);

  /*
   * A day rebuilt from the old streak knows one thing — that it was solved — and
   * the four lines below it are all about *how*. An empty tape, "got it on note
   * 1" and a share card claiming a perfect round would each be an invention, so
   * they come out, and the gap says plainly why. The answer itself is the part
   * worth keeping, and it is the part that still holds.
   */
  const recovered = round.recovered;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const share = async () => {
    const text = [
      `WhistlingIt ${clip.date.slice(8)}/${clip.date.slice(5, 7)}`,
      `${tapeText(round.tape, round.ladder.length, won)} ${verdict(won, round, t)}`,
      `🔥 ${round.streak}`,
      shareUrl(lang),
    ].join("\n");
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied */ }
    setCopied(true);
  };

  return (
    <div className="reveal">
      <div className={`res-hero${won ? "" : " miss"}`}>
        <span className="res-kicker">{won ? t.reveal.solved : t.reveal.outOfNotes}</span>
        <h2 className="res-title">{clip.title}</h2>
        <p className="res-from">{clip.from}</p>
        {/* Distinct from `from`, which is where the tune comes from — this is who
            whistled it. */}
        <p className="res-by">{whistlerCredit(clip, t)}</p>
      </div>

      {recovered ? (
        <p className="res-recovered">{t.reveal.recovered}</p>
      ) : (
        <>
          <Tape tape={round.tape} rungs={round.ladder.length} won={won} />
          <p className="res-line">
            <b>{won ? t.reveal.gotItOn : ""} {verdict(won, round, t)}</b>
            {/* Dropped when nobody has solved it: the payload's average is a fallback
                at that point, and "most got it on 2" with no solvers is a fiction.
                The player's own solve is not in these counts yet either. */}
            {clip.solvedCount > 0 && <> · {t.reveal.mostGotItOn(notesAtLevel(round.ladder, clip.avgSolveLevel))}</>}
          </p>
          {/* Its own line rather than a third clause: the one above is already two
              facts wide, and this one is about everybody else. */}
          {rate && <p className="solve-rate">{rate}</p>}
        </>
      )}

      {/* Now that the day is done, the whole tune is listenable. */}
      <button className="btn-replay" onClick={player.toggle} disabled={!player.ready}>
        {player.playing ? <PauseIcon /> : <PlayIcon />}
        {player.playing ? t.reveal.playingWholeTune : t.reveal.hearWholeTune}
      </button>
      <Bar duration={tuneEnd(clip)} open={tuneEnd(clip)} heard={player.pos} showKnob />

      {/* No result to copy, and the offer to play it properly goes where the
          share button would have been — it is the thing to do on this screen. */}
      {recovered
        ? <button className="btn-share" onClick={round.replay}>{t.reveal.playItAgain}</button>
        : <button className="btn-share" onClick={share}>{copied ? t.reveal.copied : t.reveal.copyResult}</button>}
      <p className="countdown">{t.reveal.nextWhistleIn} <b>{countdown}</b></p>

      {/*
        The two ways on from here, on one line: more of this game, or the other
        one. They pair because they are the same offer — "there is more to play"
        — and separating them made the language switch look like a setting.

        The crossing lives on this screen and nowhere else, on purpose: this is
        the one moment the player is finished rather than mid-guess, so "there is
        another one of these" is an offer rather than an interruption. A
        persistent header switch would put it in front of someone three notes
        into a tune, where changing pools throws the round away.
      */}
      <div className="after-actions">
        {onCalendar && (
          <button className="btn-after" onClick={onCalendar}>
            <CalendarIcon />
            {t.nav.otherDays}
          </button>
        )}
        <button className="btn-after" onClick={() => onLang(other)}>
          {other === "fr" ? <FlagFR /> : <FlagGB />}
          {t.reveal.crossPromoCta}
        </button>
      </div>
    </div>
  );
}

function verdict(won: boolean, round: Round, t: Strings): string {
  if (!won) return t.reveal.missedIt;
  return t.reveal.noteOf(round.notes, round.total);
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
