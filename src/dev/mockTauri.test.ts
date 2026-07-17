import { afterEach, describe, expect, it } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { clearMocks } from "@tauri-apps/api/mocks";
import type { Catalog, Release } from "../catalog";
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

afterEach(() => {
  clearMocks();
});

describe("browser dev mocks (npm run dev without the Rust bridge)", () => {
  it("serves a valid catalog — every Game's primaryReleaseId resolves", async () => {
    installBrowserMocks();

    const catalog = await invoke<Catalog>("load_catalog");

    expect(catalog.games.length).toBeGreaterThan(0);
    expect(catalog.releases.length).toBeGreaterThan(0);
    // The structural rule that the UI depends on: a Game card that can't
    // resolve its primary release renders no title.
    for (const game of catalog.games) {
      expect(
        catalog.releases.some((r) => r.id === game.primaryReleaseId),
        `primary release ${game.primaryReleaseId} missing for game ${game.id}`,
      ).toBe(true);
    }
  });

  it("serves the same catalog for scan_vault so Rescan works in a browser", async () => {
    installBrowserMocks();

    const scanned = await invoke<Catalog>("scan_vault");

    expect(scanned.games).toHaveLength(
      (await invoke<Catalog>("load_catalog")).games.length,
    );
    // Pick any release and confirm scan_vault preserves the linkage.
    const known = anyKnownRelease(scanned);
    expect(known).toBeDefined();
    expect(scanned.releases.some((r) => r.id === known!.id)).toBe(true);
  });

  it("returns a LaunchResult-shaped success for launch_release", async () => {
    installBrowserMocks();

    const catalog = await invoke<Catalog>("load_catalog");
    const known = anyKnownRelease(catalog);
    if (!known) return; // empty fixture → nothing meaningful to test

    const result = await invoke<LaunchResult>("launch_release", {
      releaseId: known.id,
    });

    expect(result.program).toContain(known.id);
    expect(result.pid).toBeGreaterThan(0);
  });

  it("returns a LaunchResult-shaped success for launch_test_game", async () => {
    installBrowserMocks();

    const result = await invoke<LaunchResult>("launch_test_game");

    expect(result.pid).toBeGreaterThan(0);
  });

  it("rejects unknown commands so typos surface instead of hanging", async () => {
    installBrowserMocks();

    await expect(invoke("not_a_real_command")).rejects.toThrow(
      /no browser mock/i,
    );
  });
});
