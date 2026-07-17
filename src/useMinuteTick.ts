import { useEffect, useState } from "react";

/**
 * A monotonic counter that increments once per minute while the window is in
 * the foreground. Drives the "Played X ago" / "Continue Playing …" captions
 * (which call `Date.now()` during render) so they advance without the user
 * having to focus a card or trigger a re-render some other way.
 *
 * Background tabs are exempted from the cadence — the captions can't be seen,
 * and throttling keeps idle wakeups out of the WebKit WebView. Returns the
 * latest tick count (or `0` on a server / non-DOM environment), which the
 * caller passes as the `now` argument to `formatLastPlayed`.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let intervalId: number | undefined;

    const start = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => setTick((t) => t + 1), 60_000);
    };
    const stop = () => {
      if (intervalId === undefined) return;
      window.clearInterval(intervalId);
      intervalId = undefined;
    };

    const onVisibilityChange = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return tick;
}
