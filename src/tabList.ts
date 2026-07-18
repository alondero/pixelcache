/**
 * Pure keyboard math for the WAI-ARIA tabs pattern, shared by every horizontal
 * tablist (the top-level view tabs in `App`, the playlist chips in
 * `PlaylistsView`). Kept free of React so the roving-focus behaviour is
 * unit-testable in isolation — `useTabListKeys` is the thin glue that focuses
 * the resulting tab.
 */

/**
 * Given the currently selected tab index and a key press, return the index the
 * focus should move to in a horizontal tablist, or `null` when the key is not
 * a tablist navigation key (so the caller leaves the event alone). Left/Right
 * wrap at both ends; Home/End jump to the first/last tab.
 */
export function nextTabIndex(
  current: number,
  key: string,
  count: number,
): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
