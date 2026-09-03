import type { TryKind } from "../api";
import { FastForwardIcon } from "./icons";

/**
 * One block per try: blaze for a wrong guess, blaze plus a fast-forward mark for
 * a skip, green for the solve, grey for a rung never reached.
 * This is the thing that gets pasted into a group chat, so it has to read at 40px.
 */
export function Tape({ tape, rungs, won }: { tape: TryKind[]; rungs: number; won: boolean }) {
  return (
    <div className="tape">
      {Array.from({ length: rungs }, (_, i) => {
        if (won && i === tape.length) return <i key={i} className="win" />;
        const t = tape[i];
        // A skip carries the fast-forward mark; a skip and a wrong guess cost the
        // same, so the mark is the only thing telling them apart.
        return (
          <i key={i} className={t ?? ""}>
            {t === "skip" ? <FastForwardIcon /> : null}
          </i>
        );
      })}
    </div>
  );
}

/**
 * The same tape as text. Emoji, because it has to survive a paste into anything.
 * Skips use fast-forward rather than a colour of their own, matching the on-screen
 * tape where a skip and a wrong guess read the same and only the glyph differs.
 */
export function tapeText(tape: TryKind[], rungs: number, won: boolean): string {
  return Array.from({ length: rungs }, (_, i) => {
    if (won && i === tape.length) return "🟩";
    const t = tape[i];
    return !t ? "⬜" : t === "skip" ? "⏩" : "🟥";
  }).join("");
}
