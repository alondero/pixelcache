import { describe, expect, it } from "vitest";
import type { Catalog, Release } from "./catalog";
import {
  formatLastPlayed,
  formatPlayCount,
  formatPlayTime,
  gamePlayEntry,
  mostRecentlyPlayed,
  playEntriesByGame,
  type PlayHistory,
} from "./playHistory";

function release(id: string, gameId: string): Release {
  return {
    id,
    gameId,
    title: id,
    platform: "n64",
    releaseType: "retail",
    filePath: `${id}.z64`,
  };
}

const catalog: Catalog = {
  games: [
    { id: "star-fox-64", primaryReleaseId: "sf-ntsc", relations: [] },
    { id: "metroid", primaryReleaseId: "metroid-ntsc", relations: [] },
  ],
  releases: [
    release("sf-ntsc", "star-fox-64"),
    release("lylat-pal", "star-fox-64"),
    release("metroid-ntsc", "metroid"),
  ],
  decks: [],
  playlists: [],
};

describe("gamePlayEntry", () => {
  it("returns null for a never-played game", () => {
    expect(gamePlayEntry(catalog.releases, {})).toBeNull();
  });

  it("aggregates across a game's releases", () => {
    // Playing the PAL and NTSC versions of the same Game must roll up into
    // one card-level entry: counts and time sum, last-played is the latest.
    const history: PlayHistory = {
      "sf-ntsc": { playCount: 2, totalPlayMs: 60_000, lastPlayedMs: 1_000 },
      "lylat-pal": { playCount: 1, totalPlayMs: 30_000, lastPlayedMs: 5_000 },
    };
    const releases = catalog.releases.filter((r) => r.gameId === "star-fox-64");
    expect(gamePlayEntry(releases, history)).toEqual({
      playCount: 3,
      totalPlayMs: 90_000,
      lastPlayedMs: 5_000,
    });
  });
});

describe("playEntriesByGame", () => {
  it("maps only played games", () => {
    const history: PlayHistory = {
      "metroid-ntsc": { playCount: 1, totalPlayMs: 10_000, lastPlayedMs: 42 },
    };
    const byGame = playEntriesByGame(catalog, history);
    expect(byGame.size).toBe(1);
    expect(byGame.get("metroid")?.playCount).toBe(1);
  });
});

describe("mostRecentlyPlayed", () => {
  it("returns null when nothing was played", () => {
    expect(mostRecentlyPlayed(catalog, {})).toBeNull();
  });

  it("picks the release with the latest session", () => {
    const history: PlayHistory = {
      "sf-ntsc": { playCount: 1, totalPlayMs: 1, lastPlayedMs: 100 },
      "metroid-ntsc": { playCount: 1, totalPlayMs: 1, lastPlayedMs: 900 },
    };
    expect(mostRecentlyPlayed(catalog, history)?.release.id).toBe(
      "metroid-ntsc",
    );
  });

  it("skips history rows whose release left the catalog", () => {
    // A stale entry (ROM removed from the Vault) must not become an
    // unlaunchable "Continue Playing" hero.
    const history: PlayHistory = {
      ghost: { playCount: 9, totalPlayMs: 1, lastPlayedMs: 9_999 },
      "sf-ntsc": { playCount: 1, totalPlayMs: 1, lastPlayedMs: 100 },
    };
    expect(mostRecentlyPlayed(catalog, history)?.release.id).toBe("sf-ntsc");
  });

  it("skips releases whose filePath was emptied by a rescan", () => {
    // A more-recent history row on a now-unlaunchable release must not
    // shadow a still-launchable earlier entry.
    const empty: Catalog = {
      ...catalog,
      releases: catalog.releases.map((r) =>
        r.id === "metroid-ntsc" ? { ...r, filePath: "" } : r,
      ),
    };
    const history: PlayHistory = {
      "metroid-ntsc": { playCount: 1, totalPlayMs: 1, lastPlayedMs: 1_000 },
      "sf-ntsc": { playCount: 1, totalPlayMs: 1, lastPlayedMs: 100 },
    };
    expect(mostRecentlyPlayed(empty, history)?.release.id).toBe("sf-ntsc");
  });
});

describe("formatLastPlayed", () => {
  const now = 1_000_000_000_000;

  it("covers the relative buckets", () => {
    expect(formatLastPlayed(now - 30_000, now)).toBe("Just now");
    expect(formatLastPlayed(now - 38 * 60_000, now)).toBe("38m ago");
    expect(formatLastPlayed(now - 5 * 3_600_000, now)).toBe("5h ago");
    expect(formatLastPlayed(now - 30 * 3_600_000, now)).toBe("Yesterday");
    expect(formatLastPlayed(now - 4 * 86_400_000, now)).toBe("4d ago");
  });

  it("falls back to a date beyond a week", () => {
    const twoWeeksAgo = now - 14 * 86_400_000;
    expect(formatLastPlayed(twoWeeksAgo, now)).toBe(
      new Date(twoWeeksAgo).toLocaleDateString(),
    );
  });
});

describe("formatPlayTime", () => {
  it("formats sub-minute, minutes, and hour+minute totals", () => {
    expect(formatPlayTime(30_000)).toBe("Under a minute");
    expect(formatPlayTime(45 * 60_000)).toBe("45m");
    expect(formatPlayTime(2 * 3_600_000)).toBe("2h");
    expect(formatPlayTime(4 * 3_600_000 + 20 * 60_000)).toBe("4h 20m");
  });
});

describe("formatPlayCount", () => {
  it("pluralises", () => {
    expect(formatPlayCount(1)).toBe("Played once");
    expect(formatPlayCount(12)).toBe("Played 12 times");
  });
});
