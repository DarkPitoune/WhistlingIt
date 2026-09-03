/**
 * One AudioContext for the whole app: constructed lazily on the first clip load,
 * and brought out of `suspended` by `unlock()` on the first user gesture.
 */

/**
 * iOS needs two things settled before Web Audio makes a sound, and neither shows
 * up as an error — the clip decodes, the button works, and nothing comes out.
 *
 * 1. **The audio session.** The session type defaults to `auto`, and for a page
 *    whose only audio goes through an AudioContext WebKit resolves that to an
 *    ambient session — which the hardware ringer switch silences outright. An
 *    HTML `<audio>` element is exempt; Web Audio is not, so the game is
 *    inaudible for anyone whose phone is on silent, which is most phones.
 *    Declaring `playback` is the supported way out (`navigator.audioSession`,
 *    Safari 16.4+ and still Safari-only, hence the feature test). The booth needs
 *    the mic as well and so wants `play-and-record` instead.
 *
 *    The W3C spec pins neither the ringer-switch behaviour nor the mapping from
 *    `auto`; both are WebKit's, and this is written from the reported symptom
 *    rather than from a normative reference.
 *
 * 2. **A clock that has actually started.** `resume()` is asynchronous, and a
 *    suspended context's `currentTime` does not move. Firing it and scheduling
 *    against `currentTime` in the same breath — which is what this file used to
 *    do — is how you get a play button that flips to pause over silence. Callers
 *    await `unlock()` from inside the gesture instead.
 */

/** The subset of the AudioSession API we use. Not in lib.dom yet. */
type AudioSessionType = "auto" | "playback" | "transient" | "transient-solo" | "ambient" | "play-and-record";

interface AudioSessionCapable {
  audioSession?: { type: AudioSessionType };
}

/**
 * Tell iOS what the page is doing with audio, so it picks a session the ringer
 * switch doesn't mute. A no-op everywhere the API is absent.
 *
 * Called on every play rather than once at startup, because the booth changes it
 * and has to be able to change it back. That assumes the type applies to the live
 * session rather than being frozen when the AudioContext is constructed, which
 * the spec does not say either way.
 *
 * The cold start no longer rests on that assumption — `getContext` declares the
 * session before it constructs anything, so a fresh page is in `playback` under
 * either reading. What still rests on it is the round trip through the booth: if
 * the type turns out to be frozen at construction, coming back from a recording
 * leaves the context on the `play-and-record` route, which on iOS means the
 * earpiece rather than the speaker. The symptom is specific — audio that plays at
 * a fraction of the expected volume, only after visiting the booth — and the fix
 * is to rebuild the context on the way out rather than re-declaring the type.
 */
export function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & AudioSessionCapable).audioSession;
  if (session) session.type = type;
}

let ctx: AudioContext | null = null;

/**
 * Declare the session *before* the first AudioContext exists.
 *
 * This is the ordering the note above calls the load-bearing guess, and it was
 * being got wrong. The first thing to touch audio is `loadClip`, from the mount
 * effect in useClipPlayer — no gesture, no session declared, and it constructs
 * the context to decode into. `setAudioSession("playback")` did not run until the
 * first `play()`, by which point WebKit had already resolved the page's `auto`
 * session to `ambient` and bound the context to it. Ambient is the one the
 * hardware ringer switch mutes, so the game was silent for anyone whose phone was
 * on silent — which reads as intermittent only because it depends on a switch
 * nobody thinks to check.
 *
 * Only `auto` is overridden, so the booth's `play-and-record` is never clobbered
 * by a context built while the mic is the point.
 *
 * Deliberately here rather than at module scope: it needs to happen before the
 * constructor and nowhere earlier, and hanging it off the constructor is the only
 * version of that which cannot be undone by someone reordering imports.
 */
function declareSession(): void {
  const session = (navigator as Navigator & AudioSessionCapable).audioSession;
  if (session && session.type === "auto") session.type = "playback";
}

export function getContext(): AudioContext {
  if (!ctx) {
    declareSession();
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  return ctx;
}

/**
 * Bring the context up, resolving only once its clock is running.
 *
 * Call this from a user gesture: Safari and Chrome both require `resume()` to be
 * *invoked* while the gesture is still live. It is, synchronously — only the wait
 * is handed back to the caller, which is allowed to outlive the gesture.
 *
 * A rejected resume resolves rather than throws: the context is returned either
 * way and the caller's scheduling is what will fail visibly, if anything does.
 */
export function unlock(): Promise<AudioContext> {
  const c = getContext();
  if (c.state === "running") return Promise.resolve(c);
  return c.resume().then(() => c, () => c);
}

const cache = new Map<string, Promise<AudioBuffer>>();

/** Fetch and decode a clip, once per URL. */
export function loadClip(url: string): Promise<AudioBuffer> {
  const hit = cache.get(url);
  if (hit) return hit;

  const p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`clip ${url}: ${res.status} ${res.statusText}`);
    const bytes = await res.arrayBuffer();
    // Decoding works on a suspended context, so this deliberately does not
    // resume: there is no gesture behind a load, and asking would be denied.
    return await getContext().decodeAudioData(bytes);
  })();

  cache.set(url, p);
  // A failed decode shouldn't poison the cache — let a retry try again.
  p.catch(() => cache.delete(url));
  return p;
}
