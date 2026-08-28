/**
 * One definition of "today", and of when today ends. Used by the mock, the live
 * adapter, the streak and the reveal countdown.
 *
 * Europe/Paris, not UTC and not the browser's zone. The puzzle rotates at Paris
 * midnight and `get_daily()` pins its date to
 * `(now() at time zone 'Europe/Paris')::date`, so anything on this side that
 * decides which day it is has to agree.
 *
 * It used to be UTC here and local-midnight in the countdown, which is the bug
 * this replaced: in CEST the timer hit zero two hours before the pick actually
 * changed, so a reload at 00:30 served the previous day's whistle. The boundary
 * now lives in exactly one place — this file — and both the streak key and the
 * countdown read it from here.
 *
 * Pinned to the zone rather than to the device because the day has to be the
 * same day for everyone: the puzzle is global, and a player who opens the app
 * from abroad should still get France's whistle and France's countdown.
 *
 * `Europe/Paris` is a tz-database name, so CET/CEST is handled for us. Nothing
 * here may assume a fixed +01:00/+02:00 offset.
 */

const ZONE = "Europe/Paris";
const DAY_MS = 86_400_000;

// en-CA formats as YYYY-MM-DD, which is the shape the server and the streak use.
const DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const PARTS_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Today's puzzle date in Paris, as YYYY-MM-DD. */
export function today(at: Date = new Date()): string {
  return DATE_FMT.format(at);
}

/**
 * The instant `at` reads as on a Paris wall clock, expressed as a UTC timestamp.
 *
 * A deliberate lie: the number is not the real instant, it is "what the clock on
 * the wall says" laid onto the UTC line so that plain arithmetic works on it.
 * Subtracting the real instant from it gives the zone's offset at that moment.
 */
function wallClock(at: Date): number {
  const p: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
  for (const { type, value } of PARTS_FMT.formatToParts(at)) {
    if (type !== "literal") p[type] = Number(value);
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = p;
  // hour is 00–23 under hour12:false in en-GB, but Node has historically emitted
  // 24 for midnight in some ICU builds; % 24 costs nothing and pins it.
  return Date.UTC(year, month - 1, day, hour % 24, minute, second);
}

/**
 * Milliseconds until `today()` changes — i.e. until the next puzzle.
 *
 * Computed by walking the wall clock to its next midnight and converting back,
 * rather than by adding 24h, because a Paris day is 23 or 25 hours long on the
 * two DST changeovers. The second pass re-reads the offset *at the boundary*:
 * the first estimate uses the offset in force now, which is the wrong one on
 * exactly those two days.
 */
export function msUntilNextDay(from: Date = new Date()): number {
  const wall = wallClock(from);
  const nextMidnight = Math.floor(wall / DAY_MS) * DAY_MS + DAY_MS;

  let instant = nextMidnight - (wall - from.getTime());
  instant = nextMidnight - (wallClock(new Date(instant)) - instant);

  return Math.max(0, instant - from.getTime());
}
