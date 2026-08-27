/**
 * The contract between this client and the backend.
 *
 * Nothing here is implemented server-side yet — src/api/mock.ts satisfies it from
 * fixtures. When the real backend lands, write an adapter with the same shape and
 * swap it in src/api/index.ts. These types are the spec to build against.
 */

export type Category = "Film" | "Jingle" | "TV" | "Game" | "Pop" | "Classical";

/** Computed from the first hundred plays, never entered by the whistler. */
export type Difficulty = "Easy" | "Fair" | "Tricky" | "Brutal";

/**
 * The clip of the day.
 *
 * `accepted` ships to the browser because guess matching is client-side — which
 * means anyone can read the answer in the network tab. That is a deliberate trade
 * for instant, offline-capable feedback. Move matching behind POST /guess if that
 * stops being acceptable.
 */
export interface DailyClip {
  id: string;
  /** ISO date, YYYY-MM-DD. Which day's round this is. */
  date: string;
  audioUrl: string;
  /** Seconds. The full file, including any trailing silence. */
  duration: number;
  /**
   * Onset of each note, in seconds, ascending. Length defines the note count, so
   * the level ladder is derived from this rather than hardcoded to 14.
   */
  noteStarts: number[];
  /** End of each note, in seconds. Same length as noteStarts. */
  noteEnds: number[];
  category: Category;
  difficulty: Difficulty;
  /** 1-based note number where the median player solves it. Drives the bar's tick. */
  avgSolveNote: number;
  title: string;
  from: string;
  /** Pre-normalised accepted answers. See src/game/match.ts for the rules. */
  accepted: string[];
}

export type TryKind = "wrong" | "skip";

/** Posted when a round ends, so the backend can recompute difficulty and the average. */
export interface RoundResult {
  clipId: string;
  date: string;
  won: boolean;
  /** 1-based note count the player was on when the round ended. */
  solvedAtNote: number;
  tape: TryKind[];
}

export interface UploadDraft {
  audio: Blob;
  title: string;
  from: string;
  category: Category;
  accepted: string[];
  noteStarts: number[];
  noteEnds: number[];
}

export interface UploadReceipt {
  id: string;
  status: "queued";
}

export interface WhistlingApi {
  getDaily(): Promise<DailyClip>;
  submitRound(result: RoundResult): Promise<void>;
  upload(draft: UploadDraft): Promise<UploadReceipt>;
}
