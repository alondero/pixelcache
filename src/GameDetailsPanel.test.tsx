import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import GameDetailsPanel from "./GameDetailsPanel";
import type { Release } from "./catalog";

const releases: Release[] = [
  {
    id: "star-fox-64-ntsc",
    gameId: "star-fox-64",
    title: "Star Fox 64",
    region: "NTSC",
    platform: "n64",
    releaseType: "retail",
    filePath: "star-fox-64/ntsc.z64",
    media: { video: "star-fox-64/preview.webm" },
  },
  {
    id: "lylat-wars-pal",
    gameId: "star-fox-64",
    title: "Lylat Wars",
    region: "PAL",
    platform: "n64",
    releaseType: "retail",
    filePath: "star-fox-64/pal.z64",
    media: { image: "star-fox-64/cover.webp" },
  },
  {
    id: "star-fox-64-hack",
    gameId: "star-fox-64",
    title: "Star Fox 64 Hack",
    platform: "n64",
    releaseType: "hack",
    filePath: "star-fox-64/hack.z64",
  },
];

function renderPanel({
  onLaunch = vi.fn(),
  onClose = vi.fn(),
}: {
  onLaunch?: (release: Release) => void;
  onClose?: () => void;
} = {}) {
  render(
    <GameDetailsPanel
      title="Star Fox 64"
      developer="Nintendo EAD"
      releases={releases}
      onLaunch={onLaunch}
      onClose={onClose}
      now={Date.now()}
    />,
  );
  return { onLaunch, onClose };
}

/** The `<video>` element currently shown in the preview pane, if any. */
function previewVideo(): HTMLVideoElement | null {
  return screen.queryByTestId("release-preview-video");
}

describe("GameDetailsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders as a dialog titled after the game, listing every peer release", () => {
    renderPanel();
    const dialog = screen.getByRole("dialog", { name: /star fox 64/i });
    expect(within(dialog).getByText("Lylat Wars")).toBeInTheDocument();
    expect(within(dialog).getByText("Star Fox 64 Hack")).toBeInTheDocument();
    expect(
      within(dialog).getAllByRole("button", { name: /^play /i }),
    ).toHaveLength(3);
  });

  it("shows the region, platform, and release type as row metadata", () => {
    renderPanel();
    expect(screen.getByText("PAL · n64 · retail")).toBeInTheDocument();
    expect(screen.getByText("n64 · hack")).toBeInTheDocument();
  });

  it("plays the highlighted release's webm video preview", () => {
    renderPanel();
    // The first (primary) release is highlighted initially and has a video.
    const video = previewVideo();
    expect(video).not.toBeNull();
    // The preview is served over the media protocol, addressed by release + slot.
    expect(video?.src).toContain("star-fox-64-ntsc/video");
    // Muted looping autoplay is what WebViews allow without a user gesture.
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("loop");
  });

  it("falls back to cover art when the highlighted release has no video", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.hover(screen.getByRole("button", { name: /play lylat wars/i }));

    expect(previewVideo()).toBeNull();
    const image = screen.getByRole("img", { name: /lylat wars/i });
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("lylat-wars-pal/image"),
    );
  });

  it("uses game-level media when the highlighted release has none", async () => {
    const user = userEvent.setup();
    render(
      <GameDetailsPanel
        title="Star Fox 64"
        releases={releases}
        gameMedia={{ boxart: "star-fox-64/box.png" }}
        onLaunch={vi.fn()}
        onClose={vi.fn()}
        now={Date.now()}
      />,
    );

    // The hack release sets no media of its own, so it inherits the game's boxart.
    await user.hover(
      screen.getByRole("button", { name: /play star fox 64 hack/i }),
    );

    const image = screen.getByRole("img", { name: /star fox 64 hack/i });
    expect(image).toHaveAttribute(
      "src",
      expect.stringContaining("star-fox-64-hack/boxart"),
    );
  });

  it("shows a placeholder when the highlighted release has no media at all", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.hover(
      screen.getByRole("button", { name: /play star fox 64 hack/i }),
    );

    expect(previewVideo()).toBeNull();
    expect(screen.getByText(/no preview/i)).toBeInTheDocument();
  });

  it("updates the preview when focus moves between releases via arrow keys", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(previewVideo()).not.toBeNull();

    // The panel's roving focus starts on the first release row.
    await user.keyboard("{ArrowDown}");

    expect(previewVideo()).toBeNull();
    expect(screen.getByRole("img", { name: /lylat wars/i })).toBeVisible();
  });

  it("launches the clicked release", async () => {
    const user = userEvent.setup();
    const { onLaunch } = renderPanel();

    await user.click(screen.getByRole("button", { name: /play lylat wars/i }));

    expect(onLaunch).toHaveBeenCalledWith(releases[1]);
  });

  it("closes via the Close button", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when Escape is pressed", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});
