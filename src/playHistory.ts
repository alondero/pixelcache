/**
 * Pure play-activity logic: the TypeScript mirror of the Rust `playhistory`
 * module plus the aggregation and formatting rules the UI renders with.
 *
 * Kept free of React and Tauri (like `gamesFilter.ts` / `media.ts`) so the
 * per-Game roll-up, "Continue Playing" pick, and human-readable time formats
 * are unit-testable in isolation. History is keyed by **Release** id (you play
 * a Release); the Game-level view is derived here by aggregating a Game's
 * Releases.
 */
import type { Catalog, Release } from "./catalog";

/** Accumulated play activity for one Release (mirrors Rust `PlayEntry`). */
export interface PlayEntry {
  playCount: number;
  totalPlayMs: number;
  /** When the most recent session ended, as Unix epoch milliseconds. */
  lastPlayedMs: number;
}

/** Play activity keyed by Release id (mirrors Rust `PlayHistory`). */
export type PlayHistory = Record<string, PlayEntry>;

/** The Tauri event announcing a freshly persisted session (see `playhistory.rs`). */
export const SESSION_RECORDED_EVENT = "play-session-recorded";

/** Payload of {@link SESSION_RECORDED_EVENT}. */
export interface SessionRecorded {
  releaseId: string;
  entry: PlayEntry;
}

/**
 * Roll a Game's per-Release activity up into one entry: sessions and play time
 * sum across its Releases, and "last played" is the most recent of any of them.
 * Returns `null` for a never-played Game so callers can branch on "has this
 * ever been played" without inventing a zero entry.
 */
export function gamePlayEntry(
  releases: Release[],
  history: PlayHistory,
): PlayEntry | null {
  let aggregate: PlayEntry | null = null;
  for (const release of releases) {
    const entry = history[release.id];
    if (!entry) continue;
    aggregate =
      aggregate === null
        ? { ...entry }
        : {
            playCount: aggregate.playCount + entry.playCount,
            totalPlayMs: aggregate.totalPlayMs + entry.totalPlayMs,
            lastPlayedMs: Math.max(aggregate.lastPlayedMs, entry.lastPlayedMs),
          };
  }
  return aggregate;
}

/** A per-Game roll-up of the whole history, for card badges and sorting. */
export function playEntriesByGame(
  catalog: Catalog,
  history: PlayHistory,
): Map<string, PlayEntry> {
  const releasesByGame = new Map<string, Release[]>();
  for (const release of catalog.releases) {
    const list = releasesByGame.get(release.gameId);
    if (list) list.push(release);
    else releasesByGame.set(release.gameId, [release]);
  }
  const entries = new Map<string, PlayEntry>();
  for (const [gameId, releases] of releasesByGame) {
    const entry = gamePlayEntry(releases, history);
    if (entry) entries.set(gameId, entry);
  }
  return entries;
}

/**
 * A Release is a launch candidate for the "Continue Playing" hero only when it
 * has a non-empty `filePath`. A stale entry (a Release whose file the user
 * moved off-disk between rescans but whose history row persists) would
 * otherwise become a "Press A to launch… an error" hero. The deeper
 * existence-on-disk check happens at launch time in the backend
 * (`resolve_rom_path`); this is the cheap synchronous filter that keeps the
 * hero honest without dragging the filesystem into the UI render path.
 */
function isLaunchable(release: Release): boolean {
  return release.filePath.trim().length > 0;
}

/**
 * The single most recently played, still-launchable Release in the catalog —
 * the "Continue Playing" hero. Stale history rows (a Release since removed
 * from the Vault, or with an empty `filePath`) are skipped rather than
 * surfaced as an unlaunchable hero. Ties (same millisecond) resolve to the
 * first matching Release in catalog order so the pick is deterministic.
 * `null` when nothing playable has ever been played.
 */
export function mostRecentlyPlayed(
  catalog: Catalog,
  history: PlayHistory,
): { release: Release; entry: PlayEntry } | null {
  let best: { release: Release; entry: PlayEntry } | null = null;
  for (const release of catalog.releases) {
    if (!isLaunchable(release)) continue;
    const entry = history[release.id];
    if (!entry) continue;
    if (!best || entry.lastPlayedMs > best.entry.lastPlayedMs) {
      best = { release, entry };
    }
  }
  return best;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A relative "when" for a last-played timestamp: "Just now", "38m ago",
 * "5h ago", "Yesterday", "4d ago", then a locale date for anything older —
 * matching the granularity a library screen needs (exact times add noise, not
 * information). `now` is injected for testability.
 */
export function formatLastPlayed(lastPlayedMs: number, now: number): string {
  const elapsed = now - lastPlayedMs;
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < 2 * DAY_MS) return "Yesterday";
  if (elapsed < 7 * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return new Date(lastPlayedMs).toLocaleDateString();
}

/**
 * A compact total-play-time: "4h 20m", "45m", or "Under a minute" — hours and
 * minutes only, since second-level precision is meaningless across sessions.
 */
export function formatPlayTime(totalPlayMs: number): string {
  if (totalPlayMs < MINUTE_MS) return "Under a minute";
  const hours = Math.floor(totalPlayMs / HOUR_MS);
  const minutes = Math.floor((totalPlayMs % HOUR_MS) / MINUTE_MS);
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** "Played once" / "Played 12 times" for details-panel metadata lines. */
export function formatPlayCount(playCount: number): string {
  return playCount === 1 ? "Played once" : `Played ${playCount} times`;
}
