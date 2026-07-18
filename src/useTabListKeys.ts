import { useCallback, useRef, type KeyboardEvent } from "react";
import { nextTabIndex } from "./tabList";

interface UseTabListKeysResult {
  /** Attach to each `role="tab"` button so the hook can move DOM focus. */
  registerTabRef: (index: number) => (el: HTMLButtonElement | null) => void;
  /** Attach to the `role="tablist"` container's `onKeyDown`. */
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Wire arrow-key (and Home/End) roving focus onto a horizontal tablist,
 * completing the WAI-ARIA tabs pattern. Selection follows focus (automatic
 * activation), so the caller renders `tabIndex={isSelected ? 0 : -1}` and the
 * selected tab is the tablist's single tab stop; this hook just moves both the
 * selection (via `onSelect`) and the actual DOM focus to the next tab.
 *
 * Scoped to the tablist's own `onKeyDown`, so — unlike a second polled gamepad
 * focus loop — it never competes with `useGridFocus` for the arrow keys.
 */
export function useTabListKeys(
  count: number,
  selectedIndex: number,
  onSelect: (index: number) => void,
): UseTabListKeysResult {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const registerTabRef = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      tabRefs.current[index] = el;
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const next = nextTabIndex(selectedIndex, event.key, count);
      if (next === null) return;
      event.preventDefault();
      onSelect(next);
      tabRefs.current[next]?.focus();
    },
    [count, selectedIndex, onSelect],
  );

  return { registerTabRef, onKeyDown };
}
