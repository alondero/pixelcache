/**
 * Pure search / filter / sort logic for the Games grid.
 *
 * Kept free of React and the DOM (like `gridNavigation.ts`) so the matching and
 * ordering rules are unit-testable in isolation; `GamesView` is the thin layer
 * that owns the `FilterState` and renders the result. Operates on the
 * `GameCardInfo[]` already derived by `catalogView.gameCardInfos`, consulting
 * the `Catalog` only to reach each Game's Releases (for platform / type / peer
 * title matching).
 */
import type { Catalog, Release, ReleaseType } from "./catalog";
import type { GameCardInfo } from "./catalogView";
import type { PlayEntry } from "./playHistory";

/** Sentinel meaning "no filter on this dimension" for the select-backed filters. */
export const ANY = "any";

export type SortKey =
  "title-asc" | "title-desc" | "releases-desc" | "last-played" | "most-played";

/** The full set of controls backing the filter bar. */
export interface FilterState {
  /** Free-text query; matched case-insensitively against titles + developer. */
  query: string;
  /** A platform id, or [`ANY`]. */
  platform: string;
  /** A [`ReleaseType`], or [`ANY`]. */
  releaseType: string;
  /** When `true`, only Games marked favorite pass. */
  favoritesOnly: boolean;
  sort: SortKey;
}

/** The neutral starting state: no query, no filters, title A–Z. */
export const DEFAULT_FILTER: FilterState = {
  query: "",
  platform: ANY,
  releaseType: ANY,
  favoritesOnly: false,
  sort: "title-asc",
};

/** Canonical ordering for the release-type dropdown (mirrors `ReleaseType`). */
const RELEASE_TYPE_ORDER: ReleaseType[] = [
  "retail",
  "beta",
  "hack",
  "translation",
  "homebrew",
];

/** Group a catalog's Releases by their `gameId` for repeated per-Game lookups. */
function releasesByGame(catalog: Catalog): Map<string, Release[]> {
  const byGame = new Map<string, Release[]>();
  for (const release of catalog.releases) {
    const list = byGame.get(release.gameId);
    if (list) list.push(release);
    else byGame.set(release.gameId, [release]);
  }
  return byGame;
}

/**
 * The distinct platforms present across all Releases, sorted alphabetically —
 * the option set for the platform filter. Only platforms that actually exist in
 * the catalog are offered, so the dropdown never lists an empty filter.
 */
export function availablePlatforms(catalog: Catalog): string[] {
  const platforms = new Set(catalog.releases.map((r) => r.platform));
  return [...platforms].sort((a, b) => a.localeCompare(b));
}

/**
 * The distinct release types present across all Releases, in canonical order
 * (retail → beta → hack → translation → homebrew) — the option set for the
 * release-type filter.
 */
export function availableReleaseTypes(catalog: Catalog): ReleaseType[] {
  const present = new Set(catalog.releases.map((r) => r.releaseType));
  return RELEASE_TYPE_ORDER.filter((t) => present.has(t));
}

/**
 * Whether `game` matches the free-text `query`. A game matches if the query is a
 * (case-insensitive) substring of its card title, its developer, or any of its
 * peer Releases' titles — so searching "lylat" finds *Star Fox 64* through its
 * PAL release *Lylat Wars*. A blank query matches everything.
 */
function matchesQuery(
  card: GameCardInfo,
  releases: Release[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (card.title.toLowerCase().includes(needle)) return true;
  if (card.game.developer?.toLowerCase().includes(needle)) return true;
  return releases.some((r) => r.title.toLowerCase().includes(needle));
}

/** Comparator for the active [`SortKey`]; ties fall back to title A–Z. */
function compareCards(
  a: GameCardInfo,
  b: GameCardInfo,
  sort: SortKey,
  playByGame: Map<string, PlayEntry>,
): number {
  const byTitle = a.title.localeCompare(b.title, undefined, {
    sensitivity: "base",
  });
  // Play-activity sorts put never-played games (no entry → 0) after played
  // ones, then fall back to title so the unplayed tail stays browsable.
  const entryA = playByGame.get(a.game.id);
  const entryB = playByGame.get(b.game.id);
  switch (sort) {
    case "title-asc":
      return byTitle;
    case "title-desc":
      return -byTitle;
    case "releases-desc":
      return b.releaseCount - a.releaseCount || byTitle;
    case "last-played":
      return (
        (entryB?.lastPlayedMs ?? 0) - (entryA?.lastPlayedMs ?? 0) || byTitle
      );
    case "most-played":
      return (entryB?.totalPlayMs ?? 0) - (entryA?.totalPlayMs ?? 0) || byTitle;
  }
}

/**
 * Apply the active `filter` to `cards`, returning a new filtered + sorted array
 * (never mutating the input). A game passes when it satisfies **every** active
 * dimension: the query (title / developer / peer title), the platform (any of
 * its Releases is on it), and the release type (any of its Releases is of it).
 * [`ANY`] disables a dimension.
 */
export function filterGames(
  catalog: Catalog,
  cards: GameCardInfo[],
  filter: FilterState,
  playByGame: Map<string, PlayEntry> = new Map(),
): GameCardInfo[] {
  const byGame = releasesByGame(catalog);

  const matched = cards.filter((card) => {
    const releases = byGame.get(card.game.id) ?? [];
    if (filter.favoritesOnly && !card.game.favorite) return false;
    if (!matchesQuery(card, releases, filter.query)) return false;
    if (
      filter.platform !== ANY &&
      !releases.some((r) => r.platform === filter.platform)
    ) {
      return false;
    }
    if (
      filter.releaseType !== ANY &&
      !releases.some((r) => r.releaseType === filter.releaseType)
    ) {
      return false;
    }
    return true;
  });

  return matched.sort((a, b) => compareCards(a, b, filter.sort, playByGame));
}

/** Whether any dimension of `filter` is narrowing the result (drives empty-state copy). */
export function isFilterActive(filter: FilterState): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.platform !== ANY ||
    filter.releaseType !== ANY ||
    filter.favoritesOnly
  );
}
