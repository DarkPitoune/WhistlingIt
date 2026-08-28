/**
 * The contract between this client and the backend.
 *
 * Nothing here is implemented server-side yet — src/api/mock.ts satisfies it from
 * fixtures. When the real backend lands, write an adapter with the same shape and
 * swap it in src/api/index.ts. These types are the spec to build against.
 */

/**
 * Must stay in step with CATEGORIES in server/api/app/config.py, which is what
 * actually validates an upload — the client sending a value the API doesn't know
 * is a 400, not a fallback.
 */
export type Category = "Film" | "Jingle" | "TV Series" | "Video Games" | "Music";

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
  /**
   * Where a reveal should *start*: the first note minus a short lead, or 0 if the
   * clip opens on the note. Recordings routinely carry a second of dead air up
   * front, which would otherwise be most of the first reveal.
   *
   * Optional because nothing consumes it yet: `useClipPlayer(audioUrl, unlocked)`
   * plays 0 → unlocked with no start offset, so a clip with leading silence spends
   * level 1 on silence. The server computes and ships this; wiring it into the
   * player (or trimming the head at ingest instead) is the open decision.
   */
  startAt?: number;
  category: Category;
  difficulty: Difficulty;
  /**
   * The average ladder rung solvers reached, 1-based — level 1 is three notes,
   * level 2 four, up to the last level which is the whole tune.
   *
   * A rung rather than a note count, because the rungs are 3·4·5·6·7·all and
   * averaging those jumps lands between them: on a 21-note tune one player
   * finishing at "all" would drag the mean to note 9, which is not a level
   * anybody was offered. Scoring the rung keeps every gap at one.
   *
   * Use `notesAtLevel(round.ladder, …)` to turn it back into notes for display.
   * Measured from `solvedCount` plays; falls back to level 2 until someone solves.
   */
  avgSolveLevel: number;
  /**
   * How many rounds on this tune ended solved, and how many ran out of notes.
   *
   * Raw counts rather than a percentage, because "nobody has played it" and
   * "nobody has solved it" need telling apart and a single 0 cannot. Counted per
   * *tune*, not per day — the pool cycles, so a tune can be aired more than once.
   *
   * Best-effort: the write path is an unauthenticated RPC, so these can be
   * inflated by anyone who wants to. Treat as telemetry, not as a scoreboard.
   */
  solvedCount: number;
  failedCount: number;
  /**
   * Who whistled it, or null when they didn't say — the screens render that as
   * "Anonymous Whistler". Free text, and shown before the tune is guessed, so a
   * signature that names the tune would give it away. A moderation problem, not
   * one this type can solve.
   */
  signature: string | null;
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
  /**
   * 1-based ladder rung the player solved on — the round's score.
   *
   * The rung, not the note count: rungs are one apart by construction, so they
   * average into something that is itself a rung. Ignored when `won` is false.
   */
  solvedAtLevel: number;
  tape: TryKind[];
}

/**
 * What the booth sends: the recording and its labels, nothing measured.
 *
 * No note boundaries. The server segments the transcoded file itself and that
 * result is what becomes the puzzle, so shipping a browser-side guess alongside
 * it would only invite the two to disagree.
 */
export interface UploadDraft {
  audio: Blob;
  title: string;
  from: string;
  category: Category;
  accepted: string[];
  /**
   * Who whistled it. Optional: blank means unsigned, and the credit reads
   * "Anonymous Whistler". Only the length is enforced, server-side.
   */
  signature: string;
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
