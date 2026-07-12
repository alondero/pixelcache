import { useState } from "react";
import type { RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Catalog } from "./catalog";
import type { LaunchResult } from "./launch";
import { playlistReleases } from "./playlistView";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX, GRID_CSS_VARS } from "./gridLayout";
import { useGridFocus } from "./useGridFocus";

type LaunchStatus =
  | { kind: "idle" }
  | { kind: "launching"; releaseId: string }
  | { kind: "launched"; result: LaunchResult }
  | { kind: "error"; message: string };

interface PlaylistsViewProps {
  catalog: Catalog;
}

/**
 * The "Playlists" screen: pick one of the player's curated collections, then
 * browse and directly launch its Releases. Each Release card invokes the
 * `launch_release` command, which resolves the Release's Deck on the backend.
 *
 * Owns its own `useGridFocus` over the Release cards; because `App` mounts only
 * one view at a time, this focus loop never competes with the Games view's.
 */
function PlaylistsView({ catalog }: PlaylistsViewProps) {
  const playlists = catalog.playlists;
  const [selectedId, setSelectedId] = useState<string | null>(
    playlists[0]?.id ?? null,
  );
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>({
    kind: "idle",
  });

  const releases = selectedId ? playlistReleases(catalog, selectedId) : [];
  const { containerRef, focusedIndex, registerItemRef } = useGridFocus({
    itemCount: releases.length,
    itemWidth: CARD_MIN_WIDTH_PX,
    gap: CARD_GAP_PX,
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
      <div className="playlist-tabs" role="tablist" aria-label="Playlists">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            role="tab"
            aria-selected={playlist.id === selectedId}
            className={`playlist-chip${playlist.id === selectedId ? " is-selected" : ""}`}
            onClick={() => setSelectedId(playlist.id)}
          >
            {playlist.name}
          </button>
        ))}
      </div>

      <div
        className="game-grid"
        style={GRID_CSS_VARS}
        ref={containerRef as RefObject<HTMLDivElement>}
        role="grid"
        aria-label="Playlist releases"
      >
        {releases.map((release, index) => (
          <button
            key={release.id}
            type="button"
            className={`game-card${focusedIndex === index ? " is-focused" : ""}`}
            ref={registerItemRef(index)}
            tabIndex={focusedIndex === index ? 0 : -1}
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
      </div>

      {releases.length === 0 && (
        <p className="status" role="status">
          This playlist has no releases yet.
        </p>
      )}

      <p className="status" role="status" aria-live="polite">
        {launchStatus.kind === "launched" &&
          `Launched ${launchStatus.result.program} (pid ${launchStatus.result.pid})`}
        {launchStatus.kind === "error" &&
          `Launch failed: ${launchStatus.message}`}
      </p>
    </div>
  );
}

export default PlaylistsView;
