import type { CSSProperties, RefObject } from "react";
import type { Catalog } from "./catalog";
import { gameCardInfos } from "./catalogView";
import { CARD_GAP_PX, CARD_MIN_WIDTH_PX } from "./gridLayout";

interface GameGridProps {
  catalog: Catalog;
  containerRef: RefObject<HTMLElement | null>;
  focusedIndex: number;
  registerItemRef: (index: number) => (el: HTMLElement | null) => void;
}

// Forwarded as CSS custom properties so `.game-grid` in App.css always
// renders the same card size `useGridFocus` measured columns against.
const gridStyle = {
  "--card-min-width": `${CARD_MIN_WIDTH_PX}px`,
  "--card-gap": `${CARD_GAP_PX}px`,
} as CSSProperties;

/** Responsive CSS grid of Game cards, focus-navigable via `useGridFocus`. */
function GameGrid({
  catalog,
  containerRef,
  focusedIndex,
  registerItemRef,
}: GameGridProps) {
  const cards = gameCardInfos(catalog);

  return (
    <div
      className="game-grid"
      style={gridStyle}
      ref={containerRef as RefObject<HTMLDivElement>}
      role="grid"
      aria-label="Game catalog"
    >
      {cards.map((card, index) => (
        <button
          key={card.game.id}
          type="button"
          className={`game-card${focusedIndex === index ? " is-focused" : ""}`}
          ref={registerItemRef(index)}
          tabIndex={focusedIndex === index ? 0 : -1}
          role="gridcell"
        >
          <span className="game-card-title">{card.title}</span>
          <span className="game-card-meta">
            {card.releaseCount} release{card.releaseCount === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}

export default GameGrid;
