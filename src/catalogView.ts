import type { Catalog, Game, Release } from "./catalog";

/** Display-ready summary of a Game card: its title and how many Releases it groups. */
export interface GameCardInfo {
  game: Game;
  title: string;
  releaseCount: number;
}

/**
 * Derive one card per Game, grouping its Releases by `gameId` and using the
 * primary release's title as the card's display title (falling back to the
 * game id if the primary release is missing from the catalog).
 */
export function gameCardInfos(catalog: Catalog): GameCardInfo[] {
  return catalog.games.map((game) => ({
    game,
    title: primaryReleaseTitle(catalog, game),
    releaseCount: catalog.releases.filter((r) => r.gameId === game.id).length,
  }));
}

/**
 * The display title for a Game: the primary release's title, or the game's id
 * if the primary release is missing from the catalog. Shared by the grid
 * (for card titles) and the details panel (for the panel header) so the
 * fallback order stays in one place.
 */
export function primaryReleaseTitle(catalog: Catalog, game: Game): string {
  const primary = catalog.releases.find((r) => r.id === game.primaryReleaseId);
  return primary?.title ?? game.id;
}

/**
 * A game's peer Releases (regional versions, hacks, translations…) for the
 * details panel, with the primary release moved to the front so it is the one
 * highlighted — and previewed — by default. Other releases keep catalog order.
 */
export function peerReleases(catalog: Catalog, game: Game): Release[] {
  const releases = catalog.releases.filter((r) => r.gameId === game.id);
  const primaryIndex = releases.findIndex(
    (r) => r.id === game.primaryReleaseId,
  );
  if (primaryIndex <= 0) return releases;
  const [primary] = releases.splice(primaryIndex, 1);
  return [primary, ...releases];
}

/**
 * Resolve a catalog-relative media path (`release.media.video`/`.image`) to a
 * URL the WebView can load. For the MVP the Vault's media directory is served
 * from the frontend's `media/` root (`public/media/` in dev); a Tauri asset
 * protocol takes over when configurable Vaults land.
 */
export function mediaUrl(path: string): string {
  return `media/${path}`;
}
