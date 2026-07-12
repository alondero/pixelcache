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
};

function mockInvoke({
  catalog = () => Promise.resolve(sampleCatalog),
  launch = () => Promise.resolve({ program: "notepad.exe", pid: 4242 }),
  scan = () => Promise.resolve(scannedCatalog),
}: {
  catalog?: () => Promise<unknown>;
  launch?: () => Promise<unknown>;
  scan?: () => Promise<unknown>;
} = {}) {
  // Promises are constructed lazily (inside the mock implementation, not as
  // default-parameter values) so a rejection isn't created until `invoke` is
  // actually called with that command — otherwise vitest reports it as an
  // unhandled rejection even though the test does eventually await it.
  invoke.mockImplementation((command: string) => {
    if (command === "load_catalog") return catalog();
    if (command === "launch_test_game") return launch();
    if (command === "scan_vault") return scan();
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

  it("renders the Launch button", async () => {
    mockInvoke();
    render(<App />);
    expect(
      screen.getByRole("button", { name: /launch test game/i }),
    ).toBeInTheDocument();
  });

  it("invokes the launch_test_game command when the Launch button is clicked", async () => {
    mockInvoke();
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
    );

    expect(invoke).toHaveBeenCalledWith("launch_test_game");
  });

  it("shows the launched process details on success", async () => {
    mockInvoke();
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /launched notepad\.exe \(pid 4242\)/i,
    );
  });

  it("surfaces an error message when the launch fails", async () => {
    mockInvoke({ launch: () => Promise.reject("emulator not found") });
    render(<App />);

    await userEvent.click(
      screen.getByRole("button", { name: /launch test game/i }),
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
      screen.getByRole("button", { name: /rescan vault/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      /scan failed: no vault directory provided/i,
    );
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
});
