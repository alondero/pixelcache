import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import { gameCardInfos } from "./catalogView";
import type { PlayEntry } from "./playHistory";
import {
  ANY,
  availablePlatforms,
  availableReleaseTypes,
  DEFAULT_FILTER,
  filterGames,
  isFilterActive,
  type FilterState,
} from "./gamesFilter";

/**
 * A small mixed catalog: two n64 games (one with a differently-titled PAL peer
 * release), a snes game that also has a hack, and a nes game — enough to
 * exercise title/peer/developer search, platform + type filters, and sorting.
 */
function catalog(): Catalog {
  return {
    games: [
      {
        id: "star-fox-64",
        developer: "Nintendo EAD",
        primaryReleaseId: "star-fox-64-ntsc",
        relations: [],
      },
      { id: "metroid", primaryReleaseId: "metroid-ntsc", relations: [] },
      {
        id: "super-mario-bros-3",
        developer: "Nintendo",
        primaryReleaseId: "smb3-ntsc",
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
      {
        id: "smb3-ntsc",
        gameId: "super-mario-bros-3",
        title: "Super Mario Bros. 3",
        platform: "snes",
        releaseType: "retail",
        filePath: "smb3/ntsc.sfc",
      },
      {
        id: "smb3-mix",
        gameId: "super-mario-bros-3",
        title: "Super Mario Bros. 3 Mix",
        platform: "snes",
        releaseType: "hack",
        filePath: "smb3/mix.sfc",
      },
    ],
    decks: [],
    playlists: [],
  };
}

function run(
  filter: Partial<FilterState>,
  playByGame?: Map<string, PlayEntry>,
  data: Catalog = catalog(),
): string[] {
  const state = { ...DEFAULT_FILTER, ...filter };
  return filterGames(data, gameCardInfos(data), state, playByGame).map(
    (c) => c.game.id,
  );
}

describe("availablePlatforms", () => {
  it("lists the distinct platforms present, sorted alphabetically", () => {
    expect(availablePlatforms(catalog())).toEqual(["n64", "nes", "snes"]);
  });

  it("is empty for a catalog with no releases", () => {
    expect(
      availablePlatforms({ games: [], releases: [], decks: [], playlists: [] }),
    ).toEqual([]);
  });
});

describe("availableReleaseTypes", () => {
  it("lists only the release types present, in canonical order", () => {
    // The catalog has retail + hack; beta/translation/homebrew are absent.
    expect(availableReleaseTypes(catalog())).toEqual(["retail", "hack"]);
  });
});

describe("filterGames — query", () => {
  it("returns every game (title A–Z) for a blank query and no filters", () => {
    expect(run({})).toEqual(["metroid", "star-fox-64", "super-mario-bros-3"]);
  });

  it("matches a game by its card title, case-insensitively", () => {
    expect(run({ query: "metroid" })).toEqual(["metroid"]);
    expect(run({ query: "METROID" })).toEqual(["metroid"]);
  });

  it("matches a game through a differently-titled peer release", () => {
    // "Lylat Wars" is the PAL release of Star Fox 64.
    expect(run({ query: "lylat" })).toEqual(["star-fox-64"]);
  });

  it("matches a game by its developer", () => {
    expect(run({ query: "Nintendo EAD" })).toEqual(["star-fox-64"]);
  });

  it("trims surrounding whitespace from the query", () => {
    expect(run({ query: "  metroid  " })).toEqual(["metroid"]);
  });

  it("returns nothing when no game matches", () => {
    expect(run({ query: "zelda" })).toEqual([]);
  });
});

describe("filterGames — platform + type", () => {
  it("keeps only games with a release on the chosen platform", () => {
    expect(run({ platform: "n64" })).toEqual(["star-fox-64"]);
    expect(run({ platform: "snes" })).toEqual(["super-mario-bros-3"]);
  });

  it("keeps only games with a release of the chosen type", () => {
    expect(run({ releaseType: "hack" })).toEqual(["super-mario-bros-3"]);
  });

  it("ANY on a dimension disables that filter", () => {
    expect(run({ platform: ANY, releaseType: ANY }).length).toBe(3);
  });

  it("combines query, platform, and type as AND", () => {
    // A snes hack whose title contains "mario".
    expect(
      run({ query: "mario", platform: "snes", releaseType: "hack" }),
    ).toEqual(["super-mario-bros-3"]);
    // Same game, but ask for an n64 release it doesn't have -> excluded.
    expect(run({ query: "mario", platform: "n64" })).toEqual([]);
  });
});

describe("filterGames — sort", () => {
  it("sorts by title ascending and descending", () => {
    expect(run({ sort: "title-asc" })).toEqual([
      "metroid",
      "star-fox-64",
      "super-mario-bros-3",
    ]);
    expect(run({ sort: "title-desc" })).toEqual([
      "super-mario-bros-3",
      "star-fox-64",
      "metroid",
    ]);
  });

  it("sorts by release count (desc), breaking ties by title", () => {
    // star-fox-64 and super-mario-bros-3 both have 2 releases and tie-break
    // alphabetically ("Star Fox 64" < "Super Mario Bros. 3"); metroid has 1.
    expect(run({ sort: "releases-desc" })).toEqual([
      "star-fox-64",
      "super-mario-bros-3",
      "metroid",
    ]);
  });
});

describe("filterGames — favorites", () => {
  function favoritedCatalog(): Catalog {
    const data = catalog();
    data.games = data.games.map((g) =>
      g.id === "metroid" ? { ...g, favorite: true } : g,
    );
    return data;
  }

  it("favoritesOnly keeps only favorited games", () => {
    expect(run({ favoritesOnly: true }, undefined, favoritedCatalog())).toEqual(
      ["metroid"],
    );
  });

  it("favoritesOnly combines with the other dimensions as AND", () => {
    expect(
      run(
        { favoritesOnly: true, platform: "n64" },
        undefined,
        favoritedCatalog(),
      ),
    ).toEqual([]);
  });
});

describe("filterGames — play-activity sorts", () => {
  const play = new Map<string, PlayEntry>([
    [
      "metroid",
      { playCount: 1, totalPlayMs: 10 * 60_000, lastPlayedMs: 5_000 },
    ],
    [
      "super-mario-bros-3",
      { playCount: 4, totalPlayMs: 90 * 60_000, lastPlayedMs: 2_000 },
    ],
  ]);

  it("last-played puts the most recent first and never-played last, by title", () => {
    expect(run({ sort: "last-played" }, play)).toEqual([
      "metroid",
      "super-mario-bros-3",
      "star-fox-64",
    ]);
  });

  it("most-played orders by total play time, never-played last", () => {
    expect(run({ sort: "most-played" }, play)).toEqual([
      "super-mario-bros-3",
      "metroid",
      "star-fox-64",
    ]);
  });

  it("play-activity sorts degrade to title order without history", () => {
    expect(run({ sort: "last-played" })).toEqual([
      "metroid",
      "star-fox-64",
      "super-mario-bros-3",
    ]);
  });
});

describe("filterGames — purity", () => {
  it("does not mutate the input cards array", () => {
    const data = catalog();
    const cards = gameCardInfos(data);
    const before = cards.map((c) => c.game.id);
    filterGames(data, cards, { ...DEFAULT_FILTER, sort: "title-desc" });
    expect(cards.map((c) => c.game.id)).toEqual(before);
  });
});

describe("isFilterActive", () => {
  it("is false for the default (neutral) filter", () => {
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false);
  });

  it("is false when only the sort differs from default", () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, sort: "title-desc" })).toBe(
      false,
    );
  });

  it("is true when a query or a filter narrows the result", () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, query: "x" })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, platform: "n64" })).toBe(true);
    expect(isFilterActive({ ...DEFAULT_FILTER, releaseType: "hack" })).toBe(
      true,
    );
    expect(isFilterActive({ ...DEFAULT_FILTER, favoritesOnly: true })).toBe(
      true,
    );
  });
});
