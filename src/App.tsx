import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
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

  const games =
    catalogStatus.kind === "loaded" ? catalogStatus.catalog.games : [];
  // The roving focus loop covers every Game card plus the two action buttons,
  // so arrow keys/D-pad can always reach them regardless of catalog size.
  const launchButtonIndex = games.length;
  const rescanButtonIndex = launchButtonIndex + 1;
  const { containerRef, focusedIndex, registerItemRef } = useGridFocus({
    itemCount: rescanButtonIndex + 1,
    itemWidth: CARD_MIN_WIDTH_PX,
    gap: CARD_GAP_PX,
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
      const catalog = await invoke<Catalog>("scan_vault");
      setCatalogStatus({ kind: "loaded", catalog });
      setScanStatus({ kind: "scanned", gameCount: catalog.games.length });
    } catch (error) {
      setScanStatus({ kind: "error", message: String(error) });
    }
  }

  return (
    <main className="app">
      <div className="glass-card">
        <h1 className="title">Pixelcache</h1>
        <p className="subtitle">Lightweight cross-platform game launcher</p>

        {catalogStatus.kind === "loaded" && (
          <GameGrid
            catalog={catalogStatus.catalog}
            containerRef={containerRef}
            focusedIndex={focusedIndex}
            registerItemRef={registerItemRef}
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
    </main>
  );
}

export default App;
