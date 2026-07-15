import { describe, expect, it } from "vitest";
import type { Catalog, Deck, Release } from "./catalog";
import {
  blankDeck,
  decksByPlatform,
  deckKind,
  hasRomPlaceholder,
  isDefaultDeck,
  makeDefault,
  parseArguments,
  previewCommand,
  removeDeck,
  selectDeck,
  upsertDeck,
  validateDeck,
  validateDecks,
} from "./decks";

function deck(overrides: Partial<Deck> & Pick<Deck, "id" | "platform">): Deck {
  return {
    executablePath: "emu",
    arguments: [],
    ...overrides,
  };
}

function release(
  overrides: Partial<Release> & Pick<Release, "id" | "platform">,
): Release {
  return {
    gameId: "g",
    title: "T",
    releaseType: "retail",
    filePath: "game.rom",
    ...overrides,
  };
}

function catalogWith(decks: Deck[]): Catalog {
  return { games: [], releases: [], decks, playlists: [] };
}

describe("deckKind / isDefaultDeck defaults", () => {
  it("defaults kind to emulator and default to false", () => {
    const d = deck({ id: "a", platform: "snes" });
    expect(deckKind(d)).toBe("emulator");
    expect(isDefaultDeck(d)).toBe(false);
  });

  it("reads explicit kind and default", () => {
    const d = deck({
      id: "a",
      platform: "pc",
      kind: "directLaunch",
      default: true,
    });
    expect(deckKind(d)).toBe("directLaunch");
    expect(isDefaultDeck(d)).toBe(true);
  });
});

describe("hasRomPlaceholder", () => {
  it("detects both placeholder spellings", () => {
    expect(hasRomPlaceholder(["-L", "core", "{rom}"])).toBe(true);
    expect(hasRomPlaceholder(["--", "{file}"])).toBe(true);
    expect(hasRomPlaceholder(["--fullscreen"])).toBe(false);
  });
});

describe("selectDeck", () => {
  const catalog = catalogWith([
    deck({ id: "n64-alt", platform: "n64", executablePath: "parallel" }),
    deck({
      id: "n64-default",
      platform: "n64",
      executablePath: "mupen",
      default: true,
    }),
    deck({ id: "snes", platform: "snes", executablePath: "snes9x" }),
  ]);

  it("prefers the platform default over first-listed", () => {
    const chosen = selectDeck(catalog, release({ id: "r", platform: "n64" }));
    expect(chosen?.id).toBe("n64-default");
  });

  it("honours a stored release deckId override", () => {
    const chosen = selectDeck(
      catalog,
      release({ id: "r", platform: "n64", deckId: "n64-alt" }),
    );
    expect(chosen?.id).toBe("n64-alt");
  });

  it("lets an explicit override beat the stored deckId", () => {
    const chosen = selectDeck(
      catalog,
      release({ id: "r", platform: "n64", deckId: "n64-alt" }),
      "n64-default",
    );
    expect(chosen?.id).toBe("n64-default");
  });

  it("falls back to the first deck when none is default", () => {
    const c = catalogWith([
      deck({ id: "first", platform: "gba", executablePath: "mgba" }),
      deck({ id: "second", platform: "gba", executablePath: "vba" }),
    ]);
    expect(selectDeck(c, release({ id: "r", platform: "gba" }))?.id).toBe(
      "first",
    );
  });

  it("returns null for a platform with no deck", () => {
    expect(
      selectDeck(catalog, release({ id: "r", platform: "ps2" })),
    ).toBeNull();
  });

  it("returns null for an unknown override id", () => {
    expect(
      selectDeck(catalog, release({ id: "r", platform: "n64" }), "nope"),
    ).toBeNull();
  });
});

describe("decksByPlatform", () => {
  it("sorts platforms and puts the default deck first", () => {
    const groups = decksByPlatform([
      deck({ id: "snes", platform: "snes" }),
      deck({ id: "n64-a", platform: "n64" }),
      deck({ id: "n64-b", platform: "n64", default: true }),
    ]);
    expect(groups.map((g) => g.platform)).toEqual(["n64", "snes"]);
    expect(groups[0].decks.map((d) => d.id)).toEqual(["n64-b", "n64-a"]);
  });
});

describe("previewCommand", () => {
  it("substitutes an in-place rom placeholder without appending", () => {
    const d = deck({
      id: "ra",
      platform: "n64",
      executablePath: "retroarch",
      arguments: ["-L", "core.so", "{rom}"],
    });
    expect(previewCommand(d)).toBe("retroarch -L core.so <rom>");
  });

  it("appends <rom> last when there is no placeholder", () => {
    const d = deck({
      id: "e",
      platform: "snes",
      executablePath: "snes9x",
      arguments: ["-fullscreen"],
    });
    expect(previewCommand(d)).toBe("snes9x -fullscreen <rom>");
  });

  it("runs the rom itself for a direct-launch deck", () => {
    const d = deck({
      id: "pc",
      platform: "pc",
      executablePath: "",
      kind: "directLaunch",
      arguments: ["--windowed"],
    });
    expect(previewCommand(d)).toBe("<rom> --windowed");
  });

  it("shows a placeholder program when the executable is blank", () => {
    const d = deck({ id: "e", platform: "snes", executablePath: "" });
    expect(previewCommand(d)).toBe("<emulator> <rom>");
  });
});

describe("argument parsing", () => {
  it("splits on whitespace and drops empties", () => {
    expect(parseArguments("  -L  core.so   {rom} ")).toEqual([
      "-L",
      "core.so",
      "{rom}",
    ]);
    expect(parseArguments("")).toEqual([]);
  });
});

describe("validateDeck / validateDecks", () => {
  it("requires an id and platform", () => {
    expect(validateDeck(deck({ id: "", platform: "snes" }))).toMatch(
      /id is required/i,
    );
    expect(validateDeck(deck({ id: "a", platform: "" }))).toMatch(
      /platform is required/i,
    );
  });

  it("requires an executable for an emulator deck only", () => {
    expect(
      validateDeck(deck({ id: "a", platform: "snes", executablePath: "" })),
    ).toMatch(/executable/i);
    expect(
      validateDeck(
        deck({
          id: "a",
          platform: "pc",
          executablePath: "",
          kind: "directLaunch",
        }),
      ),
    ).toBeNull();
  });

  it("rejects duplicate ids and multiple defaults per platform", () => {
    expect(
      validateDecks([
        deck({ id: "dup", platform: "snes" }),
        deck({ id: "dup", platform: "nes" }),
      ]),
    ).toMatch(/duplicate deck id/i);
    expect(
      validateDecks([
        deck({ id: "a", platform: "n64", default: true }),
        deck({ id: "b", platform: "n64", default: true }),
      ]),
    ).toMatch(/more than one default/i);
  });

  it("accepts a valid set", () => {
    expect(
      validateDecks([
        deck({ id: "a", platform: "n64", default: true }),
        deck({ id: "b", platform: "n64" }),
        deck({ id: "c", platform: "snes", default: true }),
      ]),
    ).toBeNull();
  });
});

describe("upsertDeck / removeDeck / makeDefault", () => {
  it("adds a new deck immutably", () => {
    const decks = [deck({ id: "a", platform: "snes" })];
    const next = upsertDeck(decks, deck({ id: "b", platform: "nes" }));
    expect(next).toHaveLength(2);
    expect(decks).toHaveLength(1); // input untouched
  });

  it("replaces an existing deck by id", () => {
    const decks = [deck({ id: "a", platform: "snes", executablePath: "old" })];
    const next = upsertDeck(
      decks,
      deck({ id: "a", platform: "snes", executablePath: "new" }),
    );
    expect(next).toHaveLength(1);
    expect(next[0].executablePath).toBe("new");
  });

  it("un-defaults other decks on the platform when adding a default", () => {
    const decks = [
      deck({ id: "a", platform: "n64", default: true }),
      deck({ id: "z", platform: "snes", default: true }),
    ];
    const next = upsertDeck(
      decks,
      deck({ id: "b", platform: "n64", default: true }),
    );
    expect(next.find((d) => d.id === "a")?.default).toBe(false);
    expect(next.find((d) => d.id === "b")?.default).toBe(true);
    // A different platform's default is left alone.
    expect(next.find((d) => d.id === "z")?.default).toBe(true);
  });

  it("removes by id", () => {
    const decks = [
      deck({ id: "a", platform: "snes" }),
      deck({ id: "b", platform: "nes" }),
    ];
    expect(removeDeck(decks, "a").map((d) => d.id)).toEqual(["b"]);
  });

  it("makeDefault sets one default per platform", () => {
    const decks = [
      deck({ id: "a", platform: "n64", default: true }),
      deck({ id: "b", platform: "n64" }),
      deck({ id: "c", platform: "snes", default: true }),
    ];
    const next = makeDefault(decks, "b");
    expect(next.find((d) => d.id === "a")?.default).toBe(false);
    expect(next.find((d) => d.id === "b")?.default).toBe(true);
    expect(next.find((d) => d.id === "c")?.default).toBe(true);
  });
});

describe("blankDeck", () => {
  it("seeds the id from the platform and avoids clashes", () => {
    expect(blankDeck([], "snes").id).toBe("snes");
    expect(blankDeck(["snes"], "snes").id).toBe("snes-2");
    expect(blankDeck(["snes", "snes-2"], "snes").id).toBe("snes-3");
  });

  it("falls back to a generic stem with no platform", () => {
    expect(blankDeck([]).id).toBe("deck");
    expect(blankDeck([]).kind).toBe("emulator");
  });
});
