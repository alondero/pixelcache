import { describe, expect, it } from "vitest";
import { playlistReleases } from "./playlistView";
import type { Catalog } from "./catalog";

function catalog(): Catalog {
  return {
    games: [],
    releases: [
      {
        id: "smb3-mix",
        gameId: "super-mario-bros-3",
        title: "Super Mario Bros. 3 Mix",
        platform: "snes",
        releaseType: "hack",
        filePath: "super-mario-bros-3/mix.sfc",
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
    playlists: [
      {
        id: "rom-hacks",
        name: "ROM Hacks",
        // Deliberately references the hack, then a dangling id, then a retail
        // release — order should be preserved and the dangling id dropped.
        releaseIds: ["smb3-mix", "does-not-exist", "metroid-ntsc"],
      },
    ],
  };
}

describe("playlistReleases", () => {
  it("resolves release ids to Releases, preserving order", () => {
    const releases = playlistReleases(catalog(), "rom-hacks");
    expect(releases.map((r) => r.id)).toEqual(["smb3-mix", "metroid-ntsc"]);
  });

  it("skips ids that have no matching Release", () => {
    const releases = playlistReleases(catalog(), "rom-hacks");
    expect(releases.some((r) => r.id === "does-not-exist")).toBe(false);
  });

  it("returns an empty list for an unknown playlist id", () => {
    expect(playlistReleases(catalog(), "no-such-playlist")).toEqual([]);
  });
});
