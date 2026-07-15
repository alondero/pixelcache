import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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

const scannedCatalog: Catalog = {
  games: [{ id: "tetris", primaryReleaseId: "tetris-usa", relations: [] }],
  releases: [
    {
      id: "tetris-usa",
      gameId: "tetris",
      title: "Tetris",
      region: "USA",
      platform: "nes",
      releaseType: "retail",
      filePath: "Tetris (USA).nes",
    },
  ],
  decks: [],
  playlists: [],
};

function mockInvoke({
  catalog = () => Promise.resolve(sampleCatalog),
  launch = () => Promise.resolve({ program: "notepad.exe", pid: 4242 }),
  scan = () => Promise.resolve(scannedCatalog),
  launchRelease = () => Promise.resolve({ program: "mupen64plus", pid: 777 }),
}: {
  catalog?: () => Promise<unknown>;
  launch?: () => Promise<unknown>;
  scan?: () => Promise<unknown>;
  launchRelease?: (releaseId: string) => Promise<unknown>;
} = {}) {
  // Promises are constructed lazily (inside the mock implementation, not as
  // default-parameter values) so a rejection isn't created until `invoke` is
  // actually called with that command — otherwise vitest reports it as an
  // unhandled rejection even though the test does eventually await it.
  invoke.mockImplementation((command: string, args?: { releaseId: string }) => {
    if (command === "load_catalog") return catalog();
    if (command === "launch_test_game") return launch();
    if (command === "scan_vault") return scan();
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

    // Card 0 -> card 1 -> Launch button (index 2), the item after the last
    // game card in the roving focus loop.
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(launchButton).toHaveFocus();
  });

  it("renders the Rescan Vault button", async () => {
    mockInvoke();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: /rescan vault/i }),
    ).toBeInTheDocument();
  });

  it("invokes scan_vault and refreshes the grid with the returned catalog", async () => {
    mockInvoke();
    render(<App />);

    // The initially-loaded catalog shows Star Fox 64; scanning replaces it.
    await screen.findByText("Star Fox 64");

    await userEvent.click(
      screen.getByRole("button", { name: /rescan vault/i }),
    );

    expect(invoke).toHaveBeenCalledWith("scan_vault");
    expect(await screen.findByText("Tetris")).toBeInTheDocument();
    expect(screen.queryByText("Star Fox 64")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      /scan complete: 1 game found/i,
    );
  });

  it("surfaces an error message when the scan fails", async () => {
    mockInvoke({ scan: () => Promise.reject("no vault directory provided") });
    render(<App />);

    await userEvent.click(
      await screen.findByRole("button", { name: /rescan vault/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /scan failed: no vault directory provided/i,
    );
  });

  it("opens a details panel listing the game's peer releases when a card is selected", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      (await screen.findByText("Star Fox 64")).closest("button")!,
    );

    const panel = await screen.findByRole("dialog", { name: /star fox 64/i });
    expect(within(panel).getByText("Lylat Wars")).toBeInTheDocument();
    expect(
      within(panel).getAllByRole("button", { name: /^play /i }),
    ).toHaveLength(2);
  });

  it("invokes launch_release with the release id when Play is clicked", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      (await screen.findByText("Star Fox 64")).closest("button")!,
    );
    await user.click(
      await screen.findByRole("button", { name: /play lylat wars/i }),
    );

    expect(invoke).toHaveBeenCalledWith("launch_release", {
      releaseId: "lylat-wars-pal",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      /launched mupen64plus \(pid 777\)/i,
    );
  });

  it("surfaces launch_release failures in the status line", async () => {
    mockInvoke({
      launchRelease: () =>
        Promise.reject("no deck configured for platform 'n64'"),
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      (await screen.findByText("Star Fox 64")).closest("button")!,
    );
    await user.click(
      await screen.findByRole("button", { name: /play lylat wars/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launch failed: no deck configured/i,
    );
  });

  it("closes the details panel with Escape and returns focus to the grid", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    const card = (await screen.findByText("Star Fox 64")).closest("button")!;
    await user.click(card);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("applies a state-driven focus class, not just :focus-visible, so gamepad navigation stays visible", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    // Cards default to title A–Z, so Metroid is the first card and starts focused.
    const firstCard = await screen.findByText("Metroid");
    expect(firstCard.closest("button")).toHaveClass("is-focused");

    await user.keyboard("{ArrowRight}");
    expect(firstCard.closest("button")).not.toHaveClass("is-focused");
    expect(screen.getByText("Star Fox 64").closest("button")).toHaveClass(
      "is-focused",
    );
  });

  it("filters the grid live as the user types in the search box", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    expect(screen.getByText("Metroid")).toBeInTheDocument();

    await user.type(
      screen.getByRole("searchbox", { name: /search games/i }),
      "metroid",
    );

    expect(screen.getByText("Metroid")).toBeInTheDocument();
    expect(screen.queryByText("Star Fox 64")).not.toBeInTheDocument();
  });

  it("matches a game through a differently-titled peer release", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.type(
      screen.getByRole("searchbox", { name: /search games/i }),
      "lylat",
    );

    // "Lylat Wars" is Star Fox 64's PAL release, so the Star Fox 64 card stays.
    expect(screen.getByText("Star Fox 64")).toBeInTheDocument();
    expect(screen.queryByText("Metroid")).not.toBeInTheDocument();
  });

  it("shows a no-match message when the search excludes every game", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.type(
      screen.getByRole("searchbox", { name: /search games/i }),
      "zzz-nothing",
    );

    expect(screen.getByText(/no games match your search/i)).toBeInTheDocument();
  });

  it("filters the grid by platform", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    // Star Fox 64 is n64; Metroid is nes.
    await user.selectOptions(
      screen.getByRole("combobox", { name: /platform/i }),
      "nes",
    );

    expect(screen.getByText("Metroid")).toBeInTheDocument();
    expect(screen.queryByText("Star Fox 64")).not.toBeInTheDocument();
  });

  it("keeps the Launch button reachable by arrow keys after filtering shrinks the grid", async () => {
    mockInvoke();
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.type(
      screen.getByRole("searchbox", { name: /search games/i }),
      "metroid",
    );

    // Only one card remains; ArrowRight from it lands on the Launch button.
    const card = screen.getByText("Metroid").closest("button")!;
    card.focus();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("button", { name: /launch test game/i }),
    ).toHaveFocus();
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
