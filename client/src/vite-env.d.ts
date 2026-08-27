/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** https://<project-ref>.supabase.co — the daily comes from here, via one RPC. */
  readonly VITE_SUPABASE_URL?: string;
  /**
   * The anon / publishable key. Public by design: it is an identifier, not a
   * secret, and the only thing it can reach is get_daily(). Never put the
   * service key in a VITE_ variable — every VITE_ value is baked into the
   * shipped bundle.
   */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Base URL of the ingest API. Only the booth uses it. */
  readonly VITE_INGEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
