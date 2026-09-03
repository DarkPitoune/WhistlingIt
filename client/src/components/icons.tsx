export const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l14-7.5z" /></svg>
);

export const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5.5" y="4" width="4.4" height="16" rx="1.2" />
    <rect x="14.1" y="4" width="4.4" height="16" rx="1.2" />
  </svg>
);

export const GoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h13M12 5l7 7-7 7" />
  </svg>
);

export const FlameIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2c3 4 6 5.5 6 10a6 6 0 0 1-12 0c0-2 1-3.4 2-4.5.2 1.4.9 2.3 1.8 2.3 1.3 0 1.6-1.2 1.2-3-.3-1.6-.6-3.4 1-4.8z" />
  </svg>
);

/**
 * Fast-forward, for a skipped try on the tape.
 *
 * An SVG rather than a glyph: this was "⏵⏵" (U+23F5 twice), which lives in
 * Geometric Shapes Extended rather than the emoji block and is simply absent from
 * Android's default fonts — it rendered as two tofu boxes. Drawing it removes the
 * font from the equation entirely.
 */
export const FastForwardIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 5l8 7-8 7z" />
    <path d="M13 5l8 7-8 7z" />
  </svg>
);


/** Sun and moon, for the theme toggle. */
export const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="4.3" />
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 2.4v2.3M12 19.3v2.3M2.4 12h2.3M19.3 12h2.3M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" />
    </g>
  </svg>
);

export const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.5 3a9 9 0 1 0 8.5 11.5A7.2 7.2 0 0 1 12.5 3z" />
  </svg>
);

/**
 * The month steppers on the calendar.
 *
 * Drawn rather than the ‹ and › glyphs, for a quieter version of the
 * fast-forward problem above: the guillemets render fine everywhere, they just
 * sit wrong. Their ink runs entirely above the baseline — they use none of the
 * descender the line box reserves — so centring that box in a 38px button leaves
 * the arrow visibly high. How high is a property of Familjen Grotesk, not
 * something CSS can measure, so the alternative was a magic nudge that would go
 * stale the day the typeface changes. A path centres on the box by construction.
 */
export const ChevronLeftIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 5l7 7-7 7" />
  </svg>
);
