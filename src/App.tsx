import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog, Release } from "./catalog";
import { peerReleases, primaryReleaseTitle } from "./catalogView";
import GameDetailsPanel from "./GameDetailsPanel";
import GameGrid from "./GameGrid";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";
import { useGridFocus } from "./useGridFocus";
import "./App.css";

/** Shape returned by the Rust `launch_test_game` command on success. */
interface LaunchResult {
  program: string;
  pid: number;
}

type LaunchStatus =
  | { kind: "idle" }
  | { kind: "launching" }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

type CatalogStatus =
  | { kind: "loading" }
  | { kind: "loaded"; catalog: Catalog }
  | { kind: "error"; message: string };

type ScanStatus =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "scanned"; gameCount: number }
  | { kind: "error"; message: string };

function App() {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    kind: "loading",
  });
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ kind: "idle" });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Catalog>("load_catalog")
      .then((catalog) => {
        if (!cancelled) setCatalogStatus({ kind: "loaded", catalog });
      })
      .catch((error) => {
        if (!cancelled)
          setCatalogStatus({ kind: "error", message: String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog =
    catalogStatus.kind === "loaded" ? catalogStatus.catalog : null;
  const games = catalog?.games ?? [];
  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;
  // The roving focus loop covers every Game card plus the two action buttons,
  // so arrow keys/D-pad can always reach them regardless of catalog size. It is
  // suspended while the details panel is open — the panel runs its own focus
  // loop, and only one may listen to the gamepad at a time.
  const launchButtonIndex = games.length;
  const rescanButtonIndex = launchButtonIndex + 1;
  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: rescanButtonIndex + 1,
      itemWidth: CARD_MIN_WIDTH_PX,
      gap: CARD_GAP_PX,
      enabled: selectedGame === null,
    });

  async function launchTestGame() {
    setLaunchStatus({ kind: "launching" });
    try {
      const result = await invoke<LaunchResult>("launch_test_game");
      setLaunchStatus({ kind: "launched", result });
    } catch (error) {
      setLaunchStatus({ kind: "error", message: String(error) });
    }
  }

  // Rescan the Vault: the Rust `scan_vault` command regenerates catalog.json
  // and returns the fresh Catalog, which we swap straight into state so the
  // grid refreshes without an app restart.
  async function rescanVault() {
    setScanStatus({ kind: "scanning" });
    try {
      const scanned = await invoke<Catalog>("scan_vault");
      setCatalogStatus({ kind: "loaded", catalog: scanned });
      setScanStatus({ kind: "scanned", gameCount: scanned.games.length });
    } catch (error) {
      setScanStatus({ kind: "error", message: String(error) });
    }
  }

  async function launchRelease(release: Release) {
    setLaunchStatus({ kind: "launching" });
    try {
      const result = await invoke<LaunchResult>("launch_release", {
        releaseId: release.id,
      });
      setLaunchStatus({ kind: "launched", result });
    } catch (error) {
      setLaunchStatus({ kind: "error", message: String(error) });
    }
  }

  const selectedReleases =
    catalog && selectedGame ? peerReleases(catalog, selectedGame) : [];
  const selectedTitle =
    catalog && selectedGame ? primaryReleaseTitle(catalog, selectedGame) : "";

  return (
    <main className="app">
      <div className="glass-card">
        <h1 className="title">Pixelcache</h1>
        <p className="subtitle">Lightweight cross-platform game launcher</p>

        {catalog && (
          <GameGrid
            catalog={catalog}
            containerRef={containerRef}
            focusedIndex={focusedIndex}
            registerItemRef={registerItemRef}
            focusItem={focusItem}
            onSelectGame={setSelectedGameId}
          />
        )}
        {catalogStatus.kind === "error" && (
          <p className="status" role="alert">
            Failed to load catalog: {catalogStatus.message}
          </p>
        )}

        <div className="actions">
          <button
            type="button"
            className={`launch-button${focusedIndex === launchButtonIndex ? " is-focused" : ""}`}
            onClick={launchTestGame}
            disabled={launchStatus.kind === "launching"}
            ref={registerItemRef(launchButtonIndex)}
            tabIndex={focusedIndex === launchButtonIndex ? 0 : -1}
          >
            {launchStatus.kind === "launching"
              ? "Launching…"
              : "Launch Test Game"}
          </button>

          <button
            type="button"
            className={`launch-button secondary${focusedIndex === rescanButtonIndex ? " is-focused" : ""}`}
            onClick={rescanVault}
            disabled={scanStatus.kind === "scanning"}
            ref={registerItemRef(rescanButtonIndex)}
            tabIndex={focusedIndex === rescanButtonIndex ? 0 : -1}
          >
            {scanStatus.kind === "scanning" ? "Scanning…" : "Rescan Vault"}
          </button>
        </div>

        <p className="status" role="status" aria-live="polite">
          {launchStatus.kind === "launched" &&
            `Launched ${launchStatus.result.program} (pid ${launchStatus.result.pid})`}
          {launchStatus.kind === "error" &&
            `Launch failed: ${launchStatus.message}`}
          {scanStatus.kind === "scanned" &&
            `Scan complete: ${scanStatus.gameCount} game${scanStatus.gameCount === 1 ? "" : "s"} found`}
          {scanStatus.kind === "error" && `Scan failed: ${scanStatus.message}`}
        </p>
      </div>

      {selectedGame && (
        <GameDetailsPanel
          title={selectedTitle}
          developer={selectedGame.developer}
          releases={selectedReleases}
          onLaunch={launchRelease}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </main>
  );
}

export default App;
