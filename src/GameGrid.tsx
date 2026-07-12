import type { RefObject } from "react";
import type { Catalog } from "./catalog";
import { gameCardInfos } from "./catalogView";
import { GRID_CSS_VARS } from "./gridLayout";

interface GameGridProps {
  catalog: Catalog;
  containerRef: RefObject<HTMLElement | null>;
  focusedIndex: number;
  registerItemRef: (index: number) => (el: HTMLElement | null) => void;
}

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
      style={GRID_CSS_VARS}
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
