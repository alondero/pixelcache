/**
 * Single source of truth for the Game grid's card sizing, shared between the
 * `useGridFocus` column math (`App.tsx`) and the actual CSS grid it measures
 * (`GameGrid.tsx` forwards these as CSS custom properties consumed by
 * `.game-grid` in `App.css`) — so the two can never drift out of sync.
 */
import type { CSSProperties } from "react";

export const CARD_MIN_WIDTH_PX = 160;
export const CARD_GAP_PX = 16;

/**
 * The card sizing forwarded to a `.game-grid` as CSS custom properties, so the
 * DOM grid always renders at the same dimensions `useGridFocus` measured its
 * column count against. Shared by every grid (`GameGrid`, `PlaylistsView`).
 */
export const GRID_CSS_VARS = {
  "--card-min-width": `${CARD_MIN_WIDTH_PX}px`,
  "--card-gap": `${CARD_GAP_PX}px`,
} as CSSProperties;
