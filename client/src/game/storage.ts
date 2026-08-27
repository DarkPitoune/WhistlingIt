import type { TryKind } from "../api";

/**
 * Everything here is device-local. Streaks imply identity, and we start without
 * accounts — a refresh mid-round must not hand out a free retry, so the round is
 * persisted the moment it changes.
 */

const ROUND_KEY = "whistlingit.round";
const STREAK_KEY = "whistlingit.streak";

export interface SavedRound {
  date: string;
  clipId: string;
  level: number;
  tape: TryKind[];
  done: null | { won: boolean };
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;   // private mode, quota, or a shape we no longer understand
  }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not fatal */ }
}

/** The saved round, but only if it belongs to today's clip. */
export function loadRound(date: string, clipId: string): SavedRound | null {
  const r = read<SavedRound>(ROUND_KEY);
  return r && r.date === date && r.clipId === clipId ? r : null;
}

export const saveRound = (r: SavedRound) => write(ROUND_KEY, r);

interface StreakRecord { count: number; lastWon: string | null }

export function loadStreak(): number {
  const s = read<StreakRecord>(STREAK_KEY);
  if (!s || !s.lastWon) return 0;
  // Shown as live only while it could still be extended: today or yesterday.
  return daysBetween(s.lastWon, todayLocal()) <= 1 ? s.count : 0;
}

/** Bump on a win, reset on a miss. Called once, when the round ends. */
export function recordResult(won: boolean): number {
  const s = read<StreakRecord>(STREAK_KEY) ?? { count: 0, lastWon: null };
  if (!won) {
    write(STREAK_KEY, { count: 0, lastWon: s.lastWon });
    return 0;
  }
  const today = todayLocal();
  if (s.lastWon === today) return s.count;   // already counted this day
  const carry = s.lastWon && daysBetween(s.lastWon, today) === 1 ? s.count : 0;
  const next = carry + 1;
  write(STREAK_KEY, { count: next, lastWon: today });
  return next;
}

function todayLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function daysBetween(a: string, b: string): number {
  const [ay = 0, am = 1, ad = 1] = a.split("-").map(Number);
  const [by = 0, bm = 1, bd = 1] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}
