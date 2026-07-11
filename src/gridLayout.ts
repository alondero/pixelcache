/**
 * Single source of truth for the Game grid's card sizing, shared between the
 * `useGridFocus` column math (`App.tsx`) and the actual CSS grid it measures
 * (`GameGrid.tsx` forwards these as CSS custom properties consumed by
 * `.game-grid` in `App.css`) — so the two can never drift out of sync.
 */
export const CARD_MIN_WIDTH_PX = 160;
export const CARD_GAP_PX = 16;
