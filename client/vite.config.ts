import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
  },
});
