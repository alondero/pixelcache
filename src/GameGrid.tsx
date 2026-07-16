import type { RefObject } from "react";
import type { GameCardInfo } from "./catalogView";
import { GRID_CSS_VARS } from "./gridLayout";
import { mediaSrc } from "./media";
import { formatLastPlayed, type PlayEntry } from "./playHistory";

interface GameGridProps {
  /** The cards to render, already derived and filtered/sorted by the caller. */
  cards: GameCardInfo[];
  containerRef: RefObject<HTMLElement | null>;
  focusedIndex: number;
  registerItemRef: (index: number) => (el: HTMLElement | null) => void;
  /** Sync the roving focus when a card gains focus by mouse click. */
  focusItem: (index: number) => void;
  /** Called with the Game's id when its card is activated (click/Enter/A). */
  onSelectGame: (gameId: string) => void;
  /**
   * Where the cards start in the caller's roving-focus loop — 1 when a
   * "Continue Playing" hero occupies index 0, otherwise 0.
   */
  indexOffset?: number;
  /** Per-Game play activity for the "Played …" caption (see `playEntriesByGame`). */
  playByGame?: Map<string, PlayEntry>;
}

/** Responsive CSS grid of Game cards, focus-navigable via `useGridFocus`. */
function GameGrid({
  cards,
  containerRef,
  focusedIndex,
  registerItemRef,
  focusItem,
  onSelectGame,
  indexOffset = 0,
  playByGame,
}: GameGridProps) {
  return (
    <div
      className="game-grid"
      style={GRID_CSS_VARS}
      ref={containerRef as RefObject<HTMLDivElement>}
      role="grid"
      aria-label="Game catalog"
    >
      {cards.map((card, cardIndex) => {
        const index = cardIndex + indexOffset;
        const played = playByGame?.get(card.game.id);
        return (
          <button
            key={card.game.id}
            type="button"
            className={`game-card${focusedIndex === index ? " is-focused" : ""}`}
            ref={registerItemRef(index)}
            tabIndex={focusedIndex === index ? 0 : -1}
            role="gridcell"
            onClick={() => onSelectGame(card.game.id)}
            onFocus={() => focusItem(index)}
          >
            {card.game.favorite && (
              <span
                className="game-card-favorite"
                role="img"
                aria-label="Favorite"
              >
                ♥
              </span>
            )}
            {card.cover ? (
              <img
                className="game-card-cover"
                src={mediaSrc(card.cover.releaseId, card.cover.slot)}
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            ) : (
              <span
                className="game-card-cover game-card-cover-empty"
                aria-hidden="true"
              />
            )}
            <span className="game-card-title">{card.title}</span>
            <span className="game-card-meta">
              {played
                ? `Played ${formatLastPlayed(played.lastPlayedMs, Date.now())}`
                : `${card.releaseCount} release${card.releaseCount === 1 ? "" : "s"}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default GameGrid;
