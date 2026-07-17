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

// The event bridge is likewise Tauri-only. `listen` resolves to an unlisten
// function; tests that exercise the session-recorded flow fire `emitEvent`.
const eventHandlers = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>(),
);
const listen = vi.hoisted(() =>
  vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
    eventHandlers.set(event, handler);
    return Promise.resolve(() => eventHandlers.delete(event));
  }),
);
vi.mock("@tauri-apps/api/event", () => ({ listen }));

/** Deliver a backend event to the component under test, as Tauri would. */
function emitEvent(event: string, payload: unknown) {
  eventHandlers.get(event)?.({ payload });
}

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
  saveDecks = (decks: unknown) => Promise.resolve({ ...sampleCatalog, decks }),
  testDeck = () => Promise.resolve({ program: "retroarch", pid: 555 }),
  playHistory = () => Promise.resolve({}),
  setFavorite = (gameId: string, favorite: boolean) =>
    Promise.resolve({
      ...sampleCatalog,
      games: sampleCatalog.games.map((g) =>
        g.id === gameId ? { ...g, favorite } : g,
      ),
    }),
}: {
  catalog?: () => Promise<unknown>;
  launch?: () => Promise<unknown>;
  scan?: () => Promise<unknown>;
  launchRelease?: (releaseId: string) => Promise<unknown>;
  saveDecks?: (decks: unknown) => Promise<unknown>;
  testDeck?: (deck: unknown) => Promise<unknown>;
  playHistory?: () => Promise<unknown>;
  setFavorite?: (gameId: string, favorite: boolean) => Promise<unknown>;
} = {}) {
  // Promises are constructed lazily (inside the mock implementation, not as
  // default-parameter values) so a rejection isn't created until `invoke` is
  // actually called with that command — otherwise vitest reports it as an
  // unhandled rejection even though the test does eventually await it.
  invoke.mockImplementation(
    (
      command: string,
      args?: {
        releaseId?: string;
        decks?: unknown;
        deck?: unknown;
        gameId?: string;
        favorite?: boolean;
      },
    ) => {
      if (command === "load_catalog") return catalog();
      if (command === "launch_test_game") return launch();
      if (command === "scan_vault") return scan();
      if (command === "launch_release")
        return launchRelease(args?.releaseId ?? "");
      if (command === "save_decks") return saveDecks(args?.decks);
      if (command === "test_launch_deck") return testDeck(args?.deck);
      if (command === "load_play_history") return playHistory();
      if (command === "set_favorite")
        return setFavorite(args?.gameId ?? "", args?.favorite ?? false);
      throw new Error(`unexpected invoke command: ${command}`);
    },
  );
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

  // --- Settings / Decks screen (Phase 2: launch configuration) ---------------

  const decksCatalog: Catalog = {
    ...sampleCatalog,
    decks: [
      {
        id: "n64-mupen",
        platform: "n64",
        executablePath: "mupen64plus",
        arguments: ["--fullscreen"],
        default: true,
      },
    ],
  };

  it("switches to Settings and lists configured decks", async () => {
    mockInvoke({ catalog: () => Promise.resolve(decksCatalog) });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /settings/i }));

    expect(screen.getByText("n64-mupen")).toBeInTheDocument();
    // The command preview substitutes <rom> for the appended ROM path.
    expect(
      screen.getByText(/mupen64plus --fullscreen <rom>/i),
    ).toBeInTheDocument();
  });

  it("adds a deck via save_decks and refreshes from the returned catalog", async () => {
    const saveDecks = vi.fn((decks: unknown) =>
      Promise.resolve({ ...decksCatalog, decks }),
    );
    mockInvoke({ catalog: () => Promise.resolve(decksCatalog), saveDecks });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /settings/i }));
    await user.click(screen.getByRole("button", { name: /add deck/i }));

    await user.clear(screen.getByRole("textbox", { name: /deck id/i }));
    await user.type(
      screen.getByRole("textbox", { name: /deck id/i }),
      "snes9x",
    );
    await user.type(screen.getByRole("textbox", { name: /platform/i }), "snes");
    await user.type(
      screen.getByRole("textbox", { name: /executable/i }),
      "snes9x",
    );

    await user.click(screen.getByRole("button", { name: /^add deck$/i }));

    await waitFor(() => expect(saveDecks).toHaveBeenCalled());
    const savedDecks = saveDecks.mock.calls[0][0] as { id: string }[];
    expect(savedDecks.map((d) => d.id)).toContain("snes9x");
  });

  it("test-launches a deck via the test_launch_deck command", async () => {
    const testDeck = vi
      .fn()
      .mockResolvedValue({ program: "mupen64plus", pid: 999 });
    mockInvoke({ catalog: () => Promise.resolve(decksCatalog), testDeck });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /settings/i }));
    await user.click(screen.getByRole("button", { name: /^test$/i }));

    await waitFor(() => expect(testDeck).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      /test launched mupen64plus \(pid 999\)/i,
    );
  });

  it("deletes a deck through save_decks", async () => {
    const saveDecks = vi.fn((decks: unknown) =>
      Promise.resolve({ ...decksCatalog, decks }),
    );
    mockInvoke({ catalog: () => Promise.resolve(decksCatalog), saveDecks });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(screen.getByRole("tab", { name: /settings/i }));
    await user.click(screen.getByRole("button", { name: /delete/i }));

    // The only deck is removed, so save_decks persists an empty deck set.
    await waitFor(() => expect(saveDecks).toHaveBeenCalledWith([]));
  });
});

describe("Play activity & favorites", () => {
  beforeEach(() => {
    invoke.mockReset();
    eventHandlers.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const playedHistory = {
    "lylat-wars-pal": {
      playCount: 3,
      totalPlayMs: 2 * 3_600_000,
      lastPlayedMs: Date.now() - 3_600_000,
    },
  };

  it("shows a Continue Playing hero for the most recent release and resumes it", async () => {
    mockInvoke({ playHistory: () => Promise.resolve(playedHistory) });
    render(<App />);

    const hero = await screen.findByRole("button", {
      name: /continue playing lylat wars/i,
    });
    expect(hero).toHaveTextContent(/1h ago/i);
    expect(hero).toHaveTextContent(/played 3 times/i);
    expect(hero).toHaveTextContent(/2h\b/);

    await userEvent.click(hero);
    expect(invoke).toHaveBeenCalledWith("launch_release", {
      releaseId: "lylat-wars-pal",
    });
  });

  it("hides the hero while a filter narrows the grid", async () => {
    mockInvoke({ playHistory: () => Promise.resolve(playedHistory) });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /continue playing/i });
    await user.type(screen.getByRole("searchbox"), "metroid");
    expect(
      screen.queryByRole("button", { name: /continue playing/i }),
    ).not.toBeInTheDocument();
  });

  it("shows played-recency on cards instead of the release count", async () => {
    mockInvoke({ playHistory: () => Promise.resolve(playedHistory) });
    render(<App />);

    // Star Fox 64's card aggregates its PAL release's activity. The badge
    // appears once the async history load resolves, so wait for it.
    const card = (
      await screen.findAllByRole("gridcell", { name: /star fox 64/i })
    )[0];
    await waitFor(() => expect(card).toHaveTextContent(/played 1h ago/i));
  });

  it("updates the grid live when the backend records a session", async () => {
    mockInvoke();
    render(<App />);

    await screen.findByText("Metroid");
    expect(
      screen.queryByRole("button", { name: /continue playing/i }),
    ).not.toBeInTheDocument();

    emitEvent("play-session-recorded", {
      releaseId: "metroid-ntsc",
      entry: {
        playCount: 1,
        totalPlayMs: 10 * 60_000,
        lastPlayedMs: Date.now(),
      },
    });

    expect(
      await screen.findByRole("button", {
        name: /continue playing metroid/i,
      }),
    ).toBeInTheDocument();
  });

  it("toggles a favorite from the details panel and shows the card badge", async () => {
    const setFavorite = vi.fn((gameId: string, favorite: boolean) =>
      Promise.resolve({
        ...sampleCatalog,
        games: sampleCatalog.games.map((g) =>
          g.id === gameId ? { ...g, favorite } : g,
        ),
      }),
    );
    mockInvoke({ setFavorite });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      (await screen.findAllByRole("gridcell", { name: /star fox 64/i }))[0],
    );
    await user.click(
      await screen.findByRole("button", { name: /add to favorites/i }),
    );

    await waitFor(() =>
      expect(setFavorite).toHaveBeenCalledWith("star-fox-64", true),
    );
    // The toggle flips in place…
    expect(
      await screen.findByRole("button", { name: /remove from favorites/i }),
    ).toBeInTheDocument();
    // …and the grid card behind the panel now wears the filled heart badge
    // (`aria-pressed=true`, since the v2 badge is a button, not a static img).
    expect(
      await screen.findByRole("button", {
        name: /remove star-fox-64 from favorites/i,
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("filters the grid to favorites with the toolbar toggle", async () => {
    const favoritedCatalog = {
      ...sampleCatalog,
      games: sampleCatalog.games.map((g) =>
        g.id === "metroid" ? { ...g, favorite: true } : g,
      ),
    };
    mockInvoke({ catalog: () => Promise.resolve(favoritedCatalog) });
    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Star Fox 64");
    await user.click(
      screen.getByRole("button", { name: /show favorites only/i }),
    );

    expect(screen.getByText("Metroid")).toBeInTheDocument();
    expect(screen.queryByText("Star Fox 64")).not.toBeInTheDocument();
  });
});

describe("Play activity & favorites v2", () => {
  beforeEach(() => {
    invoke.mockReset();
    eventHandlers.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("one-press favorite from the grid (heart badge click)", async () => {
    const setFavorite = vi.fn((gameId: string, favorite: boolean) =>
      Promise.resolve({
        ...sampleCatalog,
        games: sampleCatalog.games.map((g) =>
          g.id === gameId ? { ...g, favorite } : g,
        ),
      }),
    );
    mockInvoke({ setFavorite });
    const user = userEvent.setup();
    render(<App />);

    // Star Fox 64 starts unfavorited: its grid heart badge is the outline (♡).
    const starFoxCard = (
      await screen.findAllByRole("gridcell", { name: /star fox 64/i })
    )[0];
    const heart = within(starFoxCard).getByRole("button", {
      name: /add star-fox-64 to favorites/i,
    });
    await user.click(heart);

    await waitFor(() =>
      expect(setFavorite).toHaveBeenCalledWith("star-fox-64", true),
    );
    // Clicking the badge must NOT have opened the details panel.
    expect(
      screen.queryByRole("dialog", { name: /star fox 64/i }),
    ).not.toBeInTheDocument();
    // And the heart filled in optimistically, before the IPC round-trip resolves.
    expect(
      within(
        (await screen.findAllByRole("gridcell", { name: /star fox 64/i }))[0],
      ).getByRole("button", {
        name: /remove star-fox-64 from favorites/i,
      }),
    ).toBeInTheDocument();
  });

  it("skips launches for releases whose filePath was emptied", async () => {
    // The vault-rescan between sessions can produce a release whose filePath
    // is empty (file moved/deleted). The hero must not surface it even when
    // it has the most-recent history row.
    const history = {
      "star-fox-64-ntsc": {
        playCount: 2,
        totalPlayMs: 30_000,
        lastPlayedMs: Date.now() - 60_000, // older than metroid's row below
      },
      "metroid-ntsc": {
        playCount: 1,
        totalPlayMs: 5_000,
        lastPlayedMs: Date.now(),
      },
    };
    const ghostCatalog = {
      ...sampleCatalog,
      releases: sampleCatalog.releases.map((r) =>
        r.id === "star-fox-64-ntsc" ? { ...r, filePath: "" } : r,
      ),
    };
    mockInvoke({
      playHistory: () => Promise.resolve(history),
      catalog: () => Promise.resolve(ghostCatalog),
    });
    render(<App />);

    // Star Fox 64 has the newer history row by date but its release is now
    // empty — so the hero should fall back to the still-launchable Metroid.
    expect(
      await screen.findByRole("button", { name: /continue playing metroid/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue playing star fox/i }),
    ).not.toBeInTheDocument();
  });
});
