import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import {
  draftFromMedia,
  emptyDraft,
  isMediaEmpty,
  mediaFromDraft,
  mediaSrc,
  previewSource,
  resolveMedia,
  setGameMedia,
  setReleaseMedia,
} from "./media";

describe("resolveMedia", () => {
  it("prefers the release's own slot over the game's", () => {
    const resolved = resolveMedia(
      { image: "release.webp" },
      { image: "game.webp", boxart: "game-box.png" },
    );
    expect(resolved.image).toBe("release.webp");
    // A slot the release omits falls back to the game.
    expect(resolved.boxart).toBe("game-box.png");
  });

  it("returns only the set slots", () => {
    expect(resolveMedia({ logo: "l.png" }, undefined)).toEqual({
      logo: "l.png",
    });
    expect(resolveMedia(undefined, undefined)).toEqual({});
  });
});

describe("previewSource", () => {
  it("prefers a video over any still", () => {
    expect(previewSource({ video: "v.webm", image: "i.webp" })).toEqual({
      kind: "video",
      slot: "video",
    });
  });

  it("picks the first available still in priority order", () => {
    expect(previewSource({ screenshot: "s.png", fanart: "f.png" })).toEqual({
      kind: "image",
      slot: "screenshot",
    });
    expect(previewSource({ boxart: "b.png" })).toEqual({
      kind: "image",
      slot: "boxart",
    });
  });

  it("returns null when nothing is set", () => {
    expect(previewSource({})).toBeNull();
  });
});

describe("mediaSrc", () => {
  it("addresses a release + slot over the media protocol", () => {
    // jsdom's user agent is not Windows, so the scheme-host form is used.
    expect(mediaSrc("star-fox-64-ntsc", "image")).toBe(
      "pixelcache-media://localhost/star-fox-64-ntsc/image",
    );
  });

  it("percent-encodes the release id", () => {
    expect(mediaSrc("my game", "boxart")).toBe(
      "pixelcache-media://localhost/my%20game/boxart",
    );
  });
});

describe("draft round-trips", () => {
  it("builds a trimmed media object, dropping blanks", () => {
    const draft = emptyDraft();
    draft.image = "  cover.webp  ";
    draft.logo = "   ";
    expect(mediaFromDraft(draft)).toEqual({ image: "cover.webp" });
  });

  it("returns undefined for an all-empty draft", () => {
    expect(mediaFromDraft(emptyDraft())).toBeUndefined();
  });

  it("fills a draft from existing media", () => {
    const draft = draftFromMedia({ image: "cover.webp", boxart: "box.png" });
    expect(draft.image).toBe("cover.webp");
    expect(draft.boxart).toBe("box.png");
    expect(draft.video).toBe("");
  });
});

describe("isMediaEmpty", () => {
  it("is true only when every slot is unset", () => {
    expect(isMediaEmpty({})).toBe(true);
    expect(isMediaEmpty({ image: "i.webp" })).toBe(false);
  });
});

function catalog(): Catalog {
  return {
    games: [{ id: "g", primaryReleaseId: "r", relations: [] }],
    releases: [
      {
        id: "r",
        gameId: "g",
        title: "T",
        platform: "snes",
        releaseType: "retail",
        filePath: "t.sfc",
      },
    ],
    decks: [],
    playlists: [],
  };
}

describe("setReleaseMedia / setGameMedia", () => {
  it("sets and clears a release's media without mutating the input", () => {
    const base = catalog();
    const withMedia = setReleaseMedia(base, "r", { image: "cover.webp" });
    expect(withMedia.releases[0].media).toEqual({ image: "cover.webp" });
    expect(base.releases[0].media).toBeUndefined();

    const cleared = setReleaseMedia(withMedia, "r", undefined);
    expect("media" in cleared.releases[0]).toBe(false);
  });

  it("sets a game's fallback media", () => {
    const withMedia = setGameMedia(catalog(), "g", { boxart: "box.png" });
    expect(withMedia.games[0].media).toEqual({ boxart: "box.png" });
  });

  it("leaves other entities untouched for an unknown id", () => {
    const base = catalog();
    const next = setReleaseMedia(base, "ghost", { image: "x.webp" });
    expect(next.releases[0].media).toBeUndefined();
  });
});
