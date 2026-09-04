import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command, mode }) => {
  // "." is the env directory, resolved against the working directory Vite was
  // started from — the same place it reads .env.local for the bundle. The third
  // argument is the prefix filter, and "" means "everything, not only VITE_*".
  const env = loadEnv(mode, ".", "");
  const ingest = (env.VITE_INGEST_URL ?? "").replace(/\/+$/, "");

  /*
   * Point the booth at the proxy below rather than at the API directly.
   *
   * This has to go through process.env, not `define`. Vite composes
   * import.meta.env from process.env plus the .env files *after* this config
   * resolves, so a variable set here is the one the bundle sees — while
   * `define: {"import.meta.env.VITE_INGEST_URL": …}` matches that exact dotted
   * expression, and src/api/live.ts deliberately reads the whole env object in
   * one go so the check scripts can stand process.env in for it.
   */
  if (command === "serve" && ingest) {
    (globalThis as { process?: { env: Record<string, string> } }).process!.env.VITE_INGEST_URL =
      "/ingest";
  }

  return {
    plugins: [react()],

    /*
     * In dev the booth posts to /ingest on the dev server, which forwards to the
     * real ingest API. Same origin, so CORS is not in the picture at all.
     *
     * This exists because of the tunnel. ALLOWED_ORIGINS is a hand-set list in
     * the Render dashboard, and Cloudflare hands out a fresh *.trycloudflare.com
     * name on every run — so a phone testing through a tunnel always spoke from
     * an origin the API had never heard of. Worse, the failure is nearly
     * invisible: a multipart POST with no custom headers is CORS-safelisted, so
     * it is sent and answered normally and only the *reply* is withheld from JS.
     * The booth sees a rejected fetch and cannot tell "the take was accepted"
     * from "the gate turned it down" — the reason was in the reply it never got.
     *
     * Only the dev server does this. The built bundle still posts to
     * VITE_INGEST_URL cross-origin, from https://whistling.it, which is
     * allowlisted — so this changes nothing about production.
     */
    server: {
      open: true,
      // Bind every interface, so a phone on the same wi-fi — or a tunnel — can
      // reach the dev server, not just localhost.
      host: true,
      /*
       * Vite refuses requests whose Host header it doesn't recognise, which is
       * every tunnel hostname, and the refusal looks like a blank page rather than
       * an obvious error. Cloudflare hands out a fresh *.trycloudflare.com name on
       * each run, so this allows the suffix rather than pinning one name.
       *
       * Dev only — `vite build` output is served by whatever hosts it, and none of
       * this is in the bundle.
       */
      allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.io"],
      ...(ingest
        ? {
            proxy: {
              // changeOrigin rewrites the Host header, without which Render
              // cannot route to the service. No timeout is set on purpose: the
              // free tier cold-starts in tens of seconds and an upload has to
              // outlast that.
              "/ingest": {
                target: ingest,
                changeOrigin: true,
                rewrite: (p: string) => p.replace(/^\/ingest/, ""),
              },
            },
          }
        : {}),
    },
  };
});
