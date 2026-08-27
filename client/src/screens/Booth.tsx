import { useEffect, useRef, useState } from "react";
import type { Category, UploadDraft } from "../api";
import { api } from "../api";
import { Bar } from "../components/Bar";
import { getContext } from "../audio/context";
import { detectNotes, type Detection } from "../audio/onsets";

const CATEGORIES: Category[] = ["Film", "Jingle", "TV", "Game", "Pop", "Classical"];

interface Take {
  blob: Blob;
  duration: number;
  detection: Detection;
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

  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - started) / 1000), 100);
    return () => clearInterval(id);
  }, [recording]);

  /** Decode whatever we captured and report where the notes fell. */
  const ingest = async (blob: Blob) => {
    setError(null);
    try {
      const buffer = await getContext().decodeAudioData(await blob.arrayBuffer());
      setTake({ blob, duration: buffer.duration, detection: detectNotes(buffer) });
    } catch {
      setError("Couldn't read that audio. Try a wav, mp3, m4a or ogg file.");
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
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
      noteStarts: take.detection.starts,
      noteEnds: take.detection.ends,
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

  const notes = take?.detection.starts.length ?? 0;

  return (
    <div className="booth">
      <div className="booth-head">
        <h3>New whistle</h3>
        <span className="eyebrow">Draft</span>
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
        <button className="rec-file" onClick={() => fileInput.current?.click()}>
          Upload a file instead
        </button>
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
          {/* Detection reports, it doesn't ask. Same bar as the game, so a bad cut
              shows up in one glance. */}
          <div className="found">
            <div className="found-top">
              <strong>{notes} {notes === 1 ? "note" : "notes"} found</strong>
              <span className={`badge-ok${take.detection.confidence === "Rough" ? " low" : ""}`}>
                {take.detection.confidence}
              </span>
            </div>
            <Bar
              duration={take.duration}
              open={take.duration}
              ticks={take.detection.starts}
            />
            <div className="found-foot">
              <small>
                {notes >= 4
                  ? `Levels at ${[3, 4, 5, 6, 7].filter((n) => n < notes).join(" · ")} · all`
                  : "Needs at least four notes to make a round"}
              </small>
              <button type="button" onClick={() => setTake(null)}>Redo</button>
            </div>
          </div>

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

          <button
            className="booth-submit"
            type="button"
            disabled={busy || !title.trim() || notes < 4}
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
