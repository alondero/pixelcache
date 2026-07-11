// Extends Vitest's `expect` with jsdom matchers like `toBeInTheDocument`.
import "@testing-library/jest-dom/vitest";

// jsdom does not implement ResizeObserver; components use it to measure the
// game grid's width for column-aware keyboard/gamepad navigation.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [{ target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}

    disconnect() {}
  }

  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
