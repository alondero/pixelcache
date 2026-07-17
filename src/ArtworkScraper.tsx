import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import {
  type ScrapeOutcome,
  type ScrapeProgress,
  progressWith,
  scrapeQueue,
  startProgress,
  summaryText,
} from "./scrape";

interface ArtworkScraperProps {
  catalog: Catalog;
  /** Called with every per-Release catalog update so artwork pops in live. */
  onCatalogChange: (catalog: Catalog) => void;
}

type RunState =
  | { kind: "idle" }
  | { kind: "running"; progress: ScrapeProgress; current: string }
  | { kind: "done"; progress: ScrapeProgress }
  | { kind: "error"; message: string };

/**
 * The "Fetch artwork" journey on the Media screen: one click walks every
 * Release still missing box art or a screenshot and pulls both from the
 * libretro thumbnails library (the keyless CDN RetroArch uses), showing live
 * per-title progress. The frontend drives one `scrape_release_artwork`
 * command per Release; each call persists and returns the updated Catalog,
 * so covers appear in the grid while the run is still going and Cancel is
 * simply "stop looping".
 */
function ArtworkScraper({ catalog, onCatalogChange }: ArtworkScraperProps) {
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  // A ref, not state: the running loop reads it between awaits, and a
  // re-render must not restart the loop.
  const cancelled = useRef(false);

  const queue = scrapeQueue(catalog);
  const running = run.kind === "running";

  async function fetchArtwork() {
    // Snapshot the queue: each outcome's catalog feeds `onCatalogChange`,
    // which re-derives `queue` on re-render, but this run keeps its plan.
    const targets = scrapeQueue(catalog);
    cancelled.current = false;
    let progress = startProgress(targets.length);
    setRun({ kind: "running", progress, current: targets[0]?.title ?? "" });

    for (const target of targets) {
      if (cancelled.current) break;
      setRun({ kind: "running", progress, current: target.title });
      try {
        const outcome = await invoke<ScrapeOutcome>("scrape_release_artwork", {
          releaseId: target.releaseId,
        });
        onCatalogChange(outcome.catalog);
        progress = progressWith(progress, outcome.status);
      } catch (error) {
        // A transport failure likely affects every remaining Release too —
        // stop the run instead of hammering a dead network.
        setRun({ kind: "error", message: String(error) });
        return;
      }
    }
    setRun({ kind: "done", progress });
  }

  const percent =
    run.kind === "running" && run.progress.total > 0
      ? Math.round((run.progress.done / run.progress.total) * 100)
      : 0;

  return (
    <section className="scrape-panel" aria-label="Artwork scraper">
      <div className="scrape-panel-header">
        <div>
          <h3 className="scrape-title">Artwork scraper</h3>
          <p className="scrape-lead">
            {queue.length === 0
              ? "Every release has artwork — nothing to fetch."
              : `${queue.length} release${queue.length === 1 ? " is" : "s are"} missing box art or a screenshot. Fetch ${queue.length === 1 ? "it" : "them"} from the libretro thumbnails library.`}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            className="launch-button secondary"
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="launch-button"
            onClick={() => void fetchArtwork()}
            disabled={queue.length === 0}
          >
            Fetch artwork
          </button>
        )}
      </div>

      {run.kind === "running" && (
        <div className="scrape-progress" role="status" aria-live="polite">
          <div className="scrape-bar" aria-hidden>
            <div
              className="scrape-bar-fill"
              style={{ width: `${Math.max(percent, 3)}%` }}
            />
          </div>
          <p className="scrape-progress-caption">
            <span className="scrape-current">{run.current}</span>
            <span className="scrape-count">
              {run.progress.done} / {run.progress.total}
            </span>
          </p>
        </div>
      )}

      <p className="status" role="status" aria-live="polite">
        {run.kind === "done" && summaryText(run.progress)}
        {run.kind === "error" && `Artwork fetch failed: ${run.message}`}
      </p>
    </section>
  );
}

export default ArtworkScraper;
