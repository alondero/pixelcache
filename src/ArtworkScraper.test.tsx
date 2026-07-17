import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ArtworkScraper from "./ArtworkScraper";
import type { Catalog } from "./catalog";
import type { ScrapeOutcome } from "./scrape";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function sampleCatalog(): Catalog {
  return {
    games: [
      { id: "chrono-trigger", primaryReleaseId: "ct-usa", relations: [] },
    ],
    releases: [
      {
        id: "ct-usa",
        gameId: "chrono-trigger",
        title: "Chrono Trigger",
        platform: "snes",
        releaseType: "retail",
        filePath: "Chrono Trigger (USA).sfc",
        vaultId: "snes-vault",
      },
      {
        id: "ct-jpn",
        gameId: "chrono-trigger",
        title: "Chrono Trigger",
        region: "Japan",
        platform: "snes",
        releaseType: "retail",
        filePath: "Chrono Trigger (Japan).sfc",
        vaultId: "snes-vault",
      },
    ],
    decks: [],
    playlists: [],
    vaults: [{ id: "snes-vault", platform: "snes", path: "/roms/snes" }],
  };
}

function outcome(status: ScrapeOutcome["status"]): ScrapeOutcome {
  return {
    status,
    slots: status === "found" ? ["boxart"] : [],
    catalog: sampleCatalog(),
  };
}

describe("ArtworkScraper", () => {
  afterEach(() => {
    cleanup();
    invoke.mockReset();
  });

  it("describes how many releases are missing artwork", () => {
    render(
      <ArtworkScraper catalog={sampleCatalog()} onCatalogChange={vi.fn()} />,
    );
    expect(screen.getByText(/2 releases/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /fetch artwork/i }),
    ).toBeEnabled();
  });

  it("says the library is fully covered when nothing is queued", () => {
    const full = sampleCatalog();
    for (const release of full.releases) {
      release.media = { boxart: "b.png", screenshot: "s.png" };
    }
    render(<ArtworkScraper catalog={full} onCatalogChange={vi.fn()} />);
    expect(screen.getByText(/every release has artwork/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /fetch artwork/i }),
    ).toBeDisabled();
  });

  it("scrapes each queued release sequentially and reports the summary", async () => {
    const user = userEvent.setup();
    const onCatalogChange = vi.fn();
    invoke
      .mockResolvedValueOnce(outcome("found"))
      .mockResolvedValueOnce(outcome("missing"));
    render(
      <ArtworkScraper
        catalog={sampleCatalog()}
        onCatalogChange={onCatalogChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /fetch artwork/i }));

    expect(invoke).toHaveBeenNthCalledWith(1, "scrape_release_artwork", {
      releaseId: "ct-usa",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "scrape_release_artwork", {
      releaseId: "ct-jpn",
    });
    // Every outcome's catalog is handed back so the grid fills in live.
    expect(onCatalogChange).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(
        /artwork found for 1 of 2 releases · 1 without a match/i,
      ),
    ).toBeVisible();
  });

  it("surfaces a scrape failure and stops the run", async () => {
    const user = userEvent.setup();
    invoke.mockRejectedValue("failed to fetch 'x': timed out");
    render(
      <ArtworkScraper catalog={sampleCatalog()} onCatalogChange={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /fetch artwork/i }));

    expect(
      await screen.findByText(/artwork fetch failed: .*timed out/i),
    ).toBeVisible();
    // The failed run stops instead of hammering a dead network.
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
