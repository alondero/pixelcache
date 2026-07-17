import type { MouseEvent, RefObject } from "react";
import type { Game } from "./catalog";
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
   * Called with the Game when its favorite badge is clicked (mouse only — the
   * focus loop still routes Enter/A on the card to `onSelectGame`; a controller
   * user can favorite from the details panel's heart toggle instead). Keeping
   * the badge outside the grid's roving focus avoids splitting the keyboard
   * journey into two parallel loops.
   */
  onToggleFavorite?: (game: Game) => void;
  /**
   * Where the cards start in the caller's roving-focus loop — 1 when a
   * "Continue Playing" hero occupies index 0, otherwise 0.
   */
  indexOffset?: number;
  /** Per-Game play activity for the "Played …" caption (see `playEntriesByGame`). */
  playByGame?: Map<string, PlayEntry>;
  /** Wall-clock time for the "Played X ago" caption (see `useMinuteTick`). */
  now: number;
}

/** Responsive CSS grid of Game cards, focus-navigable via `useGridFocus`. */
function GameGrid({
  cards,
  containerRef,
  focusedIndex,
  registerItemRef,
  focusItem,
  onSelectGame,
  onToggleFavorite,
  indexOffset = 0,
  playByGame,
  now,
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
            {onToggleFavorite && (
              <button
                type="button"
                className={`game-card-favorite${card.game.favorite ? " is-favorite" : ""}`}
                aria-label={
                  card.game.favorite
                    ? `Remove ${card.game.id} from favorites`
                    : `Add ${card.game.id} to favorites`
                }
                aria-pressed={card.game.favorite === true}
                onClick={(event: MouseEvent) => {
                  // The card itself is a button that opens the details panel;
                  // a click on the badge must not bubble into that. Also stops
                  // the synthetic focus so the grid's roving focus stays on
                  // the card the user was on.
                  event.stopPropagation();
                  onToggleFavorite(card.game);
                }}
                tabIndex={-1}
              >
                {card.game.favorite ? "♥" : "♡"}
              </button>
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
                ? `Played ${formatLastPlayed(played.lastPlayedMs, now)}`
                : `${card.releaseCount} release${card.releaseCount === 1 ? "" : "s"}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default GameGrid;
