import type { TryKind } from "../api";

/**
 * One block per try: blaze wrong, butter skip, green solved, grey unused.
 * This is the thing that gets pasted into a group chat, so it has to read at 40px.
 */
export function Tape({ tape, rungs, won }: { tape: TryKind[]; rungs: number; won: boolean }) {
  return (
    <div className="tape">
      {Array.from({ length: rungs }, (_, i) => {
        if (won && i === tape.length) return <i key={i} className="win" />;
        const t = tape[i];
        return <i key={i} className={t ?? ""} />;
      })}
    </div>
  );
}

/** The same tape as text. Emoji, because it has to survive a paste into anything. */
export function tapeText(tape: TryKind[], rungs: number, won: boolean): string {
  return Array.from({ length: rungs }, (_, i) => {
    if (won && i === tape.length) return "🟩";
    const t = tape[i];
    return !t ? "⬜" : t === "skip" ? "🟨" : "🟥";
  }).join("");
}
