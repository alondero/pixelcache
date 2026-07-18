import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "./catalog";
import OnboardingWizard from "./OnboardingWizard";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

// The native folder picker (tauri-plugin-dialog). Each test points it at the
// folder(s) the "user" picks.
const openDialog = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));

const emptyCatalog: Catalog = {
  games: [],
  releases: [],
  decks: [],
  playlists: [],
  vaults: [],
};

/** What `scan_vault` returns once the wizard scans a snes folder. */
const scannedCatalog: Catalog = {
  games: [{ id: "super-mario-world", primaryReleaseId: "smw", relations: [] }],
  releases: [
    {
      id: "smw",
      gameId: "super-mario-world",
      title: "Super Mario World",
      platform: "snes",
      releaseType: "retail",
      vaultId: "snes-vault",
      filePath: "Super Mario World (USA).sfc",
    },
  ],
  decks: [
    {
      id: "snes-default",
      platform: "snes",
      executablePath: "snes9x",
      arguments: [],
      default: true,
    },
  ],
  playlists: [],
  vaults: [{ id: "snes-vault", platform: "snes", path: "C:/roms/snes" }],
};

/**
 * A stateful harness standing in for `App`: it feeds catalog updates back into
 * the wizard's `catalog` prop the way `App` does after `onCatalogChange`.
 */
function Harness({
  onFinish = () => {},
  onSkip = () => {},
}: {
  onFinish?: () => void;
  onSkip?: () => void;
}) {
  return <WizardWithState onFinish={onFinish} onSkip={onSkip} />;
}

import { useState } from "react";
function WizardWithState({
  onFinish,
  onSkip,
}: {
  onFinish: () => void;
  onSkip: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  return (
    <OnboardingWizard
      catalog={catalog}
      onCatalogChange={setCatalog}
      onFinish={onFinish}
      onSkip={onSkip}
    />
  );
}

function mockScan({
  scan = () => Promise.resolve(scannedCatalog),
  saveDecks = (decks: unknown) => Promise.resolve({ ...scannedCatalog, decks }),
  testDeck = () => Promise.resolve({ program: "snes9x", pid: 99 }),
}: {
  scan?: (vaults: unknown) => Promise<unknown>;
  saveDecks?: (decks: unknown) => Promise<unknown>;
  testDeck?: (deck: unknown) => Promise<unknown>;
} = {}) {
  invoke.mockImplementation(
    (
      command: string,
      args?: { vaults?: unknown; decks?: unknown; deck?: unknown },
    ) => {
      if (command === "scan_vault") return scan(args?.vaults);
      if (command === "save_decks") return saveDecks(args?.decks);
      if (command === "test_launch_deck") return testDeck(args?.deck);
      throw new Error(`unexpected invoke command: ${command}`);
    },
  );
}

async function reachVaultsStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /set up my library/i }));
}

/** Fill the first vault row: platform + games folder via the native picker. */
async function fillFirstVault(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/platform/i), "snes");
  openDialog.mockResolvedValueOnce("C:/roms/snes");
  await user.click(
    screen.getByRole("button", { name: /choose games folder/i }),
  );
  await screen.findByDisplayValue("C:/roms/snes");
}

describe("OnboardingWizard", () => {
  beforeEach(() => {
    invoke.mockReset();
    openDialog.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("welcomes the player and can be skipped", async () => {
    const onSkip = vi.fn();
    mockScan();
    const user = userEvent.setup();
    render(<Harness onSkip={onSkip} />);

    expect(
      screen.getByRole("heading", { name: /welcome to pixelcache/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("scans the chosen folders as Vaults and reports what it found", async () => {
    mockScan();
    const user = userEvent.setup();
    render(<Harness />);

    await reachVaultsStep(user);
    // Scan is gated until the row is complete.
    expect(
      screen.getByRole("button", { name: /scan for games/i }),
    ).toBeDisabled();

    await fillFirstVault(user);
    await user.click(screen.getByRole("button", { name: /scan for games/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("scan_vault", {
        vaults: [{ id: "snes-vault", platform: "snes", path: "C:/roms/snes" }],
      }),
    );
    // The wizard moves to the decks step and celebrates the result.
    expect(
      await screen.findByText(/found 1 game on 1 platform/i),
    ).toBeInTheDocument();
    // The seeded deck's suggested emulator is editable.
    expect(screen.getByLabelText(/emulator command/i)).toHaveValue("snes9x");
  });

  it("includes the optional art folder as the Vault's mediaPath", async () => {
    mockScan();
    const user = userEvent.setup();
    render(<Harness />);

    await reachVaultsStep(user);
    await fillFirstVault(user);
    openDialog.mockResolvedValueOnce("C:/art/snes");
    await user.click(
      screen.getByRole("button", { name: /choose art folder/i }),
    );
    await screen.findByDisplayValue("C:/art/snes");

    await user.click(screen.getByRole("button", { name: /scan for games/i }));

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("scan_vault", {
        vaults: [
          {
            id: "snes-vault",
            platform: "snes",
            path: "C:/roms/snes",
            mediaPath: "C:/art/snes",
          },
        ],
      }),
    );
  });

  it("stays on the folders step and shows the error when the scan fails", async () => {
    mockScan({ scan: () => Promise.reject("vault path does not exist") });
    const user = userEvent.setup();
    render(<Harness />);

    await reachVaultsStep(user);
    await fillFirstVault(user);
    await user.click(screen.getByRole("button", { name: /scan for games/i }));

    expect(
      await screen.findByText(/vault path does not exist/i),
    ).toBeInTheDocument();
    // Still on the folders step: the platform picker is still there.
    expect(screen.getByLabelText(/platform/i)).toBeInTheDocument();
  });

  it("saves edited decks, offers artwork, and hands off to the library", async () => {
    const onFinish = vi.fn();
    mockScan();
    const user = userEvent.setup();
    render(<Harness onFinish={onFinish} />);

    await reachVaultsStep(user);
    await fillFirstVault(user);
    await user.click(screen.getByRole("button", { name: /scan for games/i }));

    // Decks step: correct the emulator command, test it, continue.
    const executable = await screen.findByLabelText(/emulator command/i);
    await user.clear(executable);
    await user.type(executable, "C:/emulators/snes9x.exe");
    await user.click(screen.getByRole("button", { name: /test launch/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "test_launch_deck",
        expect.objectContaining({
          deck: expect.objectContaining({
            executablePath: "C:/emulators/snes9x.exe",
          }),
        }),
      ),
    );
    await user.click(screen.getByRole("button", { name: /save & continue/i }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "save_decks",
        expect.objectContaining({
          decks: [
            expect.objectContaining({
              id: "snes-default",
              executablePath: "C:/emulators/snes9x.exe",
            }),
          ],
        }),
      ),
    );

    // Artwork step: the scraper is offered; skip it.
    expect(
      await screen.findByRole("heading", { name: /add some artwork/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // Done step.
    await user.click(
      await screen.findByRole("button", { name: /start browsing/i }),
    );
    expect(onFinish).toHaveBeenCalled();
  });
});
