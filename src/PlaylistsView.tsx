import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import { useControllerActions } from "./ControllerProvider";
import FocusGrid from "./FocusGrid";
import type { LaunchResult, LaunchStatus } from "./launch";
import LaunchStatusLine from "./LaunchStatusLine";
import { playlistReleases } from "./playlistView";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";
import { useGridFocus } from "./useGridFocus";
import { useTabListKeys } from "./useTabListKeys";

interface PlaylistsViewProps {
  catalog: Catalog;
  controllerEnabled?: boolean;
}

/**
 * The "Playlists" screen: pick one of the player's curated collections, then
 * browse and directly launch its Releases. Each Release card invokes the
 * `launch_release` command, which resolves the Release's Deck on the backend.
 *
 * Owns its own `useGridFocus` over the Release cards; because `App` mounts only
 * one view at a time, this focus loop never competes with the Games view's.
 */
function PlaylistsView({
  catalog,
  controllerEnabled = true,
}: PlaylistsViewProps) {
  const playlists = catalog.playlists;
  const [selectedId, setSelectedId] = useState<string | null>(
    playlists[0]?.id ?? null,
  );
  const [launchStatus, setLaunchStatus] = useState<
    LaunchStatus<{ releaseId: string }>
  >({ kind: "idle" });

  const releases = selectedId ? playlistReleases(catalog, selectedId) : [];
  const { containerRef, focusedIndex, registerItemRef, focusItem } =
    useGridFocus({
      itemCount: releases.length,
      itemWidth: CARD_MIN_WIDTH_PX,
      gap: CARD_GAP_PX,
      enabled: controllerEnabled,
      onBack: () => {
        document.getElementById(`playlist-tab-${selectedId}`)?.focus();
      },
    });

  useEffect(() => {
    if (
      !selectedId ||
      !document.activeElement?.id.startsWith("playlist-tab-")
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => focusItem(0));
    return () => cancelAnimationFrame(frame);
  }, [focusItem, releases.length, selectedId]);

  // Playlist chips are a WAI-ARIA tablist controlling the release grid below;
  // arrow keys rove between them with selection following focus.
  const selectedTabIndex = playlists.findIndex((p) => p.id === selectedId);
  const { registerTabRef, onKeyDown, moveTab } = useTabListKeys(
    playlists.length,
    selectedTabIndex,
    (index) => setSelectedId(playlists[index].id),
  );

  useControllerActions({
    enabled: controllerEnabled,
    onAction: (action) => {
      const activeTab = document.activeElement?.id.startsWith("playlist-tab-");
      if (!activeTab) return false;
      if (action === "left" || action === "right") {
        moveTab(action === "left" ? "previous" : "next");
        return true;
      }
      if (action === "confirm") {
        (document.activeElement as HTMLElement).click();
        return true;
      }
      return false;
    },
  });

  async function launchRelease(releaseId: string) {
    setLaunchStatus({ kind: "launching", releaseId });
    try {
      const result = await invoke<LaunchResult>("launch_release", {
        releaseId,
      });
      setLaunchStatus({ kind: "launched", result });
    } catch (error) {
      setLaunchStatus({ kind: "error", message: String(error) });
    }
  }

  if (playlists.length === 0) {
    return (
      <p className="status" role="status">
        No playlists yet. Add one to your catalog to see it here.
      </p>
    );
  }

  return (
    <div className="playlists-view">
      <div
        className="playlist-tabs"
        role="tablist"
        aria-label="Playlists"
        onKeyDown={onKeyDown}
      >
        {playlists.map((playlist, index) => {
          const isSelected = playlist.id === selectedId;
          return (
            <button
              key={playlist.id}
              type="button"
              role="tab"
              id={`playlist-tab-${playlist.id}`}
              aria-controls={`playlist-panel-${playlist.id}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              ref={registerTabRef(index)}
              className={`playlist-chip${isSelected ? " is-selected" : ""}`}
              onClick={() => setSelectedId(playlist.id)}
            >
              {playlist.name}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`playlist-panel-${selectedId}`}
        aria-labelledby={`playlist-tab-${selectedId}`}
      >
        <FocusGrid containerRef={containerRef} label="Playlist releases">
          {releases.map((release, index) => (
            <button
              key={release.id}
              type="button"
              className={`game-card${focusedIndex === index ? " is-focused" : ""}`}
              ref={registerItemRef(index)}
              tabIndex={focusedIndex === index ? 0 : -1}
              onFocus={() => focusItem(index)}
              role="gridcell"
              onClick={() => launchRelease(release.id)}
              disabled={
                launchStatus.kind === "launching" &&
                launchStatus.releaseId === release.id
              }
            >
              <span className="game-card-title">{release.title}</span>
              <span className="game-card-meta">
                {launchStatus.kind === "launching" &&
                launchStatus.releaseId === release.id
                  ? "Launching…"
                  : `${release.platform} · Play`}
              </span>
            </button>
          ))}
        </FocusGrid>

        {releases.length === 0 && (
          <p className="status" role="status">
            This playlist has no releases yet.
          </p>
        )}

        <LaunchStatusLine status={launchStatus} />
      </div>
    </div>
  );
}

export default PlaylistsView;
