import { afterEach, describe, expect, it } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";
import type { Catalog, Release, Vault } from "../catalog";
import { installBrowserMocks } from "./mockTauri";

interface LaunchResult {
  program: string;
  pid: number;
}

/** Pick a release whose `id` resolves and stays stable across edits to the
 *  fixture — used by the launch tests so they don't break when the sample
 *  catalog is pruned or extended. */
function anyKnownRelease(catalog: Catalog): Release | undefined {
  for (const game of catalog.games) {
    const r = catalog.releases.find((x) => x.id === game.primaryReleaseId);
    if (r) return r;
  }
  return catalog.releases[0];
}

/** Walk the mock through the onboarding scan, as the wizard would. */
async function scanSampleVault(): Promise<Catalog> {
  const vaults: Vault[] = [
    { id: "snes-vault", platform: "snes", path: "C:/RetroGames/SNES" },
  ];
  return invoke<Catalog>("scan_vault", { vaults });
}

afterEach(() => {
  clearMocks();
});

describe("browser dev mocks (npm run dev without the Rust bridge)", () => {
  it("starts with an empty catalog so the browser dev experience is onboarding", async () => {
    installBrowserMocks();

    const catalog = await invoke<Catalog>("load_catalog");

    expect(catalog.games).toHaveLength(0);
    expect(catalog.vaults ?? []).toHaveLength(0);
  });

  it("scan_vault populates the library and persists the chosen Vaults", async () => {
    installBrowserMocks();

    const scanned = await scanSampleVault();

    expect(scanned.games.length).toBeGreaterThan(0);
    expect(scanned.vaults?.some((v) => v.id === "snes-vault")).toBe(true);
    // The structural rule that the UI depends on: a Game card that can't
    // resolve its primary release renders no title.
    for (const game of scanned.games) {
      expect(
        scanned.releases.some((r) => r.id === game.primaryReleaseId),
        `primary release ${game.primaryReleaseId} missing for game ${game.id}`,
      ).toBe(true);
    }
    // Subsequent loads see the scanned library, like the persisted catalog.
    expect((await invoke<Catalog>("load_catalog")).games).toHaveLength(
      scanned.games.length,
    );
  });

  it("seeds Decks from the scan and lets save_decks update them", async () => {
    installBrowserMocks();

    const scanned = await scanSampleVault();
    expect(scanned.decks.length).toBeGreaterThan(0);

    const edited = scanned.decks.map((d) => ({
      ...d,
      executablePath: "C:/emulators/custom.exe",
    }));
    const saved = await invoke<Catalog>("save_decks", { decks: edited });
    expect(saved.decks[0].executablePath).toBe("C:/emulators/custom.exe");
  });

  it("answers the dialog plugin's folder picker with a plausible path", async () => {
    installBrowserMocks();

    const picked = await invoke<string>("plugin:dialog|open", {
      options: { directory: true },
    });

    expect(typeof picked).toBe("string");
    expect(picked.length).toBeGreaterThan(0);
  });

  it("returns a LaunchResult-shaped success for launch_release and test_launch_deck", async () => {
    installBrowserMocks();

    const catalog = await scanSampleVault();
    const known = anyKnownRelease(catalog);
    expect(known).toBeDefined();

    const result = await invoke<LaunchResult>("launch_release", {
      releaseId: known!.id,
    });
    expect(result.program).toContain(known!.id);
    expect(result.pid).toBeGreaterThan(0);

    const test = await invoke<LaunchResult>("test_launch_deck", {
      deck: catalog.decks[0],
    });
    expect(test.pid).toBeGreaterThan(0);
  });

  it("rejects unknown commands so typos surface instead of hanging", async () => {
    installBrowserMocks();

    await expect(invoke("not_a_real_command")).rejects.toThrow(
      /no browser mock/i,
    );
  });
});
