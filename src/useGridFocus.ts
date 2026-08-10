import { useCallback, useEffect, useRef, useState } from "react";
import {
  useControllerActions,
  type ControllerHandler,
} from "./ControllerProvider";
import { computeColumns, moveFocusIndex } from "./gridNavigation";
import type { Direction } from "./controller";

interface UseGridFocusOptions {
  /** Total number of focusable items in the grid. */
  itemCount: number;
  /** Card width used with the container's measured width to derive column count. */
  itemWidth?: number;
  /** Gap between cards, matching the CSS grid's `gap`. */
  gap?: number;
  /** Whether this focus scope owns semantic controller/keyboard input. */
  enabled?: boolean;
  /** How many of the first items are full-width rows stacked above the grid. */
  leadingFullWidth?: number;
  /** Initial focus index, useful when a toolbar item precedes the content grid. */
  initialIndex?: number;
  /** Called when the active scope receives B/Escape. */
  onBack?: () => void;
  /** Called when the active scope receives X. */
  onSecondary?: (index: number) => void;
  /** Called when the active scope receives Y. */
  onFavorite?: (index: number) => void;
}

interface UseGridFocusResult {
  /** Attach to the grid's container element (used to measure available width). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Index of the currently focused item. */
  focusedIndex: number;
  /** Attach to each item at `index` to register it as a focus target. */
  registerItemRef: (index: number) => (el: HTMLElement | null) => void;
  /** Sync roving focus when focus arrives by mouse or another scope. */
  focusItem: (index: number) => void;
}

/**
 * Roving-focus navigation for responsive grids.
 *
 * All raw keyboard and Gamepad input is translated by ControllerProvider. This
 * hook owns only one focus scope: directional movement, activation, B/Escape,
 * and the optional X/Y actions are handled when one of its registered items is
 * focused. That ownership rule prevents two mounted scopes from fighting.
 */
export function useGridFocus({
  itemCount,
  itemWidth = 220,
  gap = 16,
  enabled = true,
  leadingFullWidth = 0,
  initialIndex = 0,
  onBack,
  onSecondary,
  onFavorite,
}: UseGridFocusOptions): UseGridFocusResult {
  const containerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const focusedIndexRef = useRef(0);
  const [focusedIndex, setFocusedIndex] = useState(initialIndex);
  const [columns, setColumns] = useState(1);

  focusedIndexRef.current = focusedIndex;

  useEffect(() => {
    setFocusedIndex((current) => Math.min(current, Math.max(itemCount - 1, 0)));
    itemRefs.current.length = itemCount;
  }, [itemCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateColumns = () =>
      setColumns(computeColumns(el.clientWidth, itemWidth, gap));

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(el);
    return () => observer.disconnect();
  }, [itemWidth, gap]);

  const move = useCallback(
    (direction: Direction) => {
      setFocusedIndex((current) =>
        moveFocusIndex(
          current,
          direction,
          itemCount,
          columns,
          leadingFullWidth,
        ),
      );
    },
    [columns, itemCount, leadingFullWidth],
  );

  const activeScope = useCallback(
    () => itemRefs.current.includes(document.activeElement as HTMLElement),
    [],
  );

  const onAction = useCallback<ControllerHandler>(
    (action) => {
      if (!activeScope()) return false;

      if (
        action === "up" ||
        action === "down" ||
        action === "left" ||
        action === "right"
      ) {
        move(action);
        return true;
      }

      const index = focusedIndexRef.current;
      if (action === "confirm") {
        itemRefs.current[index]?.click();
        return itemRefs.current[index] !== null;
      }
      if (action === "back" && onBack) {
        onBack();
        return true;
      }
      if (action === "secondary" && onSecondary) {
        onSecondary(index);
        return true;
      }
      if (action === "favorite" && onFavorite) {
        onFavorite(index);
        return true;
      }
      return false;
    },
    [activeScope, move, onBack, onFavorite, onSecondary],
  );

  useControllerActions({ enabled, onAction });

  useEffect(() => {
    if (!enabled) return;
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex, enabled]);

  const registerItemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    [],
  );

  const focusItem = useCallback((index: number) => setFocusedIndex(index), []);

  return { containerRef, focusedIndex, registerItemRef, focusItem };
}
