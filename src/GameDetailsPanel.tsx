import { useEffect, useRef, useState } from "react";
import type { Release } from "./catalog";
import { mediaUrl } from "./catalogView";
import { useGridFocus } from "./useGridFocus";

interface GameDetailsPanelProps {
  /** Display title of the selected Game (its primary release's title). */
  title: string;
  developer?: string;
  /** The game's peer Releases, primary first (see `peerReleases`). */
  releases: Release[];
  onLaunch: (release: Release) => void;
  onClose: () => void;
}

// Wider than any real panel, so the roving-focus math always resolves to a
// single column and up/down walk the release list linearly.
const SINGLE_COLUMN_ITEM_WIDTH = 10_000;

/** Compact "PAL · n64 · retail" style metadata line for a release row. */
function releaseMeta(release: Release): string {
  return [release.region, release.platform, release.releaseType]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Overlay panel for a selected Game: previews the highlighted peer Release
 * (WebM video, else cover art, else a placeholder) and launches a Release via
 * the Deck configured for its platform when its Play row is activated.
 */
function GameDetailsPanel({
  title,
  developer,
  releases,
  onLaunch,
  onClose,
}: GameDetailsPanelProps) {
  // Which release drives the preview pane. Focus (keyboard/gamepad) and hover
  // both update it, so mouse and controller users get the same behavior.
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  // `src` can swap on the highlighted video stream; `useEffect` calls
  // `.load()` on the <video> when the source changes and pauses the previous
  // stream, so a stalled previous one can't keep playing underneath.
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previousVideoSrc = useRef<string | null>(null);

  // Roving focus over every release row plus the Close button at the end.
  const closeIndex = releases.length;
  const { containerRef, focusedIndex, registerItemRef } = useGridFocus({
    itemCount: closeIndex + 1,
    itemWidth: SINGLE_COLUMN_ITEM_WIDTH,
  });

  const highlighted = releases[highlightedIndex];
  const video = highlighted?.media?.video;
  const image = highlighted?.media?.image;

  // Stop and discard the previously highlighted stream when the source
  // changes. Without this, the browser keeps playing the old `<video>` while
  // the new one buffers (the muted-autoplay contract replays it the moment
  // it can), so two streams end up audible/visible until the old one is
  // garbage-collected.
  useEffect(() => {
    const node = previewVideoRef.current;
    const previous = previousVideoSrc.current;
    if (node && previous !== null && previous !== video) {
      node.pause();
    }
    previousVideoSrc.current = video ?? null;
  }, [video]);

  return (
    <div className="details-backdrop">
      <aside
        className="details-panel"
        role="dialog"
        aria-label={title}
        ref={containerRef as React.RefObject<HTMLDivElement>}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className="details-header">
          <div>
            <h2 className="details-title">{title}</h2>
            {developer && <p className="details-developer">{developer}</p>}
          </div>
          <button
            type="button"
            className={`details-close${focusedIndex === closeIndex ? " is-focused" : ""}`}
            aria-label="Close"
            onClick={onClose}
            ref={registerItemRef(closeIndex)}
            tabIndex={focusedIndex === closeIndex ? 0 : -1}
          >
            ✕
          </button>
        </header>

        <div className="release-preview">
          {video ? (
            // Reusing one <video> across highlight changes keeps the element
            // around for transitions; the matching `useEffect` above explicitly
            // pauses the previous stream when the source changes, so two
            // streams aren't audible/visible at once. Muted looping autoplay
            // is the only form WebViews start without a user gesture.
            <video
              data-testid="release-preview-video"
              className="release-preview-media"
              src={mediaUrl(video)}
              autoPlay
              muted
              loop
              playsInline
              ref={previewVideoRef}
            />
          ) : image ? (
            <img
              className="release-preview-media"
              src={mediaUrl(image)}
              alt={`${highlighted.title} cover art`}
            />
          ) : (
            <p className="release-preview-placeholder">No preview available</p>
          )}
        </div>

        <ul className="release-list">
          {releases.map((release, index) => (
            <li key={release.id}>
              <button
                type="button"
                className={`release-row${focusedIndex === index ? " is-focused" : ""}${
                  highlightedIndex === index ? " is-highlighted" : ""
                }`}
                aria-label={`Play ${release.title}`}
                ref={registerItemRef(index)}
                tabIndex={focusedIndex === index ? 0 : -1}
                onClick={() => onLaunch(release)}
                onFocus={() => setHighlightedIndex(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className="release-row-play" aria-hidden="true">
                  ▶
                </span>
                <span className="release-row-body">
                  <span className="release-row-title">{release.title}</span>
                  <span className="release-row-meta">
                    {releaseMeta(release)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export default GameDetailsPanel;
