/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  controllerActionForKey,
  controllerActionsForGamepad,
  gamepadSnapshot,
  type ControllerAction,
  type GamepadSnapshot,
} from "./controller";

export type InputSource = "controller" | "keyboard";
export type ControllerHandler = (
  action: ControllerAction,
  source: InputSource,
) => boolean | void;

interface ControllerContextValue {
  controllerConnected: boolean;
  playMode: boolean;
  fullscreen: boolean;
  setPlayMode: (enabled: boolean) => void;
  toggleFullscreen: () => Promise<void>;
  subscribe: (handler: ControllerHandler) => () => void;
}

const PLAY_MODE_STORAGE_KEY = "pixelcache.play-mode";
const FULLSCREEN_STORAGE_KEY = "pixelcache.fullscreen";

const defaultContext: ControllerContextValue = {
  controllerConnected: false,
  // Play Mode is the player-facing default. Management screens remain
  // available from the quick menu and the Settings tab.
  playMode: true,
  fullscreen: false,
  setPlayMode: () => undefined,
  toggleFullscreen: async () => undefined,
  subscribe: () => () => undefined,
};

const ControllerContext = createContext<ControllerContextValue>(defaultContext);

function readPlayMode(): boolean {
  try {
    const stored = window.localStorage.getItem(PLAY_MODE_STORAGE_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

function readFullscreenPreference(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.matches("input, select, textarea, [contenteditable='true']")
  );
}

function isActionKey(event: KeyboardEvent): boolean {
  return (
    event.key.startsWith("Arrow") ||
    event.key === "Enter" ||
    event.key === " " ||
    event.key === "Escape" ||
    event.key === "F1" ||
    event.key === "[" ||
    event.key === "]" ||
    event.key === "PageUp" ||
    event.key === "PageDown" ||
    event.key.toLowerCase() === "x" ||
    event.key.toLowerCase() === "y"
  );
}

function isDiscreteAction(action: ControllerAction): boolean {
  return (
    action !== "up" &&
    action !== "down" &&
    action !== "left" &&
    action !== "right"
  );
}

interface ControllerProviderProps {
  children: ReactNode;
}

/**
 * One application-level input pump for controller and keyboard semantics.
 * Views subscribe to actions only while their focus scope is active, so a
 * details panel and the library grid never race over the same input frame.
 */
export function ControllerProvider({ children }: ControllerProviderProps) {
  const handlers = useRef(new Set<ControllerHandler>());
  const previousGamepad = useRef<GamepadSnapshot | null>(null);
  const lastDirectionAt = useRef(0);
  const [controllerConnected, setControllerConnected] = useState(false);
  const [playMode, setPlayModeState] = useState(readPlayMode);
  const [fullscreen, setFullscreen] = useState(
    () =>
      typeof document !== "undefined" && document.fullscreenElement !== null,
  );

  const dispatch = useCallback(
    (action: ControllerAction, source: InputSource): boolean => {
      let handled = false;
      for (const handler of handlers.current) {
        handled = handler(action, source) === true || handled;
      }
      return handled;
    },
    [],
  );

  const subscribe = useCallback((handler: ControllerHandler) => {
    handlers.current.add(handler);
    return () => handlers.current.delete(handler);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (isTextEntry(event.target) && event.key !== "Escape") return;
      if (!isActionKey(event)) return;
      const action = controllerActionForKey(event.key);
      if (!action) return;
      // Native key repeat is useful for text entry but makes a focused action
      // button launch repeatedly. Directional grids already have their own
      // browser repeat behavior, so only suppress repeats for discrete keys.
      if (event.repeat && isDiscreteAction(action)) return;
      if (dispatch(action, "keyboard")) event.preventDefault();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  useEffect(() => {
    if (typeof navigator.getGamepads !== "function") return;

    let frameId: number;
    function poll(time: number) {
      const pads = Array.from(navigator.getGamepads() ?? []).filter(
        (pad): pad is Gamepad => pad !== null,
      );
      const pad = pads[0];
      setControllerConnected(pad !== undefined);

      if (!pad) {
        previousGamepad.current = null;
        lastDirectionAt.current = 0;
      } else {
        const current = gamepadSnapshot(pad);
        const previous = previousGamepad.current;
        // A pad may already be held when it is first connected. Treat that
        // frame as the baseline; a real press after the baseline is still an
        // edge and is handled immediately.
        if (!previous) {
          previousGamepad.current = current;
          lastDirectionAt.current = time;
        } else {
          const actions = controllerActionsForGamepad(
            current,
            previous,
            time - lastDirectionAt.current,
          );
          for (const action of actions) {
            dispatch(action, "controller");
            if (
              action === "up" ||
              action === "down" ||
              action === "left" ||
              action === "right"
            ) {
              lastDirectionAt.current = time;
            }
          }
          previousGamepad.current = current;
        }
      }

      frameId = requestAnimationFrame(poll);
    }

    frameId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frameId);
  }, [dispatch]);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreen(document.fullscreenElement !== null);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const current = await getCurrentWindow().isFullscreen();
      setFullscreen(current);
      if (!current && readFullscreenPreference()) {
        await getCurrentWindow().setFullscreen(true);
        setFullscreen(true);
      }
    });
  }, []);

  const setPlayMode = useCallback((enabled: boolean) => {
    setPlayModeState(enabled);
    try {
      window.localStorage.setItem(PLAY_MODE_STORAGE_KEY, String(enabled));
    } catch {
      // Preferences are best effort in restricted WebViews/private windows.
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      const next = !fullscreen;
      if ("__TAURI_INTERNALS__" in window) {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().setFullscreen(next);
        setFullscreen(next);
      } else if (next && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (!next && document.fullscreenElement) {
        await document.exitFullscreen();
      }
      window.localStorage.setItem(FULLSCREEN_STORAGE_KEY, String(next));
    } catch {
      // Fullscreen can be unavailable in a browser tab or denied by the host.
    }
  }, [fullscreen]);

  const value = useMemo<ControllerContextValue>(
    () => ({
      controllerConnected,
      playMode,
      fullscreen,
      setPlayMode,
      toggleFullscreen,
      subscribe,
    }),
    [
      controllerConnected,
      fullscreen,
      playMode,
      setPlayMode,
      subscribe,
      toggleFullscreen,
    ],
  );

  return (
    <ControllerContext.Provider value={value}>
      {children}
    </ControllerContext.Provider>
  );
}

export function useController(): Omit<ControllerContextValue, "subscribe"> {
  const value = useContext(ControllerContext);
  return {
    controllerConnected: value.controllerConnected,
    playMode: value.playMode,
    fullscreen: value.fullscreen,
    setPlayMode: value.setPlayMode,
    toggleFullscreen: value.toggleFullscreen,
  };
}

interface UseControllerActionsOptions {
  enabled?: boolean;
  onAction: ControllerHandler;
}

/** Subscribe a focus scope to semantic input while it is active. */
export function useControllerActions({
  enabled = true,
  onAction,
}: UseControllerActionsOptions): void {
  const { subscribe } = useContext(ControllerContext);
  const handlerRef = useRef(onAction);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    handlerRef.current = onAction;
    enabledRef.current = enabled;
  }, [enabled, onAction]);

  useEffect(
    () =>
      subscribe((action, source) =>
        enabledRef.current ? handlerRef.current(action, source) : false,
      ),
    [subscribe],
  );
}
