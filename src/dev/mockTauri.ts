import { mockIPC } from "@tauri-apps/api/mocks";
import type { Catalog, Deck, Vault } from "../catalog";
import sampleCatalog from "./sampleCatalog.json";

/**
 * Browser-only stand-in for the Rust bridge so `npm run dev` (frontend only,
 * no Tauri backend) can render the real UI — including the first-run
 * onboarding wizard, which is the fresh-install experience: `load_catalog`
 * starts *empty* (like a real install with no `catalog.json` yet), the
 * dialog plugin's folder picker answers with a plausible path, and
 * `scan_vault` "discovers" the sample library so the whole wizard journey is
 * walkable in a browser. Launch commands succeed with a fake pid instead of
 * spawning a process.
 *
 * Installed by main.tsx only in dev mode when the app runs outside a Tauri
 * WebView, so neither the mock nor the sample catalog JSON reaches production
 * builds or the real desktop app.
 */
export function installBrowserMocks(): void {
  // Mutable so scans, deck saves, favorites, and scraped artwork persist for
  // the session and the whole app observes updates, like the real backend.
  let catalog: Catalog = {
    games: [],
    releases: [],
    decks: [],
    playlists: [],
    vaults: [],
  };
  let nextPid = 1;
  let scrapeCount = 0;
  // The folder "picked" by each successive native-dialog call, cycling so the
  // games folder and the optional art folder look distinct in the wizard.
  const pickedFolders = [
    "C:/RetroGames/SNES",
    "C:/RetroGames/SNES-covers",
    "C:/RetroGames/N64",
  ];
  let dialogCount = 0;

  mockIPC(async (cmd, args) => {
    switch (cmd) {
      case "plugin:dialog|open":
        return pickedFolders[dialogCount++ % pickedFolders.length];
      case "load_catalog":
        return catalog;
      case "scan_vault": {
        // A scan "finds" the sample library; the caller's Vaults are upserted
        // over the sample's so the wizard's choices persist and the sample
        // releases keep their vault linkage.
        const scanned = structuredClone(sampleCatalog) as unknown as Catalog;
        const requested = (args as { vaults?: Vault[] } | undefined)?.vaults;
        if (requested?.length) {
          const vaults = [...(scanned.vaults ?? [])];
          for (const vault of requested) {
            const existing = vaults.findIndex((v) => v.id === vault.id);
            if (existing >= 0) vaults[existing] = vault;
            else vaults.push(vault);
          }
          scanned.vaults = vaults;
        }
        catalog = scanned;
        return catalog;
      }
      case "save_decks": {
        const decks =
          (args as { decks?: Deck[] } | undefined)?.decks ?? catalog.decks;
        catalog = { ...catalog, decks };
        return catalog;
      }
      case "test_launch_deck": {
        const deck = (args as { deck?: Deck } | undefined)?.deck;
        return {
          program: deck?.executablePath || "direct-launch",
          pid: nextPid++,
        };
      }
      case "launch_release": {
        const releaseId =
          (args as { releaseId?: string } | undefined)?.releaseId ??
          "unknown-release";
        return { program: `browser-mock:${releaseId}`, pid: nextPid++ };
      }
      case "load_play_history":
        return {};
      case "set_favorite": {
        const { gameId, favorite } = (args ?? {}) as {
          gameId?: string;
          favorite?: boolean;
        };
        catalog = {
          ...catalog,
          games: catalog.games.map((g) =>
            g.id === gameId ? { ...g, favorite: favorite === true } : g,
          ),
        };
        return catalog;
      }
      case "scrape_release_artwork": {
        const releaseId = (args as { releaseId?: string } | undefined)
          ?.releaseId;
        const release = catalog.releases.find((r) => r.id === releaseId);
        if (!release) throw new Error(`unknown release '${releaseId}'`);
        // Pace the loop so the progress UI is observable in a browser; keep
        // unit tests instant.
        if (!import.meta.env.TEST) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        // Every third release "has no thumbnail" so the summary shows a
        // realistic mixed result.
        const found = ++scrapeCount % 3 !== 0;
        if (found) {
          catalog = {
            ...catalog,
            releases: catalog.releases.map((r) =>
              r.id === release.id
                ? {
                    ...r,
                    media: {
                      ...r.media,
                      boxart: r.media?.boxart ?? `media/${r.id}/boxart.png`,
                      image: r.media?.image ?? `media/${r.id}/boxart.png`,
                      screenshot:
                        r.media?.screenshot ?? `media/${r.id}/screenshot.png`,
                    },
                  }
                : r,
            ),
          };
        }
        return {
          status: found ? "found" : "missing",
          slots: found ? ["boxart", "screenshot"] : [],
          catalog,
        };
      }
      default:
        throw new Error(`no browser mock for Tauri command "${cmd}"`);
    }
  });
}
