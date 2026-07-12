import { describe, expect, it } from "vitest";
import { gameCardInfos } from "./catalogView";
import type { Catalog } from "./catalog";

function catalog(): Catalog {
  return {
    games: [
      {
        id: "star-fox-64",
        developer: "Nintendo EAD",
        primaryReleaseId: "star-fox-64-ntsc",
        relations: [],
      },
      {
        id: "metroid",
        primaryReleaseId: "metroid-ntsc",
        relations: [],
      },
    ],
    releases: [
      {
        id: "star-fox-64-ntsc",
        gameId: "star-fox-64",
        title: "Star Fox 64",
        platform: "n64",
        releaseType: "retail",
        filePath: "star-fox-64/ntsc.z64",
      },
      {
        id: "lylat-wars-pal",
        gameId: "star-fox-64",
        title: "Lylat Wars",
        platform: "n64",
        releaseType: "retail",
        filePath: "star-fox-64/pal.z64",
      },
      {
        id: "metroid-ntsc",
        gameId: "metroid",
        title: "Metroid",
        platform: "nes",
        releaseType: "retail",
        filePath: "metroid/ntsc.nes",
      },
    ],
    decks: [],
    playlists: [],
  };
}

describe("gameCardInfos", () => {
  it("returns one card per game, using the primary release's title", () => {
    const cards = gameCardInfos(catalog());
    expect(cards.map((c) => c.title)).toEqual(["Star Fox 64", "Metroid"]);
  });

  it("counts every release grouped under each game", () => {
    const cards = gameCardInfos(catalog());
    expect(cards.find((c) => c.game.id === "star-fox-64")?.releaseCount).toBe(
      2,
    );
    expect(cards.find((c) => c.game.id === "metroid")?.releaseCount).toBe(1);
  });

  it("falls back to the game id when the primary release is missing", () => {
    const withDanglingPrimary: Catalog = {
      games: [
        {
          id: "orphan-game",
          primaryReleaseId: "does-not-exist",
          relations: [],
        },
      ],
      releases: [],
      decks: [],
      playlists: [],
    };
    const cards = gameCardInfos(withDanglingPrimary);
    expect(cards).toEqual([
      {
        game: withDanglingPrimary.games[0],
        title: "orphan-game",
        releaseCount: 0,
      },
    ]);
  });

  it("returns an empty list for an empty catalog", () => {
    expect(
      gameCardInfos({ games: [], releases: [], decks: [], playlists: [] }),
    ).toEqual([]);
  });
});
