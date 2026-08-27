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
 * session rather than being frozen when the AudioContext is constructed — the
 * spec doesn't say, and it's the one load-bearing guess here. If it turns out to
 * be wrong the symptom is specific: on a silenced phone the bar moves and there
 * is still no sound, and the fix is to defer constructing the context to the
 * first tap so the type is set first.
 */
export function setAudioSession(type: AudioSessionType): void {
  const session = (navigator as Navigator & AudioSessionCapable).audioSession;
  if (session) session.type = type;
}

let ctx: AudioContext | null = null;

export function getContext(): AudioContext {
  if (!ctx) {
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
