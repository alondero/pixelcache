import type { Catalog, Game } from "./catalog";

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
  return catalog.games.map((game) => {
    const releases = catalog.releases.filter((r) => r.gameId === game.id);
    const primary = releases.find((r) => r.id === game.primaryReleaseId);
    return {
      game,
      title: primary?.title ?? game.id,
      releaseCount: releases.length,
    };
  });
}
