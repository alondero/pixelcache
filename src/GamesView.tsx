import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog, Release } from "./catalog";
import type { LaunchResult } from "./launch";
import {
  gameCardInfos,
  peerReleases,
  primaryReleaseTitle,
} from "./catalogView";
import {
  availablePlatforms,
  availableReleaseTypes,
  DEFAULT_FILTER,
  filterGames,
  isFilterActive,
  type FilterState,
} from "./gamesFilter";
import GameDetailsPanel from "./GameDetailsPanel";
import GameGrid from "./GameGrid";
import GamesFilterBar from "./GamesFilterBar";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";
import { useGridFocus } from "./useGridFocus";

type LaunchStatus =
  | { kind: "idle" }
  | { kind: "launching" }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

type ScanStatus =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "scanned"; gameCount: number }
  | { kind: "error"; message: string };

interface GamesViewProps {
  catalog: Catalog;
  /** Called with a freshly scanned Catalog so the whole app (both tabs) refreshes. */
  onCatalogChange: (catalog: Catalog) => void;
}

/**
 * The default "Games" screen: the grid of canonical Game cards, the tracer
 * "Launch Test Game" and "Rescan Vault" action buttons, and the Game details
 * panel (peer releases + Play).
 *
 * Owns its own `useGridFocus` so that only the mounted view polls the gamepad
 * (see `App` — views are mounted one at a time to avoid two focus loops
 * racing). The grid loop is additionally suspended while the details panel is
 * open, since the panel runs its own focus loop.
 */
function GamesView({ catalog, onCatalogChange }: GamesViewProps) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ kind: "idle" });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  const games = catalog.games;
  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;

  // Derive one card per Game, then apply the active search/filter/sort. Memoised
  // so typing in the search box doesn't re-scan the catalog on unrelated
  // re-renders. The filtered set drives both the grid and the focus item count.
  const allCards = useMemo(() => gameCardInfos(catalog), [catalog]);
  const cards = useMemo(
    () => filterGames(catalog, allCards, filter),
    [catalog, allCards, filter],
  );
  const platforms = useMemo(() => availablePlatforms(catalog), [catalog]);
  const releaseTypes = useMemo(() => availableReleaseTypes(catalog), [catalog]);

  // The roving focus loop covers every *visible* Game card plus the two action
  // buttons, so arrow keys/D-pad can always reach them regardless of how many
  // cards the filter leaves. It is suspended while the details panel is open —
  // the panel runs its own focus loop, and only one may listen to the gamepad
  // at a time.
  const launchButtonIndex = cards.length;
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
  // and returns the fresh Catalog, which we hand back to `App` so state (and
  // both tabs' views) refresh without an app restart.
  async function rescanVault() {
    setScanStatus({ kind: "scanning" });
    try {
      const scanned = await invoke<Catalog>("scan_vault");
      onCatalogChange(scanned);
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

  const selectedReleases = selectedGame
    ? peerReleases(catalog, selectedGame)
    : [];
  const selectedTitle = selectedGame
    ? primaryReleaseTitle(catalog, selectedGame)
    : "";

  return (
    <>
      <GamesFilterBar
        filter={filter}
        onChange={setFilter}
        platforms={platforms}
        releaseTypes={releaseTypes}
        resultCount={cards.length}
        totalCount={allCards.length}
      />

      <GameGrid
        cards={cards}
        containerRef={containerRef}
        focusedIndex={focusedIndex}
        registerItemRef={registerItemRef}
        focusItem={focusItem}
        onSelectGame={setSelectedGameId}
      />

      {cards.length === 0 && (
        <p className="status" role="status">
          {allCards.length === 0
            ? "No games yet. Rescan a Vault to populate your library."
            : isFilterActive(filter)
              ? "No games match your search."
              : "No games to show."}
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

      {selectedGame && (
        <GameDetailsPanel
          title={selectedTitle}
          developer={selectedGame.developer}
          releases={selectedReleases}
          gameMedia={selectedGame.media}
          onLaunch={launchRelease}
          onClose={() => setSelectedGameId(null)}
        />
      )}
    </>
  );
}

export default GamesView;
