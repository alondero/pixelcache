/**
 * Pure logic for the artwork scraper journey (mirroring the split in
 * `src-tauri/src/scrape.rs`): which Releases need a scrape, how a run's
 * progress ticks, and how the result is summarised. Kept free of React and
 * Tauri (like `gamesFilter.ts` / `decks.ts`) so the rules are unit-testable;
 * `ArtworkScraper.tsx` is the thin layer that drives the
 * `scrape_release_artwork` command loop.
 */
import type { Catalog } from "./catalog";
import { resolveMedia } from "./media";

/** How the backend concluded one Release's scrape (see `ScrapeStatus` in Rust). */
export type ScrapeStatus =
  "found" | "missing" | "skipped" | "noVault" | "unsupported";

/** What one `scrape_release_artwork` call returns. */
export interface ScrapeOutcome {
  status: ScrapeStatus;
  slots: string[];
  catalog: Catalog;
}

/** One Release the scraper should visit. */
export interface ScrapeTarget {
  releaseId: string;
  title: string;
  platform: string;
}

/**
 * The Releases worth scraping: those whose `boxart` or `screenshot` slot
 * resolves to nothing through the Release → Game fallback — the same rule the
 * backend's `missing_kinds` applies, so the queue and the backend agree.
 * Releases the backend will refuse (no Vault, unsupported platform) are still
 * queued; their outcome is tallied honestly as unavailable rather than
 * silently hidden.
 */
export function scrapeQueue(catalog: Catalog): ScrapeTarget[] {
  const gamesById = new Map(catalog.games.map((game) => [game.id, game]));
  return catalog.releases
    .filter((release) => {
      const resolved = resolveMedia(
        release.media,
        gamesById.get(release.gameId)?.media,
      );
      return !resolved.boxart || !resolved.screenshot;
    })
    .map((release) => ({
      releaseId: release.id,
      title: release.title,
      platform: release.platform,
    }));
}

/** A running scrape's tally. `done` counts every visited Release. */
export interface ScrapeProgress {
  total: number;
  done: number;
  found: number;
  missing: number;
  /** Skipped, Vault-less, or unsupported-platform Releases. */
  unavailable: number;
}

/** A fresh tally for a queue of `total` Releases. */
export function startProgress(total: number): ScrapeProgress {
  return { total, done: 0, found: 0, missing: 0, unavailable: 0 };
}

/** Tick the tally with one Release's outcome status. */
export function progressWith(
  progress: ScrapeProgress,
  status: ScrapeStatus,
): ScrapeProgress {
  return {
    ...progress,
    done: progress.done + 1,
    found: progress.found + (status === "found" ? 1 : 0),
    missing: progress.missing + (status === "missing" ? 1 : 0),
    unavailable:
      progress.unavailable +
      (status === "skipped" || status === "noVault" || status === "unsupported"
        ? 1
        : 0),
  };
}

/** A one-line human summary of a finished run. */
export function summaryText(progress: ScrapeProgress): string {
  const releases = `release${progress.total === 1 ? "" : "s"}`;
  if (progress.found === progress.total) {
    return `Artwork found for all ${progress.total} ${releases}`;
  }
  const parts = [
    `Artwork found for ${progress.found} of ${progress.total} ${releases}`,
  ];
  if (progress.missing > 0) parts.push(`${progress.missing} without a match`);
  if (progress.unavailable > 0)
    parts.push(`${progress.unavailable} unavailable`);
  return parts.join(" · ");
}
