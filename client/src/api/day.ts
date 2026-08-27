/**
 * One definition of "today", used by the mock, the live adapter and the streak.
 *
 * UTC, not local. The puzzle rotates at UTC midnight and `get_daily()` pins its
 * date to `(now() at time zone 'utc')::date`, so anything on this side that
 * decides which day it is has to agree — or between local midnight and UTC
 * midnight the streak files a win under a date the server has not reached, and
 * the next day's win is dropped as "already counted".
 *
 * The friendlier alternative — a local-midnight rotation per player — is still
 * an open question. It is a server change, not a client one: this function
 * follows whatever `get_daily()` decides.
 */
export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}
