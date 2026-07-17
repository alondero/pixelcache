import { mockIPC } from "@tauri-apps/api/mocks";
import type { Catalog } from "../catalog";
import sampleCatalog from "../../src-tauri/resources/catalog.json";

/**
 * Browser-only stand-in for the Rust bridge so `npm run dev` (frontend only,
 * no Tauri backend) can render the real UI: `load_catalog` / `scan_vault`
 * serve the same sample catalog that ships as the Tauri resource, and the
 * launch commands succeed with a fake pid instead of spawning a process.
 *
 * Installed by main.tsx only in dev mode when the app runs outside a Tauri
 * WebView, so neither the mock nor the catalog JSON reaches production
 * builds or the real desktop app.
 */
export function installBrowserMocks(): void {
  // Mutable so the mock `scrape_release_artwork` can fill media in and the
  // whole app observes the update, like the real backend persisting.
  let catalog = structuredClone(sampleCatalog) as unknown as Catalog;
  let nextPid = 1;
  let scrapeCount = 0;

  mockIPC(async (cmd, args) => {
    switch (cmd) {
      case "load_catalog":
      case "scan_vault":
        return catalog;
      case "launch_test_game":
        return { program: "browser-mock", pid: nextPid++ };
      case "launch_release": {
        const releaseId =
          (args as { releaseId?: string } | undefined)?.releaseId ??
          "unknown-release";
        return { program: `browser-mock:${releaseId}`, pid: nextPid++ };
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
