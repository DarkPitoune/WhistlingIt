# WhistlingIt

A daily blind test where every clip is someone **whistling** the tune instead of the real recording.
One track per day for everyone. You start with three notes; every miss buys you one more, until the
whole thing plays and the day is over.

This repo holds the **interface design** and the **frontend**. No backend yet — the client talks to
a mock adapter behind a typed contract.

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The interface design, as one self-contained page. Open it in a browser. |
| `client/` | The real app. React + TypeScript + Vite. |

## Running it

```sh
cd client
npm install
npm run dev
```

The design page needs no build step — open `index.html` directly.

## The app

Two screens, no tab bar, no router library: the booth is one link in the header and the path is
kept in sync so `/booth` is linkable and the back button works.

```
client/
  scripts/render-whistle.mjs   bakes the mock clip to a WAV (npm run clip)
  public/clips/hedwig.wav      the mock daily — 14 notes, 13.9s
  src/
    api/          the backend contract + the mock that stands in for it
    audio/        AudioContext, gated clip playback, note-onset detection
    game/         level ladder, guess matching, round state, local persistence
    components/   Bar, Tape, icons
    screens/      Daily, Reveal, Booth
    styles/       tokens.css (ported from the design page) + app.css
```

### The backend contract

Everything the server needs to provide is in `src/api/types.ts`, and every call goes through the
single `api` object in `src/api/index.ts`. To go live, write an adapter implementing `WhistlingApi`
and export it there instead — nothing else in `src/` knows the difference.

| Call | What it does |
| --- | --- |
| `getDaily()` | Today's clip: audio URL, note boundaries, category, difficulty, average solve note, and the accepted answers. |
| `submitRound(result)` | Fire-and-forget. Feeds the difficulty and average-solve numbers. |
| `upload(draft)` | The booth's take plus its labels and detected note boundaries. |

Guess matching is **client-side** (`src/game/match.ts`), so `accepted` ships to the browser and is
readable in devtools. Deliberate trade for instant, offline-capable feedback — move it behind a
`POST /guess` if that stops being acceptable.

### The mock

`src/api/mock.ts` serves one fixture for every day, with a little latency so loading states are
real. The clip is a genuine audio file, not the design page's live synth: `npm run clip` renders
the same synth (sine + 5.4 Hz vibrato + a bandpassed puff of breath on each attack) offline to
`public/clips/hedwig.wav` and writes the matching fixture. Replace both with real whistlers.

### Notes on the implementation

- **Playback is gated by scheduling, not by a timer.** The whole file is decoded and in memory; the
  source node is handed a duration and stops itself, so the cut at the unlock boundary is
  sample-accurate. Short gain ramps at each end stop it clicking mid-note.
- **The ladder is derived, not hardcoded.** `makeLadder(noteCount)` builds `3·4·5·6·7·all` and
  clamps to the clip, so a nine-note clip works without special-casing.
- **The booth's note detection is a hysteresis gate on the RMS envelope.** On the reference clip it
  finds all 14 notes to within ~20 ms. It will merge two notes slurred at the same pitch — that's
  the known failure, and it's what the **Redo** button is for. Pitch tracking would catch it; not
  worth the complexity until we see how people actually whistle.
- **The round is persisted per day.** A refresh mid-round doesn't hand out a free retry. Streaks are
  device-local, matching the "no accounts to start" call.

## The design page

`index.html` needs no build step and no dependencies. Everything except the Google Fonts stylesheet
is inline. It contains:

- **The daily** — a working prototype of the game screen. The audio is a real WebAudio whistle
  (sine + vibrato + a puff of breath on each attack) playing 14 notes of Hedwig's Theme. Play,
  scrub, guess, and skip all work.
- **The reveal** — the result card, shown in the *missed* state.
- **The booth** — the upload screen.
- **What came off** — the density pass: ten elements removed and where each one went.
- **The kit** — palette, motion, and a live type picker that re-skins the whole page.

## The two screens

### The daily

Seven elements, no scrolling, one thumb.

```
Whistling·It                        🔥 12
                FILM · TRICKY
                    3/14
                NOTES UNLOCKED
                     ▶
     ████████▒▒░░░░░░░░░░░░░░░░░░░░░░░░
              ▲avg
     [ Name that tune              → ]
          skip · hear 4/14
```

The bar is the design's one real idea: it carries **four facts in one object** — where you are, how
much is unlocked, where the next five unlocks fall (the tick marks), and where most people solve it
(the small mark, sitting where par goes on a scorecard). That consolidation is what let the level
ladder, the tries counter and the guess-history list all come out.

The count is the feedback. Guess wrong and `3/14` flips to `4/14` while the bar grows underneath.
No error toast, no red banner.

### The booth

Record button first, labels after. Note boundaries are auto-detected and merely *reported*
(`14 notes found`) on the same bar the game uses, so a bad cut is caught in a glance. The
**Accepted answers** field is load-bearing: guessing is free text, so that list is the matching
logic.

## Design decisions

| | |
| --- | --- |
| **Guessing** | Free text, no autocomplete — a dropdown would leak answers. |
| **Note cuts** | Auto-detected, confirmed in one glance. |
| **Timeline** | Full track always visible; locked stretch is hatched and un-scrubbable. |
| **Skip cost** | A skip and a wrong guess cost the same. One currency. |
| **Replays** | Free and unlimited. The scarce resource is notes, not listens. |
| **Navigation** | No tab bar. Two screens don't need one. |
| **Sound** | Silence, except the whistle. No win chime, no error buzz. |
| **Difficulty** | Not a field. Computed from the first 100 plays. |

## The kit

Screen-printed toy: a cool periwinkle ground, hard offset shadows instead of soft elevation, and
exactly one loud colour so the play button is never in doubt. Full dark theme included; the page
follows the viewer's system setting.

| Token | Light | Dark |
| --- | --- | --- |
| `--ground` | `#E8E9F4` | `#101128` |
| `--ink` | `#15162C` | `#EDEEFA` |
| `--blaze` | `#FF4E17` | `#FF6B3D` |
| `--indigo` | `#2B3AF5` | `#7385FF` |
| `--butter` | `#FFC93C` | `#FFD25E` |
| `--good` | `#0FA97C` | `#22C79A` |

Type is not settled. Four pairings ship in the page and the picker in **The kit** swaps them live
(the choice is remembered in `localStorage`):

- **Toy** — Unbounded / Familjen Grotesk / Martian Mono *(default)*
- **Scoreboard** — Anton / Archivo / Chivo Mono
- **Music hall** — Fraunces / Hanken Grotesk / Azeret Mono
- **Fairground** — Bungee / Figtree / IBM Plex Mono

The app ships **Toy** only. The other three stay in the design page until the choice is settled.

## Open questions

Still open. The app picks a default for each so it runs; none of them are decided.

| | Question | What the app does for now |
| --- | --- | --- |
| 1 | **Notes are an uneven currency.** Three notes is 1.86 s, but note 4 buys only 0.62 s more while note 7 buys 1.86 s. Should a level be "the next note *or* +1.5 s, whichever is longer"? | Pure note ladder, as designed. Changing it touches `makeLadder` in `client/src/game/levels.ts` and nothing else. |
| 2 | **Timezone.** UTC midnight or local midnight? | Local. The countdown on the reveal matches. |
| 3 | **Late arrivals.** Open the app at 23:50 — fresh round, or the tail of the day? | Fresh round; the day flips at local midnight. |
| 4 | **Accounts.** | Device-local streak in `localStorage`, no accounts. |
| 5 | **Booth access.** | Open, everything goes to a queue. No rejection state built. |

The original framing of each:

1. **Notes are an uneven currency.** In the prototype, three notes is 1.86 s — but note 4 buys only
   0.62 s more, while note 7 buys 1.86 s. Should a level be "the next note *or* +1.5 s, whichever is
   longer"?
2. **Timezone.** One global tune rotating at UTC midnight, or local midnight per user? The first
   keeps the crowd marker honest, the second is friendlier.
3. **Late arrivals.** Open the app at 23:50 — fresh full round, or the tail of the day?
4. **Accounts.** Streaks imply identity. Device-local streak to start, optional account later?
5. **Booth access.** Open to everyone with a moderation queue, or invited whistlers only? It decides
   whether the booth needs a rejection state.
