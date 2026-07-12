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

function App() {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    kind: "loading",
  });
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
  // The roving focus loop covers every Game card plus the Launch button, so
  // arrow keys/D-pad can always reach it regardless of catalog size. It is
  // suspended while the details panel is open — the panel runs its own focus
  // loop, and only one may listen to the gamepad at a time.
  const launchButtonIndex = games.length;
  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: launchButtonIndex + 1,
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

        <p className="status" role="status" aria-live="polite">
          {launchStatus.kind === "launched" &&
            `Launched ${launchStatus.result.program} (pid ${launchStatus.result.pid})`}
          {launchStatus.kind === "error" &&
            `Launch failed: ${launchStatus.message}`}
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
