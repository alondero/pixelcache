import { describe, expect, it } from "vitest";
import {
  gameCardInfos,
  peerReleases,
  primaryReleaseTitle,
} from "./catalogView";
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

describe("peerReleases", () => {
  it("lists a game's releases with the primary release first", () => {
    const data = catalog();
    // Make the *second* catalog entry the primary to prove reordering happens.
    data.games[0].primaryReleaseId = "lylat-wars-pal";

    const releases = peerReleases(data, data.games[0]);

    expect(releases.map((r) => r.id)).toEqual([
      "lylat-wars-pal",
      "star-fox-64-ntsc",
    ]);
  });

  it("keeps catalog order when the primary release is missing", () => {
    const data = catalog();
    data.games[0].primaryReleaseId = "does-not-exist";

    const releases = peerReleases(data, data.games[0]);

    expect(releases.map((r) => r.id)).toEqual([
      "star-fox-64-ntsc",
      "lylat-wars-pal",
    ]);
  });

  it("only includes releases belonging to the given game", () => {
    const data = catalog();
    const releases = peerReleases(data, data.games[1]);
    expect(releases.map((r) => r.id)).toEqual(["metroid-ntsc"]);
  });
});

describe("gameCardInfos covers", () => {
  it("derives a still cover from the primary release, ignoring video", () => {
    const data = catalog();
    data.releases[0].media = {
      video: "star-fox-64/preview.webm",
      image: "star-fox-64/cover.webp",
    };
    const cards = gameCardInfos(data);
    const starFox = cards.find((c) => c.game.id === "star-fox-64");
    // The card cover is a still (image), never the moving video preview.
    expect(starFox?.cover).toEqual({
      releaseId: "star-fox-64-ntsc",
      slot: "image",
    });
  });

  it("falls back to the game's media when the primary release has none", () => {
    const data = catalog();
    data.games[1].media = { boxart: "metroid/box.png" };
    const cards = gameCardInfos(data);
    const metroid = cards.find((c) => c.game.id === "metroid");
    expect(metroid?.cover).toEqual({
      releaseId: "metroid-ntsc",
      slot: "boxart",
    });
  });

  it("leaves the cover undefined when there is no still artwork", () => {
    const cards = gameCardInfos(catalog());
    expect(cards.every((c) => c.cover === undefined)).toBe(true);
  });
});

describe("primaryReleaseTitle", () => {
  it("returns the primary release's title", () => {
    const data = catalog();
    expect(primaryReleaseTitle(data, data.games[0])).toBe("Star Fox 64");
  });

  it("falls back to the game id when the primary release is missing", () => {
    const data = catalog();
    data.games[0].primaryReleaseId = "does-not-exist";
    expect(primaryReleaseTitle(data, data.games[0])).toBe("star-fox-64");
  });
});
