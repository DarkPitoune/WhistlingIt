import { useCallback, useEffect, useState } from "react";
import type { DailyClip, UploadDraft } from "./api";
import { api, parseKey, today } from "./api";
import { FlameIcon } from "./components/icons";
import { ThemeToggle } from "./components/ThemeToggle";
import { Toasts, useToasts } from "./components/Toasts";
import { type Lang, rememberLang } from "./i18n/lang";
import { redirectTarget, splitLang } from "./i18n/route";
import { I18nProvider, useI18n } from "./i18n/useI18n";
import type { Strings } from "./i18n/strings";
import { finishedToday } from "./game/storage";
import { useRound } from "./game/useRound";
import { Daily } from "./screens/Daily";
import { Reveal } from "./screens/Reveal";
import { Booth } from "./screens/Booth";
import { Calendar } from "./screens/Calendar";
import "./styles/app.css";

/**
 * Still no router library. Four shapes of path, matched by hand, now all under
 * a language:
 *
 *   /fr            today, in French
 *   /en/booth      the English booth
 *   /fr/calendar   the French month grid
 *   /en/2026-08-27 that day's English puzzle
 *
 * A date that isn't a real calendar date falls back to today rather than
 * rendering an error, so a mistyped URL still lands somewhere playable. A path
 * with no language at all is redirected before any of this runs — see
 * `i18n/route.ts`, which owns that rule.
 *
 * The archive is gated: until today's round is finished, `/calendar` and any
 * past date resolve to the daily. Doing it here rather than only hiding the link
 * means typing the URL doesn't walk around the gate — the same rule covers the
 * header, the browser bar and the back button, because all three come through
 * this function. The gate is per-language, since so is the round that satisfies
 * it: finishing the French daily does not open the English archive.
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

function routeOf(path: string, lang: Lang): Route {
  const { rest } = splitLang(path);
  const seg = rest.replace(/^\/+|\/+$/g, "");
  if (seg === "booth") return { kind: "booth" };
  if (seg === "calendar") return finishedToday(lang) ? { kind: "calendar" } : { kind: "daily" };
  if (seg && parseKey(seg)) {
    // Today reached by its own date is just the daily, so back/forward and the
    // header link don't end up with two ways to be on the same screen.
    if (seg === today() || !finishedToday(lang)) return { kind: "daily" };
    return { kind: "day", date: seg };
  }
  return { kind: "daily" };
}

const pathOf = (r: Route, lang: Lang): string =>
  `/${lang}${
    r.kind === "booth" ? "/booth"
    : r.kind === "calendar" ? "/calendar"
    : r.kind === "day" ? `/${r.date}`
    : ""
  }`;

/**
 * Which side this page is, and a redirect for the paths that don't say.
 *
 * Read once, outside React, before the first render. `history.replaceState`
 * rather than a location assignment: the app can serve the corrected path from
 * the bundle it has already loaded, and a real navigation would throw away a
 * warm page to fetch the same one back.
 */
function entryLang(): Lang {
  const target = redirectTarget(location.pathname, location.search, location.hash);
  if (target) history.replaceState(null, "", target);
  const { lang } = splitLang(location.pathname);
  // `redirectTarget` guarantees a language is in the path by now; `?? "fr"` is
  // unreachable and only here so the type does not need a non-null assertion.
  return lang ?? "fr";
}

export default function App() {
  // State, not a constant: crossing to the other language from the reveal is a
  // navigation, and popstate can bring you back.
  const [lang, setLang] = useState<Lang>(entryLang);

  // The side someone actually played, so a later bare link doesn't re-sort them
  // by their browser's languages. Written on entry rather than on the crossing,
  // because arriving on /en directly is just as much a choice as clicking over.
  useEffect(() => { rememberLang(lang); }, [lang]);

  return (
    <I18nProvider lang={lang}>
      <Game key={lang} lang={lang} onLang={setLang} />
    </I18nProvider>
  );
}

function Game({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const { t } = useI18n();
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname, lang));
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
      () => push("good", t.toast.uploadProcessed(draft.title)),
      (e: unknown) => push("bad", e instanceof Error && e.message
        ? t.toast.uploadFailedWith(draft.title, e.message)
        : t.toast.uploadFailed(draft.title)),
    );
  }, [push, t]);

  useEffect(() => {
    const onPop = () => {
      // Back out of a language crossing and the whole app has to follow, not
      // just the screen: the pool, the streak and the words all change.
      const { lang: popped } = splitLang(location.pathname);
      if (popped && popped !== lang) { onLang(popped); return; }
      setRoute(routeOf(location.pathname, lang));
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [lang, onLang]);

  // Keep the bar honest when routeOf redirected or normalised: /calendar behind
  // the gate, or today reached by its own date, both resolve to the daily and
  // shouldn't leave a URL claiming otherwise.
  useEffect(() => {
    const want = pathOf(route, lang);
    if (location.pathname !== want) history.replaceState(null, "", want);
  }, [route, lang]);

  const go = useCallback((next: Route) => {
    history.pushState(null, "", pathOf(next, lang));
    setRoute(next);
  }, [lang]);

  const goDaily = useCallback(() => go({ kind: "daily" }), [go]);
  const goCalendar = useCallback(() => go({ kind: "calendar" }), [go]);
  const goBooth = useCallback(() => go({ kind: "booth" }), [go]);

  /**
   * Cross to the other game.
   *
   * A pushState and a state change rather than a location assignment, so the
   * back button returns you to the reveal you left. Always lands on that side's
   * daily: the day you just finished here has its own tune over there, and
   * offering the same *date* would be offering an unrelated puzzle.
   */
  const goLang = useCallback((next: Lang) => {
    history.pushState(null, "", `/${next}`);
    onLang(next);
  }, [onLang]);

  // Assigned rather than returned from the switch, because the heading and the
  // toasts wrap every route: a toast reports an upload that outlived the booth,
  // so it cannot live inside the screen that started it.
  let screen: React.ReactNode;
  switch (route.kind) {
    case "booth":
      screen = (
        <div className="shell">
          <Header onHome={goDaily} right={<BackLink onClick={goDaily} t={t} />} />
          <Booth onLeave={goDaily} onSubmit={startUpload} />
        </div>
      );
      break;

    case "calendar":
      screen = (
        <div className="shell">
          <Header onHome={goDaily} right={<BackLink onClick={goDaily} t={t} />} />
          <Calendar onOpenDay={(date) => go(routeOf(`/${lang}/${date}`, lang))} />
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
          onLang={goLang}
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
          onLang={goLang}
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
      <h1 className="sr-only">{t.pageHeading}</h1>
      <Toasts toasts={toasts} onDismiss={dismiss} />
      {screen}
    </>
  );
}

const BackLink = ({ onClick, t }: { onClick: () => void; t: Strings }) => (
  <button className="top-link" onClick={onClick}>{t.nav.backToDaily}</button>
);

function Header({ onHome, right }: { onHome: () => void; right?: React.ReactNode }) {
  return (
    <div className="app-top">
      {/* The toggle sits on the left, with the wordmark: the right-hand side is
          the action zone and is already two items wide on a phone. */}
      <div className="top-left">
        {/* The wordmark is the one thing that does not translate. It is the name. */}
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
  onLang,
}: {
  date: string | null;
  onHome: () => void;
  onBooth: () => void;
  onCalendar: () => void;
  onLang: (l: Lang) => void;
}) {
  const { lang, t } = useI18n();
  const [clip, setClip] = useState<DailyClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  // Being on a past day at all means the gate was already passed. On today's, the
  // link stays away until the round is over — which `Puzzle` decides from `round`,
  // since that is the screen where it happens.
  const showCalendar = !!date;

  useEffect(() => {
    let cancelled = false;
    setClip(null);
    setError(null);
    setMissing(false);

    const load = date ? api.getByDate(date, lang) : api.getDaily(lang);
    load.then(
      (c) => {
        if (cancelled) return;
        if (c) setClip(c); else setMissing(true);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t.load.unreachable);
      },
    );
    return () => { cancelled = true; };
  }, [date, lang, t]);

  if (error) {
    return (
      <Shell onHome={onHome} onCalendar={onCalendar} showCalendar={showCalendar}>
        <div className="centered">
          <h2 className="res-title">{date ? t.load.noWhistleThatDay : t.load.noWhistleToday}</h2>
          <p>{error}</p>
          {/*
            An empty pool lands here, and English ships empty — so on day one
            this screen is the whole site. Shell drops the header's booth button
            on a screen with no puzzle, which would leave "the booth is open"
            as a sentence with no door: the only way in would be typing the URL.
            Not offered on a dated URL, where recording a whistle now cannot put
            one on a day already past.
          */}
          {!date && (
            <button className="btn-skip" onClick={onBooth}>{t.nav.addYourWhistle}</button>
          )}
          <button className="btn-skip" onClick={() => location.reload()}>{t.nav.tryAgain}</button>
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
          <h2 className="res-title">{t.load.nothingThatDay}</h2>
          <p>{t.load.noWhistleSetFor(date ?? "")}</p>
          <button className="btn-skip" onClick={onCalendar}>{t.nav.backToCalendar}</button>
        </div>
      </Shell>
    );
  }

  if (!clip) {
    return (
      <Shell onHome={onHome} onCalendar={onCalendar} showCalendar={showCalendar}>
        <div className="centered">
          <div className="dots" role="status" aria-label={t.load.loading}><i /><i /><i /></div>
          <p>{date ? t.load.fetchingThatDay : t.load.fetchingToday}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Puzzle
      clip={clip}
      isPast={!!date}
      onHome={onHome}
      onBooth={onBooth}
      onCalendar={onCalendar}
      onLang={onLang}
    />
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
  const { t } = useI18n();
  return (
    <div className="shell">
      <Header onHome={onHome} />
      {showCalendar && (
        <p className="cal-strip">
          <button className="btn-skip" onClick={onCalendar}>{t.nav.seeOtherDays}</button>
        </p>
      )}
      {children}
    </div>
  );
}

/** Split out so useRound gets a clip that is guaranteed to exist. */
function Puzzle({
  clip,
  isPast,
  onHome,
  onBooth,
  onCalendar,
  onLang,
}: {
  clip: DailyClip;
  isPast: boolean;
  onHome: () => void;
  onBooth: () => void;
  onCalendar: () => void;
  onLang: (l: Lang) => void;
}) {
  const { t } = useI18n();
  const round = useRound(clip);

  return (
    <div className="shell">
      <Header
        onHome={onHome}
        right={
          <>
            <button className="top-link top-link--blaze" onClick={onBooth}>
              {t.nav.addYourWhistle}
            </button>
            {round.streak > 0 && (
              <span className="streak" title={t.nav.streakTitle(round.streak)}>
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
          <span>{t.daily.replaying} <b>{clip.date}</b></span>
          <button className="btn-skip" onClick={onCalendar}>{t.nav.otherDays}</button>
        </div>
      )}
      {/* One way back to the calendar per screen, never two. A past day already
          carries it in the banner above, so the reveal doesn't repeat it there;
          on today's puzzle the banner doesn't exist and the reveal is the first
          moment the archive opens at all, so that is where the link belongs. */}
      {round.done
        ? <Reveal clip={clip} round={round} onCalendar={isPast ? undefined : onCalendar} onLang={onLang} />
        : <Daily clip={clip} round={round} />}
    </div>
  );
}
