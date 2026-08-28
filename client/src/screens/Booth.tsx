import { useEffect, useRef, useState } from "react";
import type { Category, UploadDraft } from "../api";
import { PauseIcon, PlayIcon } from "../components/icons";
import { getContext, setAudioSession } from "../audio/context";
import { useClipPlayer } from "../audio/useClipPlayer";

const CATEGORIES: Category[] = ["Film", "TV Series", "Video Games", "Jingle", "Music"];

interface Take {
  blob: Blob;
  duration: number;
  /** Object URL for the blob, so the take can be played back before sending. */
  url: string;
}

/**
 * Record first, label after. No title field, no category, no consent box in the way
 * — reversing that order kills contributions.
 */
export function Booth({
  onLeave,
  onSubmit,
}: {
  onLeave: () => void;
  /** Fires the upload. Returns nothing: the outcome arrives as a toast. */
  onSubmit: (draft: UploadDraft) => void;
}) {
  const [take, setTake] = useState<Take | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [category, setCategory] = useState<Category>("Film");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");
  const [signature, setSignature] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Hear the take back before committing to it.
  const player = useClipPlayer(take?.url ?? null, take?.duration ?? 0);

  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  // Unmounting mid-draft would otherwise strand the last take's object URL.
  // Keyed on nothing rather than on the URL: a cleanup that re-ran on change
  // would revoke the take StrictMode is about to re-mount and play.
  const liveUrl = useRef<string | null>(null);
  liveUrl.current = take?.url ?? null;
  useEffect(() => () => { if (liveUrl.current) URL.revokeObjectURL(liveUrl.current); }, []);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);

  /**
   * Swap in a new take, releasing the previous object URL. Nothing else revokes
   * them, so skipping this leaks a whole recording per retry.
   */
  const replaceTake = (next: Take | null) => {
    setTake((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return next;
    });
  };

  /**
   * Decode once, only to learn how long it is and to prove it is readable audio.
   *
   * We deliberately do not segment it here. The server re-runs its own pitch
   * segmenter on the transcoded file and that answer is the one that becomes the
   * puzzle, so anything measured in the browser is decoration at best and a
   * contradiction at worst.
   */
  const ingest = async (blob: Blob) => {
    setError(null);
    try {
      const buffer = await getContext().decodeAudioData(await blob.arrayBuffer());
      replaceTake({ blob, duration: buffer.duration, url: URL.createObjectURL(blob) });
    } catch {
      setError("Couldn't read that audio. Try a wav, mp3, m4a or ogg file.");
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      // Playing the daily leaves iOS in the `playback` session, which is the wrong
      // one to capture under. Declare the mic before asking for it.
      setAudioSession("play-and-record");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void ingest(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.start();
      recorder.current = rec;
      setElapsed(0);
      setRecording(true);
    } catch {
      setError("No microphone. You can upload a file instead.");
    }
  };

  const stopRecording = () => {
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
  };

  /**
   * Commit whatever is in the box as one or more answers.
   *
   * Enter and comma both work, because "one per line" and "comma-separated" are
   * both things people reasonably assume — guessing wrong shouldn't silently
   * produce one answer that reads "poudlard, hogwarts".
   */
  const addAliases = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) { setAliasDraft(""); return; }
    const next = [...accepted];
    for (const p of parts) {
      if (!next.some((a) => a.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    setAccepted(next);
    setAliasDraft("");
  };

  /**
   * Hand the upload off and acknowledge immediately, without waiting.
   *
   * The ingest service transcodes, segments and gates the take, and it is a
   * free-tier container that spins down when idle — a cold start is tens of
   * seconds. Holding the whistler on a spinner for that is the wrong trade when
   * nothing they do next depends on the answer. App reports the outcome as a
   * toast, which is why it survives leaving this screen.
   */
  const submit = () => {
    // Re-checked rather than leaning on `canSubmit`, which is a boolean and so
    // cannot narrow `take` away from null for the compiler.
    if (!take || !title.trim()) return;
    // The title always counts as an accepted answer; the list is the matching logic.
    onSubmit({
      audio: take.blob,
      title: title.trim(),
      from: from.trim(),
      category,
      accepted: [title.trim(), ...accepted],
      signature: signature.trim(),
    });
    setSent(true);
  };

  /** Only a take and a title. An unsigned whistle is credited to nobody. */
  const canSubmit = !!take && !!title.trim();

  /** Back to an empty booth, keeping nothing from the take just sent. */
  const startAnother = () => {
    replaceTake(null);
    setTitle("");
    setFrom("");
    setCategory("Film");
    setAccepted([]);
    setAliasDraft("");
    setSignature("");
    setError(null);
    setSent(false);
  };

  if (sent) {
    return (
      <div className="booth">
        <div className="booth-done">
          <span className="res-kicker">Sent</span>
          <h2 className="res-title">{title}</h2>
          <p className="res-from">
            We're processing it now — listening for the notes and checking it's a whistle.
            You'll get a notice when it's done!
          </p>
        </div>
        <button className="booth-submit" type="button" onClick={startAnother}>
          Whistle another one
        </button>
        <button className="btn-skip" onClick={onLeave}>Back to the daily</button>
      </div>
    );
  }

  return (
    <div className="booth">
      <div className="booth-head">
        <h3>New whistle</h3>
      </div>

      <div className="rec">
        <button
          className={`rec-btn${recording ? " on" : ""}`}
          onClick={recording ? stopRecording : startRecording}
          aria-label={recording ? "Stop recording" : "Start recording"}
        />
        {recording ? (
          <p className="rec-timer">{elapsed.toFixed(1)}s · tap to stop</p>
        ) : (
          <p>
            <strong>{take ? "Take recorded" : "Tap to whistle"}</strong>
            <small>{take ? `${take.duration.toFixed(1)} seconds` : "10–30 seconds is plenty"}</small>
          </p>
        )}
        {take && !recording && (
          <button className="btn-replay" onClick={player.toggle} disabled={!player.ready}>
            {player.playing ? <PauseIcon /> : <PlayIcon />}
            {player.playing ? "Playing your take" : "Hear your take"}
          </button>
        )}

        {/* Both of these are about getting a take, so they sit with the recorder. */}
        <div className="rec-actions">
          <button className="rec-file" onClick={() => fileInput.current?.click()}>
            Upload a file instead
          </button>
          {take && !recording && (
            <button className="rec-file" onClick={() => replaceTake(null)}>
              Record another audio
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void ingest(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && <p className="hint">{error}</p>}

      {take && (
        <>
          <div className="field">
            <label htmlFor="upTitle">Title</label>
            <input id="upTitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="upFrom">From</label>
            <input
              id="upFrom"
              type="text"
              value={from}
              placeholder="Film, artist, whatever places it"
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="field-label" id="catLabel">Category</span>
            <div className="pickers" role="group" aria-labelledby="catLabel">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="pick-chip"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label htmlFor="aliasIn">Accepted answers</label>
            <div className="alias">
              {accepted.map((a) => (
                <span key={a}>
                  {a}
                  <button type="button" aria-label={`Remove ${a}`}
                          onClick={() => setAccepted(accepted.filter((x) => x !== a))}>×</button>
                </span>
              ))}
            </div>
            <input
              id="aliasIn"
              type="text"
              value={aliasDraft}
              placeholder="Type one, then press Enter"
              onChange={(e) => setAliasDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addAliases(aliasDraft); }
              }}
              // Tabbing or clicking away shouldn't quietly discard what's typed.
              onBlur={() => addAliases(aliasDraft)}
            />
            <p className="hint">
              One answer at a time — press <b>Enter</b> or type a comma after each. The title
              already counts, so add other spellings, languages or nicknames. A guess wins if it
              matches any one of them.
            </p>
          </div>

          <div className="field">
            <label htmlFor="upSignature">Sign your whistle!</label>
            <input
              id="upSignature"
              type="text"
              value={signature}
              maxLength={80}
              // Optionality lives in the placeholder rather than a hint line:
              // the eye is already here, and the field is meant to feel light.
              placeholder="Your name — or leave blank to stay anonymous"
              onChange={(e) => setSignature(e.target.value)}
            />
          </div>

          {/* No note-count gate here any more: the server's segmenter is the only
              one whose count matters, and it rejects a short take with
              `too_few_notes`, which live.ts turns into a sentence. */}
          <button
            className="booth-submit"
            type="button"
            disabled={!canSubmit}
            onClick={submit}
          >
            Send to the queue
          </button>
        </>
      )}
    </div>
  );
}
