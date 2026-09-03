import { useCallback, useEffect, useState } from "react";
import type { DailyClip, UploadDraft } from "./api";
import { api, parseKey, today } from "./api";
import { FlameIcon } from "./components/icons";
import { ThemeToggle } from "./components/ThemeToggle";
import { Toasts, useToasts } from "./components/Toasts";
import { finishedToday } from "./game/storage";
import { useRound } from "./game/useRound";
import { Daily } from "./screens/Daily";
import { Reveal } from "./screens/Reveal";
import { Booth } from "./screens/Booth";
import { Calendar } from "./screens/Calendar";
import "./styles/app.css";

/**
 * Still no router library. Four shapes of path, matched by hand:
 *
 *   /              today
 *   /booth         the booth
 *   /calendar      the month grid
 *   /2026-08-27    that day's puzzle
 *
 * A date that isn't a real calendar date falls back to today rather than
 * rendering an error, so a mistyped URL still lands somewhere playable.
 *
 * The archive is gated: until today's round is finished, `/calendar` and any
 * past date resolve to the daily. Doing it here rather than only hiding the link
 * means typing the URL doesn't walk around the gate — the same rule covers the
 * header, the browser bar and the back button, because all three come through
 * this function.
 *
 * It is still only a client-side gate. `get_daily_on` will hand any past puzzle
 * to anyone who asks it directly, which is fine: this is a nudge to play today
 * first, not a secret worth keeping.
 */
type Route =
  | { kind: "daily" }
  | { kind: "booth" }
  | { kind: "calendar" }
  | { kind: "day"; date: string };

function routeOf(path: string): Route {
  const seg = path.replace(/^\/+|\/+$/g, "");
  if (seg === "booth") return { kind: "booth" };
  if (seg === "calendar") return finishedToday() ? { kind: "calendar" } : { kind: "daily" };
  if (seg && parseKey(seg)) {
    // Today reached by its own date is just the daily, so back/forward and the
    // header link don't end up with two ways to be on the same screen.
    if (seg === today() || !finishedToday()) return { kind: "daily" };
    return { kind: "day", date: seg };
  }
  return { kind: "daily" };
}

const pathOf = (r: Route): string =>
  r.kind === "booth" ? "/booth"
  : r.kind === "calendar" ? "/calendar"
  : r.kind === "day" ? `/${r.date}`
  : "/";

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname));
  const { toasts, push, dismiss } = useToasts();

  /*
   * Fire an upload and report on it later.
   *
   * Owned here rather than in the booth because the booth stops waiting the
   * moment it submits: it shows "sent, processing" and offers to leave. The
   * request outlives that screen — a cold ingest container takes tens of seconds
   * — so the thing that reports the outcome has to sit above the router.
   *
   * The failure toast matters more than the success one. The quality gate rejects
   * takes with reasons a whistler can act on ("that doesn't sound like a whistle"),
   * and before this the booth showed them inline. Now that submitting navigates
   * away from the form, a toast is the only place that feedback can land.
   */
  const startUpload = useCallback((draft: UploadDraft) => {
    api.upload(draft).then(
      () => push("good", `“${draft.title}” has been processed.`),
      (e: unknown) => push("bad", e instanceof Error && e.message
        ? `“${draft.title}” — ${e.message}`
        : `“${draft.title}” couldn't be processed.`),
    );
  }, [push]);

  useEffect(() => {
    const onPop = () => setRoute(routeOf(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // Keep the bar honest when routeOf redirected or normalised: /calendar behind
  // the gate, or today reached by its own date, both resolve to the daily and
  // shouldn't leave a URL claiming otherwise.
  useEffect(() => {
    const want = pathOf(route);
    if (location.pathname !== want) history.replaceState(null, "", want);
  }, [route]);

  const go = useCallback((next: Route) => {
    history.pushState(null, "", pathOf(next));
    setRoute(next);
  }, []);

  const goDaily = useCallback(() => go({ kind: "daily" }), [go]);
  const goCalendar = useCallback(() => go({ kind: "calendar" }), [go]);
  const goBooth = useCallback(() => go({ kind: "booth" }), [go]);

  // Assigned rather than returned from the switch, because the heading and the
  // toasts wrap every route: a toast reports an upload that outlived the booth,
  // so it cannot live inside the screen that started it.
  let screen: React.ReactNode;
  switch (route.kind) {
    case "booth":
      screen = (
        <div className="shell">
          <Header onHome={goDaily} right={<BackLink onClick={goDaily} />} />
          <Booth onLeave={goDaily} onSubmit={startUpload} />
        </div>
      );
      break;

    case "calendar":
      screen = (
        <div className="shell">
          <Header onHome={goDaily} right={<BackLink onClick={goDaily} />} />
          <Calendar onOpenDay={(date) => go(routeOf(`/${date}`))} />
        </div>
      );
      break;

    case "day":
      screen = (
        <PuzzleRoute
          key={route.date}
          date={route.date}
          onHome={goDaily}
          onBooth={goBooth}
          onCalendar={goCalendar}
        />
      );
      break;

    default:
      screen = (
        <PuzzleRoute
          key="today"
          date={null}
          onHome={goDaily}
          onBooth={goBooth}
          onCalendar={goCalendar}
        />
      );
  }

  return (
    <>
      {/*
        The only h1 on the page. The app's biggest text is the note count ("1/12")
        and the wordmark is a button, so without this there is no heading at all —
        which reads badly to a screen reader and leaves a crawler with nothing to
        call the page. Hidden rather than shown: the design's element count is the
        point of that screen, and this adds a name, not a banner.
      */}
      <h1 className="sr-only">WhistlingIt — Whistling It, the daily whistled tune game</h1>
      <Toasts toasts={toasts} onDismiss={dismiss} />
      {screen}
    </>
  );
}

const BackLink = ({ onClick }: { onClick: () => void }) => (
  <button className="top-link" onClick={onClick}>Back to the daily</button>
);

function Header({ onHome, right }: { onHome: () => void; right?: React.ReactNode }) {
  return (
    <div className="app-top">
      {/* The toggle sits on the left, with the wordmark: the right-hand side is
          the action zone and is already two items wide on a phone. */}
      <div className="top-left">
        <button className="app-mark" onClick={onHome}>Whistling<i>It</i></button>
        <ThemeToggle />
      </div>
      <div className="top-right">{right}</div>
    </div>
  );
}

/**
 * Loads a puzzle and hands it to the game. `date` null means today.
 *
 * Keyed by date at the call site, so moving between days remounts rather than
 * trying to reconcile one day's round state onto another day's clip.
 */
function PuzzleRoute({
  date,
  onHome,
  onBooth,
  onCalendar,
}: {
  date: string | null;
  onHome: () => void;
  onBooth: () => void;
  onCalendar: () => void;
}) {
  const [clip, setClip] = useState<DailyClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // Being on a past day at all means the gate was already passed. On today's, the
  // link stays away until the round is over — which `Game` decides from `round`,
  // since that is the screen where it happens.
  const showCalendar = !!date;

  useEffect(() => {
    let cancelled = false;
    setClip(null);
    setError(null);
    setMissing(false);

    const load = date ? api.getByDate(date) : api.getDaily();
    load.then(
      (c) => {
        if (cancelled) return;
        if (c) setClip(c); else setMissing(true);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't reach the whistle.");
      },
    );
    return () => { cancelled = true; };
  }, [date]);

  if (error) {
    return (
      <Shell onHome={onHome} onCalendar={onCalendar} showCalendar={showCalendar}>
        <div className="centered">
          <h2 className="res-title">No whistle {date ? "that day" : "today"}</h2>
          <p>{error}</p>
          <button className="btn-skip" onClick={() => location.reload()}>Try again</button>
        </div>
      </Shell>
    );
  }

  // A past date nobody was given a puzzle on. Ordinary, not an error. No strip
  // above: the way back to the calendar is the point of this screen, so it gets
  // the centred button rather than a second copy of the same link.
  if (missing) {
    return (
      <Shell onHome={onHome} onCalendar={onCalendar} showCalendar={false}>
        <div className="centered">
          <h2 className="res-title">Nothing that day</h2>
          <p>No whistle was set for {date}. Try another square.</p>
          <button className="btn-skip" onClick={onCalendar}>Back to the calendar</button>
        </div>
      </Shell>
    );
  }

  if (!clip) {
    return (
      <Shell onHome={onHome} onCalendar={onCalendar} showCalendar={showCalendar}>
        <div className="centered">
          <div className="dots" role="status" aria-label="Loading the whistle"><i /><i /><i /></div>
          <p>Fetching {date ? "that day's" : "today's"} whistle…</p>
        </div>
      </Shell>
    );
  }

  return (
    <Game clip={clip} isPast={!!date} onHome={onHome} onBooth={onBooth} onCalendar={onCalendar} />
  );
}

function Shell({
  children,
  onHome,
  onCalendar,
  showCalendar,
}: {
  children: React.ReactNode;
  onHome: () => void;
  onCalendar: () => void;
  showCalendar: boolean;
}) {
  return (
    <div className="shell">
      <Header onHome={onHome} />
      {showCalendar && (
        <p className="cal-strip">
          <button className="btn-skip" onClick={onCalendar}>See the other days</button>
        </p>
      )}
      {children}
    </div>
  );
}

/** Split out so useRound gets a clip that is guaranteed to exist. */
function Game({
  clip,
  isPast,
  onHome,
  onBooth,
  onCalendar,
}: {
  clip: DailyClip;
  isPast: boolean;
  onHome: () => void;
  onBooth: () => void;
  onCalendar: () => void;
}) {
  const round = useRound(clip);

  return (
    <div className="shell">
      <Header
        onHome={onHome}
        right={
          <>
            <button className="top-link top-link--blaze" onClick={onBooth}>
              Add your whistle!
            </button>
            {round.streak > 0 && (
              <span className="streak" title={`${round.streak}-day streak`}>
                <FlameIcon />{round.streak}
              </span>
            )}
          </>
        }
      />
      {/*
        An old day looks exactly like the daily, so it has to say which day it
        is. That it doesn't touch the streak is true but goes unsaid — nobody
        replaying an old tune is worried about it.

        The way back to the calendar rides along here rather than in the header,
        which is already the booth's and the streak's. Only a past day gets it:
        on today's puzzle the archive stays shut until the round is over, and
        once it is over the reveal offers the same link under the result.
      */}
      {isPast && (
        <div className="past-banner">
          <span>Replaying <b>{clip.date}</b></span>
          <button className="btn-skip" onClick={onCalendar}>Other days</button>
        </div>
      )}
      {/* One way back to the calendar per screen, never two. A past day already
          carries it in the banner above, so the reveal doesn't repeat it there;
          on today's puzzle the banner doesn't exist and the reveal is the first
          moment the archive opens at all, so that is where the link belongs. */}
      {round.done
        ? <Reveal clip={clip} round={round} onCalendar={isPast ? undefined : onCalendar} />
        : <Daily clip={clip} round={round} />}
    </div>
  );
}
