import type { Release } from "./catalog";
import { type MediaSlot, mediaSrc } from "./media";
import {
  formatLastPlayed,
  formatPlayCount,
  formatPlayTime,
  type PlayEntry,
} from "./playHistory";

interface ContinuePlayingHeroProps {
  /** The most recently played Release (see `mostRecentlyPlayed`). */
  release: Release;
  /** Its accumulated play activity, driving the "played…" caption. */
  entry: PlayEntry;
  /** The still artwork slot to show, or `undefined` for the text-only layout. */
  coverSlot?: MediaSlot;
  /** Whether the roving focus is currently on the hero. */
  isFocused: boolean;
  registerRef: (el: HTMLElement | null) => void;
  /** Sync the roving focus when the hero gains focus by mouse. */
  onFocus: () => void;
  onResume: (release: Release) => void;
}

/**
 * The "Continue Playing" banner above the Games grid: one full-width card for
 * the most recently played Release, launching it with a single press. It is
 * the first item of the grid's roving-focus loop (a leading full-width row —
 * see `moveFocusIndex`), so from a cold start the journey is: open app,
 * press A, be back in last night's game.
 */
function ContinuePlayingHero({
  release,
  entry,
  coverSlot,
  isFocused,
  registerRef,
  onFocus,
  onResume,
}: ContinuePlayingHeroProps) {
  const activity = [
    formatLastPlayed(entry.lastPlayedMs, Date.now()),
    formatPlayCount(entry.playCount),
    formatPlayTime(entry.totalPlayMs),
  ].join(" · ");

  return (
    <button
      type="button"
      className={`continue-hero${isFocused ? " is-focused" : ""}`}
      aria-label={`Continue playing ${release.title}`}
      ref={registerRef}
      tabIndex={isFocused ? 0 : -1}
      onClick={() => onResume(release)}
      onFocus={onFocus}
    >
      {coverSlot && (
        <img
          className="continue-hero-cover"
          src={mediaSrc(release.id, coverSlot)}
          alt=""
          aria-hidden="true"
        />
      )}
      <span className="continue-hero-body">
        <span className="continue-hero-kicker">Continue playing</span>
        <span className="continue-hero-title">{release.title}</span>
        <span className="continue-hero-meta">{activity}</span>
      </span>
      <span className="continue-hero-play" aria-hidden="true">
        ▶
      </span>
    </button>
  );
}

export default ContinuePlayingHero;
