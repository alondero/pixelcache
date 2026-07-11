import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { RefObject } from "react";
import { useGridFocus } from "./useGridFocus";

/** Minimal harness rendering N focusable buttons wired to the hook. */
function Harness({ itemCount }: { itemCount: number }) {
  const { containerRef, focusedIndex, registerItemRef } = useGridFocus({
    itemCount,
    itemWidth: 100,
    gap: 0,
  });
  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} data-testid="grid">
      {Array.from({ length: itemCount }, (_, i) => (
        <button
          key={i}
          ref={registerItemRef(i)}
          tabIndex={focusedIndex === i ? 0 : -1}
        >
          item-{i}
        </button>
      ))}
    </div>
  );
}

/** Force jsdom's `clientWidth` for every element for the duration of a test. */
function mockClientWidth(width: number) {
  return vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(width);
}

describe("useGridFocus", () => {
  let clientWidthSpy: MockInstance | undefined;

  afterEach(() => {
    cleanup();
    clientWidthSpy?.mockRestore();
    clientWidthSpy = undefined;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("starts with the first item focused", () => {
    render(<Harness itemCount={3} />);
    expect(screen.getByText("item-0")).toHaveFocus();
  });

  it("moves focus right and left with arrow keys, wrapping at the ends", async () => {
    const user = userEvent.setup();
    render(<Harness itemCount={3} />);

    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("item-1")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("item-0")).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("item-2")).toHaveFocus();
  });

  it("moves focus up and down respecting the measured column count", async () => {
    // 200px container / 100px cards -> 2 columns, so 4 items form a 2x2 grid.
    clientWidthSpy = mockClientWidth(200);
    const user = userEvent.setup();
    render(<Harness itemCount={4} />);

    expect(screen.getByText("item-0")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByText("item-2")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("item-3")).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByText("item-1")).toHaveFocus();
  });

  it("ignores arrow keys when focus is outside the grid's tracked items", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="unrelated" />
        <Harness itemCount={3} />
      </>,
    );

    screen.getByLabelText("unrelated").focus();
    expect(screen.getByLabelText("unrelated")).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByLabelText("unrelated")).toHaveFocus();
    expect(screen.getByText("item-0")).not.toHaveFocus();
  });

  it("moves focus in response to gamepad D-pad button presses", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"],
    });
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[15] = { pressed: true }; // D-pad right
    const pad = { buttons, axes: [0, 0] } as unknown as Gamepad;

    // jsdom does not implement the Gamepad API at all, so the property must be
    // defined before it can be mocked (vi.spyOn requires it to already exist).
    Object.defineProperty(navigator, "getGamepads", {
      value: vi.fn(),
      configurable: true,
    });
    const getGamepads = vi
      .spyOn(navigator, "getGamepads")
      .mockReturnValue([pad, null, null, null]);

    render(<Harness itemCount={3} />);
    expect(screen.getByText("item-0")).toHaveFocus();

    await vi.advanceTimersByTimeAsync(300);
    expect(screen.getByText("item-1")).toHaveFocus();

    getGamepads.mockRestore();
  });
});
