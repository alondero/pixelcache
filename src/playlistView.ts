import type { Catalog, Release } from "./catalog";

/**
 * Resolve a playlist's `releaseIds` to their full Release objects, preserving
 * the playlist's ordering and silently dropping any dangling id (one with no
 * matching Release in the catalog). Returns an empty list if the playlist id
 * itself is unknown.
 *
 * Kept pure and DOM-free so the join logic is unit-testable without React,
 * mirroring the `catalogView`/`gridNavigation` split.
 */
export function playlistReleases(
  catalog: Catalog,
  playlistId: string,
): Release[] {
  const playlist = catalog.playlists.find((p) => p.id === playlistId);
  if (!playlist) return [];
  return playlist.releaseIds
    .map((id) => catalog.releases.find((r) => r.id === id))
    .filter((r): r is Release => r !== undefined);
}
