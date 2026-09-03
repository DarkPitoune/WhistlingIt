import { useEffect, useMemo, useState } from "react";
import { api, daysInMonth, firstWeekdayMondayBased, today } from "../api";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/icons";
import { loadResults } from "../game/storage";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Every day of a month, coloured by how it went.
 *
 * Two different facts decide a square, and they come from two different places.
 * *How it went* is device-local — there are no accounts — so it is "your" history
 * on this browser, read from localStorage. *Whether there was a whistle at all*
 * is a fact about the game, not about you, so it comes from the server: days
 * before the game started, or days it never pinned, are dead squares rather than
 * days you happen not to have played. Without that the grid offered every square
 * back to 1970 and most of them led to "Nothing that day".
 *
 * Which day "today" is comes from `today()`, i.e. Europe/Paris, to match
 * `puzzle_date`. Near midnight that can differ from the device's local date, and
 * agreeing with the server matters more than agreeing with the clock on the wall.
 * `daysInMonth` and `firstWeekdayMondayBased` are plain calendar arithmetic and
 * carry no zone at all.
 */
export function Calendar({ onOpenDay }: { onOpenDay: (date: string) => void }) {
  const todayKey = today();
  const [y, m] = todayKey.split("-").map(Number) as [number, number, number];

  const [year, setYear] = useState(y);
  const [month, setMonth] = useState(m);

  // Read once per mount: nothing else writes to localStorage while this is open.
  const results = useMemo(() => loadResults(), []);

  /*
   * Which days have a puzzle, one fetch per month and kept afterwards. Paging
   * back and forth is the normal way to use this, and re-asking for August every
   * time is a request whose answer cannot change.
   *
   * A month absent from the map is "not asked yet", which is not the same as "no
   * puzzles" — the grid greys itself out wholesale while it waits rather than
   * guessing, because both guesses flicker: assume-full and the squares go grey a
   * moment later, assume-empty and they light up.
   */
  const [byMonth, setByMonth] = useState<Record<string, Set<string>>>({});
  const [first, setFirst] = useState<string | null>(null);

  const monthKey = `${year}-${p2(month)}`;
  const total = daysInMonth(year, month);
  const known = byMonth[monthKey];

  useEffect(() => {
    if (byMonth[monthKey]) return;
    let cancelled = false;
    api.getPuzzleDays(`${monthKey}-01`, `${monthKey}-${p2(total)}`).then(
      (r) => {
        if (cancelled) return;
        setByMonth((prev) => ({ ...prev, [monthKey]: new Set(r.days) }));
        setFirst(r.first);
      },
      () => { /* offline: the month stays unknown, and the grid stays inert */ },
    );
    return () => { cancelled = true; };
  }, [monthKey, total, byMonth]);

  const lead = firstWeekdayMondayBased(year, month);

  const step = (by: number) => {
    const next = new Date(Date.UTC(year, month - 1 + by, 1));
    setYear(next.getUTCFullYear());
    setMonth(next.getUTCMonth() + 1);
  };

  // Nothing to see in the future, and the server refuses those dates anyway.
  const atCurrentMonth = year === y && month === m;
  // Nor before the first whistle. Until `first` arrives ‹ stays live: guessing
  // it is the current month would strand a first-time visitor on one screen.
  const atFirstMonth = !!first && monthKey <= first.slice(0, 7);

  return (
    <div className="calendar">
      <div className="cal-head">
        <button
          className="cal-nav"
          onClick={() => step(-1)}
          disabled={atFirstMonth}
          aria-label="Previous month"
        ><ChevronLeftIcon /></button>
        <h2 className="cal-title">{MONTHS[month - 1]} {year}</h2>
        <button
          className="cal-nav"
          onClick={() => step(1)}
          disabled={atCurrentMonth}
          aria-label="Next month"
        ><ChevronRightIcon /></button>
      </div>

      <div
        className={`cal-grid${known ? "" : " is-waiting"}`}
        role="grid"
        aria-busy={known ? undefined : true}
        aria-label={`${MONTHS[month - 1]} ${year}`}
      >
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">{d}</span>
        ))}

        {/* Blanks so the 1st lands on its weekday. */}
        {Array.from({ length: lead }, (_, i) => <span key={`pad${i}`} className="cal-pad" />)}

        {Array.from({ length: total }, (_, i) => {
          const day = i + 1;
          const key = `${year}-${p2(month)}-${p2(day)}`;
          const result = results[key];
          const isToday = key === todayKey;
          const isFuture = key > todayKey;
          const hasPuzzle = !!known?.has(key);

          const state = result === true ? "won" : result === false ? "lost" : "none";
          const label = `${day} ${MONTHS[month - 1]} — ${
            result === true ? "solved"
            : result === false ? "missed"
            : isFuture ? "not yet"
            : !known ? "loading"
            : !hasPuzzle ? "no whistle that day"
            : "not played"
          }`;

          return (
            <button
              key={key}
              className={`cal-day is-${state}${isToday ? " is-today" : ""}${
                known && !hasPuzzle && !isFuture ? " is-empty" : ""
              }`}
              // A day with no whistle behind it is not a destination. It reads as
              // greyed and dashed through :disabled, same as the future.
              disabled={isFuture || !hasPuzzle}
              aria-label={label}
              aria-current={isToday ? "date" : undefined}
              onClick={() => onOpenDay(key)}
            >
              <span className="cal-num">{day}</span>
              {state === "won" && <span className="cal-mark" aria-hidden="true">✓</span>}
              {state === "lost" && <span className="cal-mark" aria-hidden="true">✕</span>}
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        <span><i className="swatch is-won" />Solved</span>
        <span><i className="swatch is-lost" />Missed</span>
        <span><i className="swatch is-none" />Not played</span>
        <span><i className="swatch is-empty" />No whistle</span>
      </div>

      <p className="hint cal-note">Saved on this device only.</p>
    </div>
  );
}
