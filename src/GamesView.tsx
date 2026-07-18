import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Catalog, Game, Release } from "./catalog";
import type { LaunchResult, LaunchStatus } from "./launch";
import {
  gameCardInfos,
  peerReleases,
  primaryReleaseTitle,
} from "./catalogView";
import ContinuePlayingHero from "./ContinuePlayingHero";
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
import LaunchStatusLine from "./LaunchStatusLine";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";
import { resolveMedia, stillSource } from "./media";
import {
  mostRecentlyPlayed,
  playEntriesByGame,
  SESSION_RECORDED_EVENT,
  type PlayHistory,
  type SessionRecorded,
} from "./playHistory";
import { useGridFocus } from "./useGridFocus";
import { useMinuteTick } from "./useMinuteTick";

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
/** Return a new catalog with one Game's `favorite` flag set/cleared. Pure so the
 * optimistic-update path is unit-testable in isolation. An unknown id is a
 * tolerated no-op (the backend's `set_favorite` is likewise tolerant). */
function stampFavorite(
  catalog: Catalog,
  gameId: string,
  favorite: boolean,
): Catalog {
  return {
    ...catalog,
    games: catalog.games.map((g) => (g.id === gameId ? { ...g, favorite } : g)),
  };
}

function GamesView({ catalog, onCatalogChange }: GamesViewProps) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });
  const [scanStatus, setScanStatus] = useState<ScanStatus>({ kind: "idle" });
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);
  const [history, setHistory] = useState<PlayHistory>({});
  // One re-render per minute while the window is in the foreground so the
  // "Played X ago" / "Continue Playing …" captions advance without the user
  // having to focus or move the controller. Background tabs are throttled
  // by `useMinuteTick`'s `visibilitychange` handler.
  const nowTick = useMinuteTick();
  const nowMs = Date.now() + nowTick;

  const games = catalog.games;
  const selectedGame = games.find((g) => g.id === selectedGameId) ?? null;

  // Hydrate play activity once, then keep it live: the backend emits a
  // session-recorded event the moment a game exits (after the window is
  // restored), so the hero and badges update without polling or a rescan.
  useEffect(() => {
    let cancelled = false;
    invoke<PlayHistory>("load_play_history")
      .then((loaded) => {
        if (!cancelled) setHistory(loaded);
      })
      .catch((error) => {
        // Play activity is decoration, not core function: a failed load means
        // badges are absent, never a broken Games screen.
        console.error(`Failed to load play history: ${error}`);
      });
    const unlisten = listen<SessionRecorded>(SESSION_RECORDED_EVENT, (event) =>
      setHistory((current) => ({
        ...current,
        [event.payload.releaseId]: event.payload.entry,
      })),
    );
    return () => {
      cancelled = true;
      unlisten.then((stop) => stop());
    };
  }, []);

  // Derive one card per Game, then apply the active search/filter/sort. Memoised
  // so typing in the search box doesn't re-scan the catalog on unrelated
  // re-renders. The filtered set drives both the grid and the focus item count.
  const allCards = useMemo(() => gameCardInfos(catalog), [catalog]);
  const playByGame = useMemo(
    () => playEntriesByGame(catalog, history),
    [catalog, history],
  );
  const cards = useMemo(
    () => filterGames(catalog, allCards, filter, playByGame),
    [catalog, allCards, filter, playByGame],
  );
  const platforms = useMemo(() => availablePlatforms(catalog), [catalog]);
  const releaseTypes = useMemo(() => availableReleaseTypes(catalog), [catalog]);

  // The "Continue Playing" hero: the most recently played Release, shown only
  // on the unfiltered library view — a narrowed grid is a search result, and a
  // hero pinned above it would not match the query.
  const hero = useMemo(
    () =>
      isFilterActive(filter) ? null : mostRecentlyPlayed(catalog, history),
    [catalog, history, filter],
  );
  const heroGame = hero
    ? (games.find((g) => g.id === hero.release.gameId) ?? null)
    : null;
  // The hero previews a still (never an autoplaying video — that is the
  // details panel's job), resolved with the Game-level artwork fallback.
  const heroCover = hero
    ? stillSource(resolveMedia(hero.release.media, heroGame?.media))
    : null;
  const heroCount = hero ? 1 : 0;

  // The roving focus loop covers the hero (a leading full-width row), every
  // *visible* Game card, and the two action buttons, so arrow keys/D-pad can
  // always reach them regardless of how many cards the filter leaves. It is
  // suspended while the details panel is open — the panel runs its own focus
  // loop, and only one may listen to the gamepad at a time.
  const launchButtonIndex = heroCount + cards.length;
  const rescanButtonIndex = launchButtonIndex + 1;
  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: rescanButtonIndex + 1,
      itemWidth: CARD_MIN_WIDTH_PX,
      gap: CARD_GAP_PX,
      enabled: selectedGame === null,
      leadingFullWidth: heroCount,
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

  // Flip a Game's favorite flag. Optimistic by default: stamp the change onto
  // the catalog the user sees **before** the IPC round-trip so the heart fills
  // in the same frame as the controller press — and roll back on rejection
  // so the UI never lies about the persisted state. The details panel passes
  // `optimistic: false` because the panel is in a modal focus loop already
  // and the heart is part of the user's deliberate confirmation path.
  async function toggleFavorite(game: Game, optimistic = true) {
    const nextFavorite = !game.favorite;
    let rollback: Catalog = catalog;
    if (optimistic) {
      rollback = catalog;
      onCatalogChange(stampFavorite(catalog, game.id, nextFavorite));
    }
    try {
      const updated = await invoke<Catalog>("set_favorite", {
        gameId: game.id,
        favorite: nextFavorite,
      });
      onCatalogChange(updated);
    } catch (error) {
      console.error(`Failed to update favorite: ${error}`);
      if (optimistic) onCatalogChange(rollback);
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

      {hero && (
        <ContinuePlayingHero
          release={hero.release}
          entry={hero.entry}
          coverSlot={heroCover?.slot}
          isFocused={focusedIndex === 0}
          registerRef={registerItemRef(0)}
          onFocus={() => focusItem(0)}
          onResume={launchRelease}
          now={nowMs}
        />
      )}

      <GameGrid
        cards={cards}
        containerRef={containerRef}
        focusedIndex={focusedIndex}
        registerItemRef={registerItemRef}
        focusItem={focusItem}
        onSelectGame={setSelectedGameId}
        onToggleFavorite={(game) => toggleFavorite(game)}
        indexOffset={heroCount}
        playByGame={playByGame}
        now={nowMs}
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

      <LaunchStatusLine status={launchStatus}>
        {scanStatus.kind === "scanned" &&
          `Scan complete: ${scanStatus.gameCount} game${scanStatus.gameCount === 1 ? "" : "s"} found`}
        {scanStatus.kind === "error" && `Scan failed: ${scanStatus.message}`}
      </LaunchStatusLine>

      {selectedGame && (
        <GameDetailsPanel
          title={selectedTitle}
          developer={selectedGame.developer}
          releases={selectedReleases}
          gameMedia={selectedGame.media}
          history={history}
          favorite={selectedGame.favorite === true}
          onToggleFavorite={() => toggleFavorite(selectedGame, false)}
          onLaunch={launchRelease}
          onClose={() => setSelectedGameId(null)}
          now={nowMs}
        />
      )}
    </>
  );
}

export default GamesView;
