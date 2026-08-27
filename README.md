# WhistlingIt

A daily blind test where every clip is someone **whistling** the tune instead of the real recording.
One track per day for everyone. You start with three notes; every miss buys you one more, until the
whole thing plays and the day is over.

This repo currently holds the **interface design** only — no backend.

## What's here

| File | What it is |
| --- | --- |
| `index.html` | The whole design, as one self-contained page. Open it in a browser. |

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

## Open questions

1. **Notes are an uneven currency.** In the prototype, three notes is 1.86 s — but note 4 buys only
   0.62 s more, while note 7 buys 1.86 s. Should a level be "the next note *or* +1.5 s, whichever is
   longer"?
2. **Timezone.** One global tune rotating at UTC midnight, or local midnight per user? The first
   keeps the crowd marker honest, the second is friendlier.
3. **Late arrivals.** Open the app at 23:50 — fresh full round, or the tail of the day?
4. **Accounts.** Streaks imply identity. Device-local streak to start, optional account later?
5. **Booth access.** Open to everyone with a moderation queue, or invited whistlers only? It decides
   whether the booth needs a rejection state.
