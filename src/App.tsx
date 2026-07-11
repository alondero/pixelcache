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

function App() {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>({
    kind: "loading",
  });

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
  // The roving focus loop covers every Game card plus the Launch button, so
  // arrow keys/D-pad can always reach it regardless of catalog size.
  const launchButtonIndex = games.length;
  const { containerRef, focusedIndex, registerItemRef } = useGridFocus({
    itemCount: launchButtonIndex + 1,
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
    </main>
  );
}

export default App;
