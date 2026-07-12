import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog, Release } from "./catalog";
import type { LaunchResult } from "./launch";
import { peerReleases, primaryReleaseTitle } from "./catalogView";
import GameDetailsPanel from "./GameDetailsPanel";
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
 * The default "Games" screen: the grid of canonical Game cards, the tracer
 * "Launch Test Game" button, and the Game details panel (peer releases + Play).
 *
 * Owns its own `useGridFocus` so that only the mounted view polls the gamepad
 * (see `App` — views are mounted one at a time to avoid two focus loops
 * racing). The grid loop is additionally suspended while the details panel is
 * open, since the panel runs its own focus loop.
 */
function GamesView({ catalog }: GamesViewProps) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const games = catalog.games;
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

  const selectedReleases = selectedGame
    ? peerReleases(catalog, selectedGame)
    : [];
  const selectedTitle = selectedGame
    ? primaryReleaseTitle(catalog, selectedGame)
    : "";

  return (
    <>
      <GameGrid
        catalog={catalog}
        containerRef={containerRef}
        focusedIndex={focusedIndex}
        registerItemRef={registerItemRef}
        focusItem={focusItem}
        onSelectGame={setSelectedGameId}
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

      {selectedGame && (
        <GameDetailsPanel
          title={selectedTitle}
          developer={selectedGame.developer}
          releases={selectedReleases}
          onLaunch={launchRelease}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </>
  );
}

export default GamesView;
