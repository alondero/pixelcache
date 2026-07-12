import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Catalog } from "./catalog";

// The Tauri IPC bridge is unavailable in jsdom, so we mock `invoke` and assert
// that the UI wires commands correctly and reacts to their success/failure —
// without needing a running Tauri backend.
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const sampleCatalog: Catalog = {
  games: [
    {
      id: "star-fox-64",
      developer: "Nintendo EAD",
      primaryReleaseId: "star-fox-64-ntsc",
      relations: [],
    },
    {
      id: "metroid",
      primaryReleaseId: "metroid-ntsc",
      relations: [],
    },
  ],
  releases: [
    {
      id: "star-fox-64-ntsc",
      gameId: "star-fox-64",
      title: "Star Fox 64",
      platform: "n64",
      releaseType: "retail",
      filePath: "star-fox-64/ntsc.z64",
    },
    {
      id: "lylat-wars-pal",
      gameId: "star-fox-64",
      title: "Lylat Wars",
      platform: "n64",
      releaseType: "retail",
      filePath: "star-fox-64/pal.z64",
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
      id: "favourites",
      name: "Favourites",
      releaseIds: ["lylat-wars-pal", "metroid-ntsc"],
    },
    {
      id: "n64-only",
      name: "N64 Only",
      releaseIds: ["star-fox-64-ntsc"],
    },
  ],
};

function mockInvoke({
  catalog = () => Promise.resolve(sampleCatalog),
  launch = () => Promise.resolve({ program: "notepad.exe", pid: 4242 }),
  launchRelease = () => Promise.resolve({ program: "mupen64plus", pid: 777 }),
}: {
  catalog?: () => Promise<unknown>;
  launch?: () => Promise<unknown>;
  launchRelease?: (releaseId: string) => Promise<unknown>;
} = {}) {
  // Promises are constructed lazily (inside the mock implementation, not as
  // default-parameter values) so a rejection isn't created until `invoke` is
  // actually called with that command — otherwise vitest reports it as an
  // unhandled rejection even though the test does eventually await it.
  invoke.mockImplementation((command: string, args?: { releaseId: string }) => {
    if (command === "load_catalog") return catalog();
    if (command === "launch_test_game") return launch();
    if (command === "launch_release")
      return launchRelease(args?.releaseId ?? "");
    throw new Error(`unexpected invoke command: ${command}`);
  });
}

describe("App", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loads the catalog once on mount", async () => {
    mockInvoke();
    render(<App />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("load_catalog"));
  });

  it("renders a Game card for each game in the loaded catalog", async () => {
    mockInvoke();
    render(<App />);

    expect(await screen.findByText("Star Fox 64")).toBeInTheDocument();
    expect(screen.getByText("Metroid")).toBeInTheDocument();
    expect(screen.getByText(/2 releases/i)).toBeInTheDocument();
    expect(screen.getByText(/1 release\b/i)).toBeInTheDocument();
  });

  it("shows an error message when the catalog fails to load", async () => {
    mockInvoke({ catalog: () => Promise.reject("catalog.json missing") });
    render(<App />);

    expect(
      await screen.findByText(/catalog\.json missing/i),
    ).toBeInTheDocument();
  });

  it("renders the Launch button once the catalog has loaded", async () => {
    mockInvoke();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: /launch test game/i }),
    ).toBeInTheDocument();
  });

  it("invokes the launch_test_game command when the Launch button is clicked", async () => {
    mockInvoke();
    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: /launch test game/i }),
    );

    expect(invoke).toHaveBeenCalledWith("launch_test_game");
  });

  it("shows the launched process details on success", async () => {
    mockInvoke();
    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: /launch test game/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launched notepad\.exe \(pid 4242\)/i,
    );
  });

  it("surfaces an error message when the launch fails", async () => {
    mockInvoke({ launch: () => Promise.reject("emulator not found") });
    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: /launch test game/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launch failed: emulator not found/i,
    );
  });

  it("keeps the Launch button reachable via arrow-key navigation from the last game card", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    const launchButton = screen.getByRole("button", {
      name: /launch test game/i,
    });

    // Card 0 -> card 1 -> right wraps to the last item in the roving focus
    // loop, which is the Launch button.
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(launchButton).toHaveFocus();
  });

  it("applies a state-driven focus class, not just :focus-visible, so gamepad navigation stays visible", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    const firstCard = await screen.findByText("Star Fox 64");
    expect(firstCard.closest("button")).toHaveClass("is-focused");

    await user.keyboard("{ArrowRight}");
    expect(firstCard.closest("button")).not.toHaveClass("is-focused");
    expect(screen.getByText("Metroid").closest("button")).toHaveClass(
      "is-focused",
    );
  });

  it("renders a Playlists tab and switches to it when selected", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /playlists/i }));

    // The default (first) playlist is selected, showing its releases.
    expect(screen.getByRole("tab", { name: /favourites/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Lylat Wars")).toBeInTheDocument();
    expect(screen.getByText("Metroid")).toBeInTheDocument();
  });

  it("lets the user select between different playlist collections", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /playlists/i }));

    // Favourites (default) does not include Star Fox 64 NTSC...
    expect(screen.queryByText("Star Fox 64")).not.toBeInTheDocument();

    // ...selecting "N64 Only" swaps the release list.
    await user.click(screen.getByRole("tab", { name: /n64 only/i }));
    expect(screen.getByText("Star Fox 64")).toBeInTheDocument();
    expect(screen.queryByText("Lylat Wars")).not.toBeInTheDocument();
  });

  it("launches a release from a playlist via the launch_release command", async () => {
    const launchRelease = vi
      .fn()
      .mockResolvedValue({ program: "mupen64plus", pid: 777 });
    mockInvoke({ launchRelease });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /playlists/i }));
    await user.click(screen.getByRole("gridcell", { name: /lylat wars/i }));

    expect(invoke).toHaveBeenCalledWith("launch_release", {
      releaseId: "lylat-wars-pal",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /launched mupen64plus \(pid 777\)/i,
    );
  });

  it("surfaces an error when launching a release from a playlist fails", async () => {
    mockInvoke({
      launchRelease: () => Promise.reject("no deck configured for platform"),
    });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /playlists/i }));
    await user.click(screen.getByRole("gridcell", { name: /lylat wars/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launch failed: no deck configured for platform/i,
    );
  });
});
