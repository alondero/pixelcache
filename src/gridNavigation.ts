/**
 * Pure math for a keyboard/gamepad-navigable CSS grid of focusable cards.
 *
 * Kept free of the DOM so it can be unit tested without React or jsdom layout
 * quirks; `useGridFocus` is the thin, harder-to-unit-test layer that wires
 * these functions to real key/gamepad events and element refs.
 */

export type Direction = "up" | "down" | "left" | "right";

/**
 * How many columns fit in a container of `containerWidth`, given cards of
 * `itemWidth` separated by `gap`. Mirrors a CSS
 * `grid-template-columns: repeat(auto-fill, minmax(itemWidth, 1fr))` layout,
 * so keyboard/gamepad navigation lines up with what the browser actually
 * rendered.
 */
export function computeColumns(
  containerWidth: number,
  itemWidth: number,
  gap: number,
): number {
  if (containerWidth <= 0) return 1;
  const columns = Math.floor((containerWidth + gap) / (itemWidth + gap));
  return Math.max(1, columns);
}

/**
 * Compute the next focused index when moving `direction` from `current` in a
 * grid of `itemCount` items laid out in `columns`-wide rows (the last row may
 * be partial). All movement wraps around the grid; `down`/`up` clamp into the
 * ragged last row rather than landing past the end.
 */
export function moveFocusIndex(
  current: number,
  direction: Direction,
  itemCount: number,
  columns: number,
): number {
  if (itemCount <= 1) return itemCount === 1 ? 0 : current;

  const row = Math.floor(current / columns);
  const col = current % columns;
  const rowCount = Math.ceil(itemCount / columns);
  const lastRowLength = itemCount - (rowCount - 1) * columns;
  const rowLength = (r: number) =>
    r === rowCount - 1 ? lastRowLength : columns;

  switch (direction) {
    case "right":
      return current === itemCount - 1 ? 0 : current + 1;
    case "left":
      return current === 0 ? itemCount - 1 : current - 1;
    case "down": {
      const nextRow = (row + 1) % rowCount;
      const clampedCol = Math.min(col, rowLength(nextRow) - 1);
      return nextRow * columns + clampedCol;
    }
    case "up": {
      const prevRow = (row - 1 + rowCount) % rowCount;
      const clampedCol = Math.min(col, rowLength(prevRow) - 1);
      return prevRow * columns + clampedCol;
    }
  }
}
