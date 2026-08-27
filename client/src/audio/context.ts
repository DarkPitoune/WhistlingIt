/** One AudioContext for the whole app, created lazily on the first user gesture. */

let ctx: AudioContext | null = null;

export function getContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  // Safari and Chrome both park the context until a gesture resumes it.
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
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
    return await getContext().decodeAudioData(bytes);
  })();

  cache.set(url, p);
  // A failed decode shouldn't poison the cache — let a retry try again.
  p.catch(() => cache.delete(url));
  return p;
}
