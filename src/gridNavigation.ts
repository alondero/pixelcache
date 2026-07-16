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
 *
 * The first `leading` items are **full-width rows** stacked above the grid
 * (e.g. the "Continue Playing" hero banner): each occupies a row of its own,
 * and the remaining `itemCount - leading` items flow in `columns`-wide rows
 * below. With `leading = 0` (the default) this is a plain uniform grid.
 */
export function moveFocusIndex(
  current: number,
  direction: Direction,
  itemCount: number,
  columns: number,
  leading = 0,
): number {
  if (itemCount <= 1) return itemCount === 1 ? 0 : current;

  // Describe the layout as stacked rows: `leading` single-item rows, then the
  // grid rows. Up/down move a whole row (keeping the column, clamped to the
  // target row's length); left/right stay a simple linear walk with wrap, so
  // a hero row never traps horizontal navigation.
  const gridItems = itemCount - leading;
  const gridRowCount = Math.ceil(Math.max(gridItems, 0) / columns);
  const rowCount = leading + gridRowCount;
  const lastRowLength = gridItems - (gridRowCount - 1) * columns;

  const rowOf = (index: number) =>
    index < leading ? index : leading + Math.floor((index - leading) / columns);
  const colOf = (index: number) =>
    index < leading ? 0 : (index - leading) % columns;
  const rowLength = (r: number) => {
    if (r < leading) return 1;
    return r === rowCount - 1 ? lastRowLength : columns;
  };
  const indexAt = (r: number, c: number) =>
    r < leading ? r : leading + (r - leading) * columns + c;

  switch (direction) {
    case "right":
      return current === itemCount - 1 ? 0 : current + 1;
    case "left":
      return current === 0 ? itemCount - 1 : current - 1;
    case "down": {
      const nextRow = (rowOf(current) + 1) % rowCount;
      const clampedCol = Math.min(colOf(current), rowLength(nextRow) - 1);
      return indexAt(nextRow, clampedCol);
    }
    case "up": {
      const prevRow = (rowOf(current) - 1 + rowCount) % rowCount;
      const clampedCol = Math.min(colOf(current), rowLength(prevRow) - 1);
      return indexAt(prevRow, clampedCol);
    }
  }
}
