import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MediaView from "./MediaView";
import type { Catalog } from "./catalog";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function sampleCatalog(): Catalog {
  return {
    games: [
      {
        id: "star-fox-64",
        developer: "Nintendo EAD",
        primaryReleaseId: "star-fox-64-ntsc",
        relations: [],
      },
    ],
    releases: [
      {
        id: "star-fox-64-ntsc",
        gameId: "star-fox-64",
        title: "Star Fox 64",
        region: "NTSC",
        platform: "n64",
        releaseType: "retail",
        filePath: "star-fox-64/ntsc.z64",
        media: { image: "star-fox-64/cover.webp" },
      },
      {
        id: "lylat-wars-pal",
        gameId: "star-fox-64",
        title: "Lylat Wars",
        region: "PAL",
        platform: "n64",
        releaseType: "retail",
        filePath: "star-fox-64/pal.z64",
      },
    ],
    decks: [],
    playlists: [],
  };
}

function renderView(onCatalogChange = vi.fn()) {
  render(
    <MediaView catalog={sampleCatalog()} onCatalogChange={onCatalogChange} />,
  );
  return { onCatalogChange };
}

describe("MediaView", () => {
  afterEach(() => {
    cleanup();
    invoke.mockReset();
  });

  it("lists the game fallback row and every release", () => {
    renderView();
    expect(screen.getByText(/game fallback/i)).toBeInTheDocument();
    expect(screen.getByText("Lylat Wars")).toBeInTheDocument();
    // The release with media shows an assigned-slot badge.
    const starFoxRow = screen.getByText("NTSC · n64 · retail").closest("li");
    expect(
      within(starFoxRow as HTMLElement).getByText(/1 slot/i),
    ).toBeVisible();
  });

  it("edits a release's media and saves it via save_media", async () => {
    const user = userEvent.setup();
    const updated = sampleCatalog();
    invoke.mockResolvedValue(updated);
    const { onCatalogChange } = renderView();

    // Open the editor for the second release (no media yet).
    const lylatRow = screen.getByText("Lylat Wars").closest("li");
    await user.click(
      within(lylatRow as HTMLElement).getByRole("button", {
        name: /edit media/i,
      }),
    );

    await user.type(
      screen.getByLabelText("Cover image"),
      "star-fox-64/lylat.webp",
    );
    await user.click(screen.getByRole("button", { name: /save media/i }));

    expect(invoke).toHaveBeenCalledWith("save_media", {
      releaseId: "lylat-wars-pal",
      releaseMedia: { image: "star-fox-64/lylat.webp" },
    });
    expect(onCatalogChange).toHaveBeenCalledWith(updated);
  });

  it("edits the game-level fallback media", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue(sampleCatalog());
    renderView();

    const fallbackRow = screen.getByText(/game fallback/i).closest("li");
    await user.click(
      within(fallbackRow as HTMLElement).getByRole("button", {
        name: /edit media/i,
      }),
    );

    await user.type(screen.getByLabelText("Box art"), "star-fox-64/box.png");
    await user.click(screen.getByRole("button", { name: /save media/i }));

    expect(invoke).toHaveBeenCalledWith("save_media", {
      gameId: "star-fox-64",
      gameMedia: { boxart: "star-fox-64/box.png" },
    });
  });

  it("clears media when every field is emptied", async () => {
    const user = userEvent.setup();
    invoke.mockResolvedValue(sampleCatalog());
    renderView();

    const starFoxRow = screen.getByText("NTSC · n64 · retail").closest("li");
    await user.click(
      within(starFoxRow as HTMLElement).getByRole("button", {
        name: /edit media/i,
      }),
    );

    // The cover field is pre-filled from the existing media; clear it.
    await user.clear(screen.getByLabelText("Cover image"));
    await user.click(screen.getByRole("button", { name: /save media/i }));

    expect(invoke).toHaveBeenCalledWith("save_media", {
      releaseId: "star-fox-64-ntsc",
      releaseMedia: null,
    });
  });

  it("surfaces a save failure", async () => {
    const user = userEvent.setup();
    invoke.mockRejectedValue("disk full");
    renderView();

    const lylatRow = screen.getByText("Lylat Wars").closest("li");
    await user.click(
      within(lylatRow as HTMLElement).getByRole("button", {
        name: /edit media/i,
      }),
    );
    await user.type(screen.getByLabelText("Cover image"), "x.webp");
    await user.click(screen.getByRole("button", { name: /save media/i }));

    expect(await screen.findByText(/save failed: disk full/i)).toBeVisible();
  });
});
