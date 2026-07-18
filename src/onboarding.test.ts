import { describe, expect, it } from "vitest";
import type { Catalog } from "./catalog";
import {
  PLATFORM_OPTIONS,
  buildVaults,
  draftProblem,
  draftsReady,
  emptyVaultDraft,
  isFirstRun,
  platformLabel,
  scanSummary,
  stepIndex,
  vaultIdFor,
  WIZARD_STEPS,
} from "./onboarding";

const emptyCatalog: Catalog = {
  games: [],
  releases: [],
  decks: [],
  playlists: [],
};

describe("isFirstRun", () => {
  it("is true for a completely empty catalog (fresh install)", () => {
    expect(isFirstRun(emptyCatalog)).toBe(true);
  });

  it("is false once any vault is configured, even before games are found", () => {
    expect(
      isFirstRun({
        ...emptyCatalog,
        vaults: [{ id: "snes-vault", platform: "snes", path: "/roms" }],
      }),
    ).toBe(false);
  });

  it("is false once the library has games", () => {
    expect(
      isFirstRun({
        ...emptyCatalog,
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
      }),
    ).toBe(false);
  });
});

describe("platform options", () => {
  it("offers a curated list with unique ids and human labels", () => {
    expect(PLATFORM_OPTIONS.length).toBeGreaterThan(10);
    const ids = PLATFORM_OPTIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const option of PLATFORM_OPTIONS) {
      expect(option.label.trim()).not.toBe("");
    }
  });

  it("labels a known platform and falls back to the raw id", () => {
    expect(platformLabel("snes")).toMatch(/super nintendo/i);
    expect(platformLabel("dridgeland")).toBe("dridgeland");
  });
});

describe("vault drafts", () => {
  it("requires a platform and a games folder", () => {
    expect(draftProblem(emptyVaultDraft())).toMatch(/platform/i);
    expect(
      draftProblem({ platform: "snes", path: " ", mediaPath: "" }),
    ).toMatch(/folder/i);
    expect(
      draftProblem({ platform: "snes", path: "C:\\roms\\snes", mediaPath: "" }),
    ).toBeNull();
  });

  it("is ready only when every draft is valid and at least one exists", () => {
    expect(draftsReady([])).toBe(false);
    expect(draftsReady([emptyVaultDraft()])).toBe(false);
    expect(
      draftsReady([{ platform: "snes", path: "/roms", mediaPath: "" }]),
    ).toBe(true);
  });

  it("builds Vaults with stable ids, including mediaPath only when set", () => {
    const vaults = buildVaults([
      { platform: "snes", path: " /roms/snes ", mediaPath: " /art/snes " },
      { platform: "snes", path: "/roms/snes-jp", mediaPath: "" },
    ]);
    expect(vaults[0]).toEqual({
      id: "snes-vault",
      platform: "snes",
      path: "/roms/snes",
      mediaPath: "/art/snes",
    });
    // A second vault for the same platform gets a distinct id and no
    // mediaPath key at all (absent, not empty — mirrors the Rust serde skip).
    expect(vaults[1].id).toBe("snes-vault-2");
    expect("mediaPath" in vaults[1]).toBe(false);
  });

  it("vaultIdFor skips over taken ids", () => {
    expect(vaultIdFor("nes", [])).toBe("nes-vault");
    expect(vaultIdFor("nes", ["nes-vault", "nes-vault-2"])).toBe("nes-vault-3");
  });
});

describe("wizard steps", () => {
  it("progress from welcome to done and index correctly", () => {
    expect(WIZARD_STEPS[0].id).toBe("welcome");
    expect(WIZARD_STEPS[WIZARD_STEPS.length - 1].id).toBe("done");
    expect(stepIndex("welcome")).toBe(0);
    expect(stepIndex("done")).toBe(WIZARD_STEPS.length - 1);
  });
});

describe("scanSummary", () => {
  it("counts games and platforms in plain English", () => {
    const catalog: Catalog = {
      ...emptyCatalog,
      games: [
        { id: "a", primaryReleaseId: "ra", relations: [] },
        { id: "b", primaryReleaseId: "rb", relations: [] },
      ],
      releases: [
        {
          id: "ra",
          gameId: "a",
          title: "A",
          platform: "snes",
          releaseType: "retail",
          filePath: "a.sfc",
        },
        {
          id: "rb",
          gameId: "b",
          title: "B",
          platform: "nes",
          releaseType: "retail",
          filePath: "b.nes",
        },
      ],
    };
    expect(scanSummary(catalog)).toBe("Found 2 games across 2 platforms");
    expect(
      scanSummary({
        ...catalog,
        releases: catalog.releases.slice(0, 1),
        games: catalog.games.slice(0, 1),
      }),
    ).toBe("Found 1 game on 1 platform");
    expect(scanSummary(emptyCatalog)).toMatch(/no games found/i);
  });
});
