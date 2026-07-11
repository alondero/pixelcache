import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeColumns,
  moveFocusIndex,
  type Direction,
} from "./gridNavigation";

const ARROW_KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** Standard Gamepad mapping D-pad button indices (up, down, left, right). */
const DPAD_BUTTON_DIRECTIONS: Direction[] = ["up", "down", "left", "right"];
const DPAD_BUTTON_START_INDEX = 12;
const STICK_AXIS_THRESHOLD = 0.5;
/** Minimum time between repeated gamepad moves, so a held stick/button doesn't race. */
const GAMEPAD_REPEAT_DELAY_MS = 200;

/** Read the first direction a gamepad's D-pad or left stick is currently pushing. */
export function readGamepadDirection(pad: Gamepad): Direction | null {
  for (let i = 0; i < DPAD_BUTTON_DIRECTIONS.length; i++) {
    if (pad.buttons[DPAD_BUTTON_START_INDEX + i]?.pressed) {
      return DPAD_BUTTON_DIRECTIONS[i];
    }
  }

  const [x, y] = pad.axes;
  if (y !== undefined && y < -STICK_AXIS_THRESHOLD) return "up";
  if (y !== undefined && y > STICK_AXIS_THRESHOLD) return "down";
  if (x !== undefined && x < -STICK_AXIS_THRESHOLD) return "left";
  if (x !== undefined && x > STICK_AXIS_THRESHOLD) return "right";
  return null;
}

interface UseGridFocusOptions {
  /** Total number of focusable items in the grid. */
  itemCount: number;
  /** Card width used with the container's measured width to derive column count. */
  itemWidth?: number;
  /** Gap between cards, matching the CSS grid's `gap`. */
  gap?: number;
}

interface UseGridFocusResult {
  /** Attach to the grid's container element (used to measure available width). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Index of the currently focused item. */
  focusedIndex: number;
  /** Attach to each item at `index` to register it as a focus target. */
  registerItemRef: (index: number) => (el: HTMLElement | null) => void;
}

/**
 * Roving-focus keyboard + gamepad navigation for a responsive CSS grid.
 *
 * Delegates all position math to the pure functions in `gridNavigation.ts` —
 * this hook is just the glue that measures the container, listens for arrow
 * keys and D-pad/stick input, and calls `.focus()` on the resulting item.
 */
export function useGridFocus({
  itemCount,
  itemWidth = 220,
  gap = 16,
}: UseGridFocusOptions): UseGridFocusResult {
  const containerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columns, setColumns] = useState(1);

  useEffect(() => {
    setFocusedIndex((current) => Math.min(current, Math.max(itemCount - 1, 0)));
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
        moveFocusIndex(current, direction, itemCount, columns),
      );
    },
    [itemCount, columns],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const direction = ARROW_KEY_DIRECTIONS[event.key];
      if (!direction) return;
      // Only steal arrow keys while one of *our* items is focused, so this
      // hook can't hijack navigation for an unrelated focusable element
      // (e.g. a future search box) elsewhere on the page.
      if (!itemRefs.current.includes(document.activeElement as HTMLElement)) {
        return;
      }
      event.preventDefault();
      move(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move]);

  useEffect(() => {
    if (typeof navigator.getGamepads !== "function") return;

    let frameId: number;
    let lastMoveAt = 0;

    function poll(time: number) {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (!pad) continue;
        const direction = readGamepadDirection(pad);
        if (direction && time - lastMoveAt > GAMEPAD_REPEAT_DELAY_MS) {
          move(direction);
          lastMoveAt = time;
          break;
        }
      }
      frameId = requestAnimationFrame(poll);
    }

    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, [move]);

  useEffect(() => {
    itemRefs.current[focusedIndex]?.focus();
  }, [focusedIndex]);

  const registerItemRef = useCallback(
    (index: number) => (el: HTMLElement | null) => {
      itemRefs.current[index] = el;
    },
    [],
  );

  return { containerRef, focusedIndex, registerItemRef };
}
