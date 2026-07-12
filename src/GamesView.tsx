import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import type { LaunchResult } from "./launch";
import GameGrid from "./GameGrid";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";
import { useGridFocus } from "./useGridFocus";

type LaunchStatus =
  | { kind: "idle" }
  | { kind: "launching" }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

interface GamesViewProps {
  catalog: Catalog;
}

/**
 * The default "Games" screen: the grid of canonical Game cards plus the tracer
 * "Launch Test Game" button, wired into one roving-focus loop.
 *
 * Owns its own `useGridFocus` so that only the mounted view polls the gamepad
 * (see `App` — views are mounted one at a time to avoid two focus loops racing).
 */
function GamesView({ catalog }: GamesViewProps) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });

  const games = catalog.games;
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
    <>
      <GameGrid
        catalog={catalog}
        containerRef={containerRef}
        focusedIndex={focusedIndex}
        registerItemRef={registerItemRef}
      />

      <button
        type="button"
        className={`launch-button${focusedIndex === launchButtonIndex ? " is-focused" : ""}`}
        onClick={launchTestGame}
        disabled={launchStatus.kind === "launching"}
        ref={registerItemRef(launchButtonIndex)}
        tabIndex={focusedIndex === launchButtonIndex ? 0 : -1}
      >
        {launchStatus.kind === "launching" ? "Launching…" : "Launch Test Game"}
      </button>

      <p className="status" role="status" aria-live="polite">
        {launchStatus.kind === "launched" &&
          `Launched ${launchStatus.result.program} (pid ${launchStatus.result.pid})`}
        {launchStatus.kind === "error" &&
          `Launch failed: ${launchStatus.message}`}
      </p>
    </>
  );
}

export default GamesView;
