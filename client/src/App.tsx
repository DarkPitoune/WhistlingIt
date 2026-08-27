import { useEffect, useState } from "react";
import type { DailyClip } from "./api";
import { api } from "./api";
import { FlameIcon } from "./components/icons";
import { useRound } from "./game/useRound";
import { Daily } from "./screens/Daily";
import { Reveal } from "./screens/Reveal";
import { Booth } from "./screens/Booth";
import "./styles/app.css";

/**
 * Two screens don't need a tab bar or a router. The booth is one link in the header,
 * so the daily always opens straight into the game; the path is kept in sync so the
 * booth is linkable and the back button works.
 */
type Route = "daily" | "booth";

const routeOf = (path: string): Route => (path === "/booth" ? "booth" : "daily");

export default function App() {
  const [route, setRoute] = useState<Route>(() => routeOf(location.pathname));

  useEffect(() => {
    const onPop = () => setRoute(routeOf(location.pathname));
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const go = (next: Route) => {
    history.pushState(null, "", next === "booth" ? "/booth" : "/");
    setRoute(next);
  };

  return route === "booth"
    ? (
      <div className="shell">
        <Header
          onHome={() => go("daily")}
          right={
            <button className="top-link" onClick={() => go("daily")}>
              Back to the daily
            </button>
          }
        />
        <Booth onLeave={() => go("daily")} />
      </div>
    )
    : <DailyRoute onBooth={() => go("booth")} />;
}

function Header({ onHome, right }: { onHome: () => void; right?: React.ReactNode }) {
  return (
    <div className="app-top">
      <button className="app-mark" onClick={onHome}>Whistling<i>It</i></button>
      <div className="top-right">{right}</div>
    </div>
  );
}

function DailyRoute({ onBooth }: { onBooth: () => void }) {
  const [clip, setClip] = useState<DailyClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getDaily().then(
      (c) => { if (!cancelled) setClip(c); },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't reach the whistle.");
      },
    );
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="shell">
        <Header onHome={() => location.reload()} />
        <div className="centered">
          <h2 className="res-title">No whistle today</h2>
          <p>{error}</p>
          <button className="btn-skip" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  if (!clip) {
    return (
      <div className="shell">
        <Header onHome={() => {}} />
        <div className="centered">
          <div className="dots" role="status" aria-label="Loading today's whistle"><i /><i /><i /></div>
          <p>Fetching today's whistle…</p>
        </div>
      </div>
    );
  }

  return <Game clip={clip} onBooth={onBooth} />;
}

/** Split out so useRound gets a clip that is guaranteed to exist. */
function Game({ clip, onBooth }: { clip: DailyClip; onBooth: () => void }) {
  const round = useRound(clip);

  return (
    <div className="shell">
      <Header
        onHome={() => {}}
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
      {round.done
        ? <Reveal clip={clip} round={round} />
        : <Daily clip={clip} round={round} />}
    </div>
  );
}
