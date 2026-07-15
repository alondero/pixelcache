import type { Catalog, Game, Release } from "./catalog";
import { type MediaSlot, previewSource, resolveMedia } from "./media";

/** The card thumbnail to fetch over the media protocol: a Release + still slot. */
export interface GameCover {
  releaseId: string;
  slot: MediaSlot;
}

/** Display-ready summary of a Game card: its title, Release count, and cover art. */
export interface GameCardInfo {
  game: Game;
  title: string;
  releaseCount: number;
  /** The still artwork to show on the card, or `undefined` for a text-only card. */
  cover?: GameCover;
}

/**
 * Derive one card per Game, grouping its Releases by `gameId` and using the
 * primary release's title as the card's display title (falling back to the
 * game id if the primary release is missing from the catalog). The card cover is
 * the primary release's still artwork, with the Game's fallback media filling in.
 */
export function gameCardInfos(catalog: Catalog): GameCardInfo[] {
  return catalog.games.map((game) => ({
    game,
    title: primaryReleaseTitle(catalog, game),
    releaseCount: catalog.releases.filter((r) => r.gameId === game.id).length,
    cover: coverFor(catalog, game),
  }));
}

/**
 * The still thumbnail for a Game card: the primary release's resolved media (with
 * game-level fallback), reduced to a non-video preview slot. `undefined` when the
 * game has no still artwork, so the card falls back to its text-only layout.
 */
function coverFor(catalog: Catalog, game: Game): GameCover | undefined {
  const primary = catalog.releases.find((r) => r.id === game.primaryReleaseId);
  if (!primary) return undefined;
  const resolved = resolveMedia(primary.media, game.media);
  // Cards show a still, never an autoplaying video preview — that is the details
  // panel's job — so ignore the `video` slot when choosing the cover.
  const still = previewSource({ ...resolved, video: undefined });
  return still ? { releaseId: primary.id, slot: still.slot } : undefined;
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
