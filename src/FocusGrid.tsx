import type { ReactNode, RefObject } from "react";
import { GRID_CSS_VARS } from "./gridLayout";

interface FocusGridProps {
  /** The `useGridFocus` container ref used to measure the grid's width. */
  containerRef: RefObject<HTMLElement | null>;
  /** Accessible name for the grid (e.g. "Game catalog", "Playlist releases"). */
  label: string;
  /** The `role="gridcell"` items, rendered by the caller. */
  children: ReactNode;
}

/**
 * The shared responsive CSS-grid container behind every focus-navigable grid
 * (`GameGrid`, `PlaylistsView`). Owns the `.game-grid` scaffold and the
 * `GRID_CSS_VARS` sizing that keeps the rendered columns in lockstep with the
 * column count `useGridFocus` measures — the caller only supplies the cells.
 *
 * The cells are wrapped in a single `role="row"` so the accessibility tree is
 * a valid `grid > row > gridcell` nesting. `display: contents` removes that
 * wrapper's own box, so the cells stay direct children of the CSS grid and the
 * column layout is unaffected.
 */
function FocusGrid({ containerRef, label, children }: FocusGridProps) {
  return (
    <div
      className="game-grid"
      style={GRID_CSS_VARS}
      ref={containerRef as RefObject<HTMLDivElement>}
      role="grid"
      aria-label={label}
    >
      <div role="row" style={{ display: "contents" }}>
        {children}
      </div>
    </div>
  );
}

export default FocusGrid;
