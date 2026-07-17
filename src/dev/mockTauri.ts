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
  const catalog = sampleCatalog as unknown as Catalog;
  let nextPid = 1;

  mockIPC((cmd, args) => {
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
      default:
        throw new Error(`no browser mock for Tauri command "${cmd}"`);
    }
  });
}
