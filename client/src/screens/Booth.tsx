import { useEffect, useRef, useState } from "react";
import type { Category, UploadDraft } from "../api";
import { api } from "../api";
import { PauseIcon, PlayIcon } from "../components/icons";
import { getContext, setAudioSession } from "../audio/context";
import { useClipPlayer } from "../audio/useClipPlayer";

const CATEGORIES: Category[] = ["Film", "Jingle", "TV", "Game", "Music"];

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
export function Booth({ onLeave }: { onLeave: () => void }) {
  const [take, setTake] = useState<Take | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [category, setCategory] = useState<Category>("Film");
  const [accepted, setAccepted] = useState<string[]>([]);
  const [aliasDraft, setAliasDraft] = useState("");

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

  const addAlias = () => {
    const v = aliasDraft.trim();
    if (!v || accepted.includes(v)) { setAliasDraft(""); return; }
    setAccepted([...accepted, v]);
    setAliasDraft("");
  };

  const submit = async () => {
    if (!take || !title.trim()) return;
    setBusy(true);
    // The title always counts as an accepted answer; the list is the matching logic.
    const answers = [title.trim(), ...accepted];
    const draft: UploadDraft = {
      audio: take.blob,
      title: title.trim(),
      from: from.trim(),
      category,
      accepted: answers,
    };
    try {
      await api.upload(draft);
      setSent(true);
    } catch (e: unknown) {
      // The API's 422 carries the quality gate's reasons, already turned into
      // plain language by src/api/live.ts. That message is the only thing that
      // tells a whistler what to do differently, so it must not be swallowed.
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Upload failed. Your take is still here — try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="booth">
        <div className="booth-done">
          <span className="res-kicker">In the queue</span>
          <h2 className="res-title">{title}</h2>
          <p className="res-from">We'll listen and slot it into a day.</p>
        </div>
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
              placeholder="Another spelling or language…"
              onChange={(e) => setAliasDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
            />
            <p className="hint">Guessing is free text, so this list is the matching logic.</p>
          </div>

          {/* No note-count gate here any more: the server's segmenter is the only
              one whose count matters, and it rejects a short take with
              `too_few_notes`, which live.ts turns into a sentence. */}
          <button
            className="booth-submit"
            type="button"
            disabled={busy || !title.trim()}
            onClick={submit}
          >
            {busy ? "Sending…" : "Send to the queue"}
          </button>
          {/* Nobody can rate their own whistling. */}
          <p className="hint" style={{ textAlign: "center" }}>
            Difficulty is set by the first 100 plays.
          </p>
        </>
      )}
    </div>
  );
}
