import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import {
  progressWith,
  scrapeQueue,
  startProgress,
  summaryText,
} from "./scrape";

function catalog(): Catalog {
  return {
    games: [
      {
        id: "star-fox-64",
        primaryReleaseId: "sf64-usa",
        relations: [],
        media: { boxart: "shared/box.png", screenshot: "shared/shot.png" },
      },
      { id: "chrono-trigger", primaryReleaseId: "ct-usa", relations: [] },
    ],
    releases: [
      // Fully covered via its Game's fallback media — not queued.
      {
        id: "sf64-usa",
        gameId: "star-fox-64",
        title: "Star Fox 64",
        platform: "n64",
        releaseType: "retail",
        filePath: "Star Fox 64 (USA).z64",
      },
      // Missing everything — queued.
      {
        id: "ct-usa",
        gameId: "chrono-trigger",
        title: "Chrono Trigger",
        platform: "snes",
        releaseType: "retail",
        filePath: "Chrono Trigger (USA).sfc",
      },
      // Has box art of its own but no screenshot — still queued.
      {
        id: "ct-jpn",
        gameId: "chrono-trigger",
        title: "Chrono Trigger",
        region: "Japan",
        platform: "snes",
        releaseType: "retail",
        filePath: "Chrono Trigger (Japan).sfc",
        media: { boxart: "ct/box.png" },
      },
    ],
    decks: [],
    playlists: [],
  };
}

describe("scrapeQueue", () => {
  it("queues only releases with an unresolved boxart or screenshot", () => {
    const queue = scrapeQueue(catalog());
    expect(queue.map((t) => t.releaseId)).toEqual(["ct-usa", "ct-jpn"]);
    expect(queue[0]).toEqual({
      releaseId: "ct-usa",
      title: "Chrono Trigger",
      platform: "snes",
    });
  });

  it("is empty when every release resolves both slots", () => {
    const full = catalog();
    full.releases = full.releases.filter((r) => r.id === "sf64-usa");
    expect(scrapeQueue(full)).toEqual([]);
  });
});

describe("progress", () => {
  it("starts at zero with the queue size as total", () => {
    expect(startProgress(3)).toEqual({
      total: 3,
      done: 0,
      found: 0,
      missing: 0,
      unavailable: 0,
    });
  });

  it("tallies each outcome status into the right bucket", () => {
    let p = startProgress(4);
    p = progressWith(p, "found");
    p = progressWith(p, "missing");
    p = progressWith(p, "noVault");
    p = progressWith(p, "unsupported");
    expect(p).toEqual({
      total: 4,
      done: 4,
      found: 1,
      missing: 1,
      unavailable: 2,
    });
  });

  it("counts a skip as unavailable", () => {
    const p = progressWith(startProgress(1), "skipped");
    expect(p.unavailable).toBe(1);
  });
});

describe("summaryText", () => {
  it("reports found, missing, and unavailable counts", () => {
    let p = startProgress(3);
    p = progressWith(p, "found");
    p = progressWith(p, "missing");
    p = progressWith(p, "noVault");
    expect(summaryText(p)).toBe(
      "Artwork found for 1 of 3 releases · 1 without a match · 1 unavailable",
    );
  });

  it("celebrates a full sweep", () => {
    let p = startProgress(2);
    p = progressWith(p, "found");
    p = progressWith(p, "found");
    expect(summaryText(p)).toBe("Artwork found for all 2 releases");
  });

  it("handles a single release grammatically", () => {
    const p = progressWith(startProgress(1), "found");
    expect(summaryText(p)).toBe("Artwork found for all 1 release");
  });
});
